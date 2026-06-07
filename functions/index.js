// Cloud Functions para SonqollayAPP
// Cotizaciones y clientes son compartidos (colecciones globales).
// Las notificaciones push se envían a todos los usuarios con tokens registrados.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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

// Días desde la última actividad (updatedAt) o, en su defecto, la fecha de la cotización.
// Réplica de la lógica del dashboard (app.js) para "Sin respuesta +N días".
function daysSinceUpdated(q) {
  const ms = q.updatedAt && q.updatedAt.toDate ? q.updatedAt.toDate().getTime()
    : q.fecha ? new Date(q.fecha + 'T00:00:00Z').getTime()
    : null;
  if (ms == null) return 0;
  return Math.round((Date.now() - ms) / 86400000);
}

// Obtiene todos los tokens FCM de todos los usuarios.
// Lecturas de subcolecciones en paralelo (antes era N+1 secuencial: 1 get por usuario).
async function getAllTokens() {
  const usersSnap = await db.collection('users').get();
  const perUser = await Promise.all(usersSnap.docs.map(async (userDoc) => {
    const tokensSnap = await userDoc.ref.collection('fcmTokens').get();
    return tokensSnap.docs.map(d => ({ id: d.id, uid: userDoc.id, token: d.data().token || d.id }));
  }));
  return perUser.flat();
}

// Divide un array en lotes del tamaño indicado
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// opts.excludeUid → no notifica al usuario que originó el cambio (evita auto-aviso)
async function sendToAll(notification, data = {}, opts = {}) {
  let tokens = await getAllTokens();
  if (opts.excludeUid) tokens = tokens.filter(t => t.uid !== opts.excludeUid);
  if (!tokens.length) return { sent: 0, removed: 0 };

  const base = {
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

  // FCM admite máx. 500 tokens por sendEachForMulticast → enviar por lotes
  let sent = 0;
  const toDelete = [];
  for (const batch of chunk(tokens, 500)) {
    const res = await getMessaging().sendEachForMulticast({ ...base, tokens: batch.map(t => t.token) });
    sent += res.successCount;
    res.responses.forEach((r, i) => {
      const t = batch[i];
      if (r.success) {
        logger.info(`OK token ${t.id.slice(0,20)} uid=${t.uid} msgId=${r.messageId}`);
      } else {
        const code = r.error && r.error.code;
        logger.warn(`FAIL token ${t.id.slice(0,20)} uid=${t.uid} code=${code} msg=${r.error?.message}`);
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument') {
          toDelete.push(t);
        }
      }
    });
  }

  // Limpiar tokens inválidos (batch de Firestore: máx. 500 operaciones)
  for (const group of chunk(toDelete, 500)) {
    const batch = db.batch();
    group.forEach(t => batch.delete(
      db.collection('users').doc(t.uid).collection('fcmTokens').doc(t.id)
    ));
    await batch.commit();
  }

  return { sent, removed: toDelete.length };
}

// ---------- 1) Recordatorio diario de pendientes (vencidos + hoy + próximos + sin respuesta) ----------
// Espeja las urgencias del dashboard (app.js → renderHoyUrgente):
//   • Vencidos: seguimiento ya pasó (CUALQUIER antigüedad, sin tope de 14 días).
//   • Hoy / Próximos (1-3 días).
//   • Sin respuesta +14 días: Enviada/En revisión sin actividad reciente (aunque no tengan seguimiento).
exports.dailyFollowUpReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const today = todayISO();
    const threeDaysFromNow = addDaysISO(today, 3);
    const isOpen = (q) => {
      const e = (q.estado || '').toLowerCase();
      return e !== 'adjudicada' && e !== 'perdida';
    };

    // 1) Seguimientos con fecha hasta +3 días → incluye TODOS los vencidos (sin piso de -14 días)
    const segSnap = await db.collection('quotes')
      .where('seguimiento', '<=', threeDaysFromNow)
      .get();

    const buckets = { hoy: [], proximos: [], vencidos: [] };
    const seen = new Set();
    segSnap.forEach(d => {
      const q = d.data();
      if (!q.seguimiento || !isOpen(q)) return;
      const diff = daysBetween(today, q.seguimiento);
      if (diff === 0)      buckets.hoy.push(q);
      else if (diff > 0)   buckets.proximos.push(q);   // acotado a +3 por la consulta
      else                 buckets.vencidos.push(q);   // diff < 0 → vencida, cualquier antigüedad
      seen.add(d.id);
    });

    // 2) Sin respuesta +14 días (Enviada / En revisión sin actividad), evitando duplicar las ya listadas
    const staleSnap = await db.collection('quotes')
      .where('estado', 'in', ['Enviada', 'En revisión'])
      .get();
    const sinRespuesta = [];
    staleSnap.forEach(d => {
      if (seen.has(d.id)) return;
      const q = d.data();
      if (daysSinceUpdated(q) >= 14) sinRespuesta.push(q);
    });

    const total = buckets.hoy.length + buckets.proximos.length + buckets.vencidos.length + sinRespuesta.length;
    if (!total) { logger.info(`Sin pendientes · ${today}`); return; }

    const fmtList = arr => arr.map(q => `${q.numero} (${q.empresa})`).join(', ');
    const lines = [];
    if (buckets.vencidos.length) lines.push(`⚠️ Atrasadas: ${fmtList(buckets.vencidos)}`);
    if (buckets.hoy.length)      lines.push(`📌 Hoy: ${fmtList(buckets.hoy)}`);
    if (buckets.proximos.length) lines.push(`🔜 En 1-3 días: ${fmtList(buckets.proximos)}`);
    if (sinRespuesta.length)     lines.push(`🕒 Sin respuesta +14d: ${fmtList(sinRespuesta)}`);

    // Prioridad del título: atrasadas > hoy > sin respuesta > próximos
    const title = buckets.vencidos.length
      ? `⚠️ ${buckets.vencidos.length} cotización${buckets.vencidos.length !== 1 ? 'es' : ''} atrasada${buckets.vencidos.length !== 1 ? 's' : ''}`
      : buckets.hoy.length
        ? `Seguimientos para hoy (${buckets.hoy.length})`
        : sinRespuesta.length
          ? `${sinRespuesta.length} sin respuesta +14 días`
          : `Próximos seguimientos (${buckets.proximos.length})`;

    const result = await sendToAll(
      { title, body: lines.join('\n') },
      { kind: 'follow_up_digest', total, vencidos: buckets.vencidos.length, sinRespuesta: sinRespuesta.length }
    );
    logger.info(`Digest · vencidos=${buckets.vencidos.length} hoy=${buckets.hoy.length} prox=${buckets.proximos.length} sinResp=${sinRespuesta.length} · enviadas ${result.sent}`);
  }
);

// ---------- 2) Notificaciones sobre cotizaciones (trigger único consolidado) ----------
// Un solo trigger por escritura: evita la tormenta de push duplicadas (antes 5 funciones
// sobre el mismo path) y reduce las lecturas de tokens de 5-6 a 1 por guardado.
// Se envía como máximo UNA notificación por escritura, según prioridad:
//   creación > cambio de estado > seguimiento (hoy/programado) > nota nueva.
const ESTADO_ICONS = { Adjudicada: '🎉', Perdida: '❌', Enviada: '📤', 'En revisión': '🔍', Borrador: '📝' };

exports.onQuoteWritten = onDocumentWritten(
  { document: 'quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after) return; // borrado: nada que notificar

    const quoteId = event.params.quoteId;
    // No notificar a quien originó el cambio
    const actorUid = after.updatedBy || after.createdBy || null;
    const send = (notification, data) =>
      sendToAll(notification, { ...data, quoteId }, { excludeUid: actorUid });

    // --- Creación ---
    if (!before) {
      await send({
        title: `Nueva cotización · ${after.numero}`,
        body: `${after.empresa} — ${formatCLP(after.valor)}`,
      }, { kind: 'new_quote' });
      return;
    }

    const today = todayISO();

    // --- Cambio de estado (máxima prioridad) ---
    if ((before.estado || '') !== (after.estado || '')) {
      const icon = ESTADO_ICONS[after.estado] || '📋';
      await send({
        title: `${icon} ${after.numero} → ${after.estado}`,
        body: `${after.empresa}${after.descripcion ? ' · ' + after.descripcion.slice(0, 80) : ''}`,
      }, { kind: 'quote_estado' });
      return;
    }

    // --- Cambio de fecha de seguimiento ---
    const prevSeg = before.seguimiento || '';
    const newSeg  = after.seguimiento  || '';
    if (newSeg && newSeg !== prevSeg) {
      if (newSeg === today) {
        await send({
          title: `Seguimiento HOY · ${after.numero}`,
          body: `${after.empresa} — ${after.descripcion || ''}`.slice(0, 200),
        }, { kind: 'follow_up_today' });
        return;
      }
      if (newSeg > today) {
        const days = daysBetween(today, newSeg);
        await send({
          title: `Seguimiento programado · ${after.numero}`,
          body: `${after.empresa} · en ${days} día${days !== 1 ? 's' : ''} (${newSeg})`,
        }, { kind: 'seguimiento_scheduled' });
        return;
      }
    }

    // --- Nota nueva (las notas se agregan al final con separador \n) ---
    const prevNotas = (before.notas || '').trim();
    const newNotas  = (after.notas  || '').trim();
    if (newNotas && newNotas.length > prevNotas.length) {
      const added = newNotas.startsWith(prevNotas)
        ? newNotas.slice(prevNotas.length).trim()
        : newNotas;
      const noteText = added.replace(/^\[\d{2} \w+ \d{4} \d{2}:\d{2}\]\s*/, '').slice(0, 120);
      if (noteText) {
        await send({
          title: `Nota en ${after.numero} · ${after.empresa}`,
          body: noteText,
        }, { kind: 'quote_note' });
      }
    }
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

// ---------- 4) Aviso al crear cliente ----------
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
      { kind: 'new_client', clientId: event.params.clientId },
      { excludeUid: after.createdBy || after.updatedBy || null }
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
    // Solo el equipo autenticado puede invocar la IA (evita abuso de la cuota de Gemini)
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const email = (request.auth.token && request.auth.token.email) || '';
    const emailVerified = !!(request.auth.token && request.auth.token.email_verified);
    const isTeam = email === 'ignaciiio.mate@gmail.com' ||
      (emailVerified && /^[^@]+@sonqollay\.cl$/i.test(email));
    if (!isTeam) {
      throw new HttpsError('permission-denied', 'Acceso restringido al equipo.');
    }

    const { transcript, today } = request.data || {};

    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'transcript requerido');
    }
    if (transcript.length > 2000) {
      throw new HttpsError('invalid-argument', 'transcript demasiado largo (máx. 2000 caracteres)');
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
