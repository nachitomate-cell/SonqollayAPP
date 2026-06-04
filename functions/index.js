// Cloud Functions para SonqollayAPP
// Cotizaciones y clientes son compartidos (colecciones globales).
// Las notificaciones push se envían a todos los usuarios con tokens registrados.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

// ---------- Helpers ----------
function todayISO(tz = 'America/Santiago') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function addDaysISO(isoDate, days) {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatCLP(v) {
  if (v == null || v === '' || isNaN(v)) return '—';
  return '$ ' + Number(v).toLocaleString('es-CL');
}

// Obtiene todos los tokens FCM de todos los usuarios
async function getAllTokens() {
  const usersSnap = await db.collection('users').get();
  const all = [];
  for (const userDoc of usersSnap.docs) {
    const tokensSnap = await db.collection('users').doc(userDoc.id).collection('fcmTokens').get();
    tokensSnap.docs.forEach(d => all.push({ id: d.id, uid: userDoc.id, token: d.data().token || d.id }));
  }
  return all;
}

async function sendToAll(notification, data = {}) {
  const tokens = await getAllTokens();
  if (!tokens.length) return { sent: 0, removed: 0 };

  const message = {
    tokens: tokens.map(t => t.token),
    notification,
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    webpush: {
      headers: { Urgency: 'high' },
      fcmOptions: { link: '/' },
      notification: { icon: '/logo.jfif', badge: '/logo.jfif', requireInteraction: false },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: { title: notification.title, body: notification.body || '' },
          sound: 'default',
          badge: 1,
        },
      },
    },
    android: {
      priority: 'high',
      notification: { sound: 'default', channelId: 'default' },
    },
  };

  const res = await getMessaging().sendEachForMulticast(message);

  // Log detallado por token
  res.responses.forEach((r, i) => {
    const t = tokens[i];
    if (r.success) {
      logger.info(`OK token ${t.id.slice(0,20)} uid=${t.uid} msgId=${r.messageId}`);
    } else {
      logger.warn(`FAIL token ${t.id.slice(0,20)} uid=${t.uid} code=${r.error?.code} msg=${r.error?.message}`);
    }
  });

  // Limpiar tokens inválidos
  const toDelete = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument') {
        toDelete.push(tokens[i]);
      } else {
        logger.warn('Fallo enviando a token', tokens[i].id, code);
      }
    }
  });
  if (toDelete.length) {
    const batch = db.batch();
    toDelete.forEach(t => batch.delete(
      db.collection('users').doc(t.uid).collection('fcmTokens').doc(t.id)
    ));
    await batch.commit();
  }

  return { sent: res.successCount, removed: toDelete.length };
}

// ---------- 1) Recordatorio diario de seguimientos ----------
exports.dailyFollowUpReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const today = todayISO();
    const fourteenDaysAgo = addDaysISO(today, -14);
    const threeDaysFromNow = addDaysISO(today, 3);

    // Consulta filtrada para obtener solo cotizaciones con seguimiento en el rango de interés
    const quotesSnap = await db.collection('quotes')
      .where('seguimiento', '>=', fourteenDaysAgo)
      .where('seguimiento', '<=', threeDaysFromNow)
      .get();

    logger.info(`Verificando seguimientos · ${today} · ${quotesSnap.size} cotizaciones filtradas`);

    const buckets = { hoy: [], proximos: [], vencidos: [] };
    quotesSnap.forEach(d => {
      const q = d.data();
      if (!q.seguimiento) return;
      const estado = (q.estado || '').toLowerCase();
      if (estado === 'adjudicada' || estado === 'perdida') return;
      const diff = daysBetween(today, q.seguimiento);
      if (diff === 0) buckets.hoy.push(q);
      else if (diff > 0 && diff <= 3) buckets.proximos.push(q);
      else if (diff < 0 && diff >= -14) buckets.vencidos.push(q);
    });

    const total = buckets.hoy.length + buckets.proximos.length + buckets.vencidos.length;
    if (!total) { logger.info('Sin seguimientos pendientes'); return; }

    const lines = [];
    if (buckets.hoy.length) lines.push(`📌 Hoy: ${buckets.hoy.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);
    if (buckets.vencidos.length) lines.push(`⚠ Vencidos: ${buckets.vencidos.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);
    if (buckets.proximos.length) lines.push(`🔜 En 1-3 días: ${buckets.proximos.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);

    const title = buckets.hoy.length
      ? `Seguimientos para hoy (${buckets.hoy.length})`
      : buckets.vencidos.length
        ? `Seguimientos vencidos (${buckets.vencidos.length})`
        : `Próximos seguimientos (${buckets.proximos.length})`;

    const result = await sendToAll({ title, body: lines.join('\n') }, { kind: 'follow_up_digest', total });
    logger.info(`Enviadas ${result.sent}, tokens limpiados ${result.removed}`);
  }
);

// ---------- 2) Aviso instantáneo al guardar cotización con seguimiento = hoy ----------
exports.onQuoteSeguimientoToday = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    const before = event.data && event.data.before && event.data.before.data();
    if (!after) return;

    const today = todayISO();
    if (after.seguimiento !== today) return;
    if (before && before.seguimiento === after.seguimiento) return;

    await sendToAll({
      title: `Seguimiento HOY · ${after.numero}`,
      body: `${after.empresa} — ${after.descripcion || ''}`.slice(0, 200),
    }, { kind: 'follow_up_today', quoteId: event.params.quoteId });
  }
);

// ---------- 3) Broadcast manual desde panel de administración ----------
exports.onAdminBroadcast = onDocumentWritten(
  { document: 'adminBroadcasts/{id}', region: 'us-central1' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    const before = event.data && event.data.before && event.data.before.data();
    if (before || !after) return; // solo en creación
    if (!after.title) return;

    const result = await sendToAll(
      { title: after.title, body: after.body || '' },
      { kind: 'admin_broadcast' }
    );
    logger.info(`Broadcast enviado · ${result.sent} tokens · ${result.removed} limpiados`);
    await event.data.after.ref.update({ sent: result.sent, removedTokens: result.removed, sentAt: new Date() });
  }
);

// ---------- 4) Aviso al crear cotización ----------
exports.notifyOnNewQuote = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (before || !after) return;

    await sendToAll({
      title: `Nueva cotización · ${after.numero}`,
      body: `${after.empresa} — ${formatCLP(after.valor)}`,
    }, { kind: 'new_quote', quoteId: event.params.quoteId });
  }
);

// ---------- 5) Aviso al agregar nota en cotización ----------
exports.onQuoteNoteAdded = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after || !before) return; // solo en edición
    const prevNotas = (before.notas || '').trim();
    const newNotas  = (after.notas  || '').trim();
    // Detectar nota nueva: el campo creció (se añadió texto al final)
    if (!newNotas || newNotas.length <= prevNotas.length) return;
    const added = newNotas.startsWith(prevNotas)
      ? newNotas.slice(prevNotas.length).trim()
      : newNotas;
    const noteText = added.replace(/^\[\d{2} \w+ \d{4} \d{2}:\d{2}\]\s*/, '').slice(0, 120);
    if (!noteText) return;
    await sendToAll(
      { title: `Nota en ${after.numero} · ${after.empresa}`, body: noteText },
      { kind: 'quote_note', quoteId: event.params.quoteId }
    );
  }
);

// ---------- 6) Aviso al cambiar estado de cotización ----------
exports.onQuoteEstadoChanged = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after || !before) return;
    if ((before.estado || '') === (after.estado || '')) return;
    const icons = { Adjudicada: '🎉', Perdida: '❌', Enviada: '📤', 'En revisión': '🔍', Borrador: '📝' };
    const icon = icons[after.estado] || '📋';
    await sendToAll(
      {
        title: `${icon} ${after.numero} → ${after.estado}`,
        body: `${after.empresa}${after.descripcion ? ' · ' + after.descripcion.slice(0, 80) : ''}`,
      },
      { kind: 'quote_estado', quoteId: event.params.quoteId }
    );
  }
);

// ---------- 7) Aviso al registrar seguimiento (contacto) ----------
exports.onQuoteSeguimientoRegistered = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after || !before) return;
    const prevSeg = before.seguimiento || '';
    const newSeg  = after.seguimiento  || '';
    // Disparar solo cuando se actualiza la fecha de seguimiento a una futura
    if (!newSeg || newSeg === prevSeg) return;
    const today = todayISO();
    if (newSeg <= today) return; // ya cubierto por onQuoteSeguimientoToday
    const days = daysBetween(today, newSeg);
    await sendToAll(
      {
        title: `Seguimiento programado · ${after.numero}`,
        body: `${after.empresa} · en ${days} día${days !== 1 ? 's' : ''} (${newSeg})`,
      },
      { kind: 'seguimiento_scheduled', quoteId: event.params.quoteId }
    );
  }
);

// ---------- 8) Aviso al crear cliente ----------
exports.onClientCreated = onDocumentWritten(
  { document: 'clients/{clientId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (before || !after || !after.empresa) return;
    await sendToAll(
      {
        title: `Nuevo cliente · ${after.empresa}`,
        body: [after.nombre, after.industria].filter(Boolean).join(' · ') || 'Cliente registrado',
      },
      { kind: 'new_client', clientId: event.params.clientId }
    );
  }
);

// ---------- 9) Dictado IA — extracción de entidades con Gemini ----------
const DICTATION_SYSTEM_PROMPT = `Eres un asistente de extracción de datos para SonqollayAPP, sistema de cotizaciones comerciales chileno.

El usuario dicta un requerimiento en español. Extrae entidades y devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto adicional, sin markdown, sin bloques de código).

Estructura exacta del JSON:
{
  "empresa": string | null,
  "tipo": "Consultoría"|"Academia"|"AURA"|null,
  "industria": "Construcción"|"Minería"|"Industrial"|"Infraestructura"|null,
  "descripcion": string | null,
  "valor": number | null,
  "numero": string | null,
  "fecha": "YYYY-MM-DD" | null,
  "seguimiento": "YYYY-MM-DD" | null,
  "estado": "Borrador"|"Enviada"|"En revisión"|"Adjudicada"|"Perdida"|null,
  "contactos": string | null,
  "notas": string | null,
  "cursoNombre": string | null,
  "cursoFecha": "YYYY-MM-DD" | null,
  "cursoModalidad": "Online"|"Presencial"|"Híbrido"|null,
  "cursoCupos": number | null,
  "cursoInscritos": number | null
}

Reglas estrictas:
1. Devuelve SOLO el objeto JSON. Sin ningún texto adicional.
2. Valores monetarios → número entero: "490 mil"→490000, "1,5 millones"→1500000, "490 lucas"→490000, "490k"→490000.
3. Fechas relativas: usa la fecha actual del mensaje como referencia ("la próxima semana", "en 3 días", etc.).
4. Si no se menciona un campo: null.
5. Infiere "tipo": "curso"/"capacitación"/"alumnos"/"cupos" → "Academia"; "consultoría"/"asesoría" → "Consultoría"; "AURA" → "AURA".
6. "lucas" = miles de pesos chilenos (CLP).
7. Preserva nombres de empresas tal como se dictan (sin corregir mayúsculas ni abreviar).`;

exports.parseDictation = onCall(
  { region: 'us-central1' },
  async (request) => {
    const { transcript, today } = request.data || {};

    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      throw new Error('transcript requerido');
    }
    if (transcript.length > 2000) {
      throw new Error('transcript demasiado largo (máx. 2000 caracteres)');
    }

    const fechaHoy = today || new Date().toISOString().slice(0, 10);
    const apiKey   = process.env.GEMINI_API_KEY;
    const model    = 'gemini-2.0-flash';
    const url      = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DICTATION_SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Fecha de hoy: ${fechaHoy}\n\nTexto dictado: "${transcript}"` }],
        }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logger.error('Gemini API error', { status: response.status, body: errBody });
      throw new Error(`Error al contactar la IA (${response.status})`);
    }

    const body = await response.json();
    const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';

    // Tolerante: extrae el primer objeto JSON aunque la IA añada texto extra
    const match = rawText.match(/\{[\s\S]*\}/);
    try {
      return match ? JSON.parse(match[0]) : {};
    } catch (parseErr) {
      logger.error('JSON parse error en respuesta IA', { rawText });
      return {};
    }
  }
);
