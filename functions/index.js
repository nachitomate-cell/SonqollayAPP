// Cloud Functions para SonqollayAPP
// Cotizaciones y clientes son compartidos (colecciones globales).
// Las notificaciones push se envían a todos los usuarios con tokens registrados.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
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
    const prefs = userDoc.data().notifPrefs || {};
    return tokensSnap.docs.map(d => ({ id: d.id, uid: userDoc.id, token: d.data().token || d.id, prefs }));
  }));
  return perUser.flat();
}

// Mapea cada tipo de notificación (data.kind) a la categoría que el usuario puede
// activar/desactivar desde Ajustes → Notificaciones. Si la categoría está en false
// para ese usuario, no se le envía. Sin preferencia guardada = recibe todo (default).
const KIND_CATEGORY = {
  chat: 'chat',
  chat_admin: 'chatAdmin',
  new_quote: 'cotizaciones', quote_estado: 'cotizaciones', quote_note: 'cotizaciones', new_client: 'cotizaciones',
  follow_up_digest: 'seguimientos', follow_up_today: 'seguimientos', seguimiento_scheduled: 'seguimientos', quote_expiry: 'seguimientos',
  academia: 'academia',
  task_new: 'tareas', task_due: 'tareas',
  approval_request: 'aprobaciones', approval_result: 'aprobaciones',
  admin_broadcast: 'avisos',
};

// Divide un array en lotes del tamaño indicado
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// opts.excludeUid → no notifica al usuario que originó el cambio (evita auto-aviso)
// opts.onlyUid    → envía SOLO a los dispositivos de ese usuario (segmentación)
async function sendToAll(notification, data = {}, opts = {}) {
  let tokens = await getAllTokens();
  if (opts.onlyUid) tokens = tokens.filter(t => t.uid === opts.onlyUid);
  if (opts.onlyUids && opts.onlyUids.length) {
    const set = new Set(opts.onlyUids);
    tokens = tokens.filter(t => set.has(t.uid));
  }
  if (opts.excludeUid) tokens = tokens.filter(t => t.uid !== opts.excludeUid);
  // Respetar las preferencias de notificación del usuario según el tipo de aviso
  const cat = KIND_CATEGORY[data.kind];
  if (cat) tokens = tokens.filter(t => t.prefs?.[cat] !== false);
  if (!tokens.length) return { sent: 0, removed: 0 };

  // Mensaje SOLO de datos: el service worker (firebase-messaging-sw.js) arma y muestra
  // la notificación en onBackgroundMessage. Es el patrón confiable para Web Push / PWA
  // (incluido iOS) y evita la ambigüedad del auto-display del SDK cuando hay un
  // onBackgroundMessage definido (que dejaba notificaciones sin mostrar).
  const base = {
    data: {
      title: notification.title || 'SonqollayAPP',
      body: notification.body || '',
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: '/' },
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
async function runFollowUpDigest() {
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

// Recordatorio de seguimientos: dos envíos diarios, 09:00 y 18:00 (hora de Chile).
exports.dailyFollowUpReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  runFollowUpDigest
);
exports.eveningFollowUpReminders = onSchedule(
  { schedule: '0 18 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  runFollowUpDigest
);

// ---------- Academia: recordatorios de reuniones/clases (15 min antes + el mismo día) ----------
function fmtHoraCL(date) {
  return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
}
function sameDayCL(a, b) {
  const f = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  return f(a) === f(b);
}
function hourCL(date) {
  const h = date.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Santiago' });
  return parseInt(h, 10) || 0;
}

exports.academiaReminders = onSchedule(
  { schedule: '*/5 * * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const now = new Date();
    const in15 = new Date(now.getTime() + 15 * 60000);
    const fromBuffer = Timestamp.fromDate(new Date(now.getTime() - 60 * 60000));
    const dayAhead = Timestamp.fromDate(new Date(now.getTime() + 24 * 60 * 60000));
    let snap;
    try {
      snap = await db.collection('academiaEventos')
        .where('fechaHora', '>=', fromBuffer)
        .where('fechaHora', '<=', dayAhead)
        .get();
    } catch (e) { logger.error('academiaReminders query', e); return; }

    for (const docSnap of snap.docs) {
      const ev = docSnap.data();
      if (!ev.fechaHora || !ev.fechaHora.toDate) continue;
      const when = ev.fechaHora.toDate();
      const tipo = ev.tipo || 'Reunión';
      const titulo = ev.titulo || '(sin título)';
      const desc = ev.descripcion ? ' · ' + ev.descripcion : '';
      // Segmentación: si el evento es solo para participantes seleccionados, avisar
      // únicamente a esos usuarios. Si participantesTodos !== false → a todos.
      const soloSeleccion = ev.participantesTodos === false && Array.isArray(ev.participantes);
      const targetOpts = soloSeleccion ? { onlyUids: ev.participantes } : {};
      // Sin participantes asignados no hay a quién avisar: marca como notificado y sigue.
      if (soloSeleccion && !ev.participantes.length) {
        try { await docSnap.ref.update({ notifiedDay: true, notified15: true }); } catch (e) { /* noop */ }
        continue;
      }
      try {
        // Aviso "el mismo día" (a partir de las 08:00 de Chile, una sola vez)
        if (!ev.notifiedDay && when > now && sameDayCL(when, now) && hourCL(now) >= 8) {
          await sendToAll(
            { title: `📅 Hoy ${tipo.toLowerCase()}: ${titulo}`, body: `A las ${fmtHoraCL(when)}${desc}` },
            { kind: 'academia', eventoId: docSnap.id },
            targetOpts
          );
          await docSnap.ref.update({ notifiedDay: true });
        }
        // Aviso 15 minutos antes
        if (!ev.notified15 && when > now && when <= in15) {
          await sendToAll(
            { title: `⏰ ${tipo} en 15 min: ${titulo}`, body: `Comienza a las ${fmtHoraCL(when)}${desc}` },
            { kind: 'academia', eventoId: docSnap.id },
            targetOpts
          );
          await docSnap.ref.update({ notified15: true });
        }
      } catch (e) { logger.error('academiaReminders send', docSnap.id, e); }
    }
  }
);

// ---------- Recordatorio: cotizaciones por vencer (push al dueño ~3 días antes) ----------
exports.quoteExpiryReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const today = todayISO();
    let snap;
    try { snap = await db.collection('quotes').get(); } catch (e) { logger.error('quoteExpiry query', e); return; }
    for (const docSnap of snap.docs) {
      const q = docSnap.data();
      if (q.deleted || q.notifiedVencimiento || !q.fecha || !q.createdBy) continue;
      const estado = (q.estado || '').toLowerCase();
      if (estado === 'adjudicada' || estado === 'perdida') continue;
      const validez = Number(q.validezDias) || 30;
      let dleft;
      try { dleft = daysBetween(today, addDaysISO(q.fecha, validez)); } catch { continue; }
      if (dleft < 0 || dleft > 3) continue;
      const cuando = dleft === 0 ? 'vence hoy' : (dleft === 1 ? 'vence mañana' : `vence en ${dleft} días`);
      try {
        await sendToAll(
          { title: `⏳ Cotización ${q.numero || ''} ${cuando}`, body: `${q.empresa || ''} · revisa antes de que caduque su validez.` },
          { kind: 'quote_expiry', quoteId: docSnap.id },
          { onlyUid: q.createdBy }
        );
        await docSnap.ref.update({ notifiedVencimiento: true });
      } catch (e) { logger.error('quoteExpiry send', docSnap.id, e); }
    }
  }
);

// ---------- Papelera: purga definitiva a los 30 días ----------
exports.purgeTrash = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const cutoffMs = Date.now() - 30 * 86400000;
    for (const col of ['quotes', 'clients']) {
      try {
        const snap = await db.collection(col).where('deleted', '==', true).get();
        const batch = db.batch();
        let n = 0;
        snap.docs.forEach(d => {
          const dd = d.data().deletedAt;
          if (dd && dd.toMillis && dd.toMillis() <= cutoffMs) { batch.delete(d.ref); n++; }
        });
        if (n) { await batch.commit(); logger.info(`purgeTrash: ${n} de ${col}`); }
      } catch (e) { logger.error('purgeTrash', col, e); }
    }
  }
);

// ---------- Chat del equipo: avisa a los demás miembros ----------
exports.onChatMessage = onDocumentCreated(
  { document: 'chatMensajes/{id}', region: 'us-central1' },
  async (event) => {
    const m = event.data && event.data.data();
    if (!m || !m.text) return;
    const autor = (m.displayName || 'Equipo').split(' ')[0];
    const body = m.text ? String(m.text).slice(0, 140)
      : m.imageUrl ? '📷 Imagen'
      : m.quoteRef ? `📄 Cotización ${m.quoteRef.numero || ''}`.trim()
      : 'Nuevo mensaje';
    try {
      await sendToAll(
        { title: `💬 ${autor}`, body },
        { kind: 'chat' },
        { excludeUid: m.uid } // no notificar a quien lo envió
      );
    } catch (e) { logger.error('onChatMessage', e); }
  }
);

// uids de administradores (isAdmin==true o el dueño por email)
async function getAdminUids() {
  const snap = await db.collection('users').get();
  return snap.docs
    .filter(d => d.data().isAdmin === true || d.data().email === 'ignaciiio.mate@gmail.com')
    .map(d => d.id);
}

// ---------- Chat de admins: avisa solo a los demás administradores ----------
exports.onAdminChatMessage = onDocumentCreated(
  { document: 'chatMensajesAdmin/{id}', region: 'us-central1' },
  async (event) => {
    const m = event.data && event.data.data();
    if (!m || !m.text) return;
    const autor = (m.displayName || 'Admin').split(' ')[0];
    const body = m.text ? String(m.text).slice(0, 140)
      : m.imageUrl ? '📷 Imagen'
      : m.quoteRef ? `📄 Cotización ${m.quoteRef.numero || ''}`.trim()
      : 'Nuevo mensaje';
    try {
      const adminUids = await getAdminUids();
      await sendToAll(
        { title: `🔒 Admins · ${autor}`, body },
        { kind: 'chat_admin' },
        { onlyUids: adminUids, excludeUid: m.uid }
      );
    } catch (e) { logger.error('onAdminChatMessage', e); }
  }
);

// ---------- Tareas asignadas: aviso al asignar y recordatorio de vencimiento ----------
exports.onTaskCreated = onDocumentCreated(
  { document: 'tareas/{id}', region: 'us-central1' },
  async (event) => {
    const t = event.data && event.data.data();
    if (!t || !t.asignadoA) return;
    const venceTxt = t.vence ? ` · vence ${t.vence}` : '';
    try {
      await sendToAll(
        { title: '📋 Nueva tarea asignada', body: `${String(t.titulo || 'Tarea').slice(0, 120)}${venceTxt}` },
        { kind: 'task_new' },
        { onlyUid: t.asignadoA }
      );
    } catch (e) { logger.error('onTaskCreated', e); }
  }
);

// Recordatorio diario (09:00 Chile): tareas pendientes que vencen hoy o ya vencidas
exports.taskDueReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const today = todayISO();
    try {
      const snap = await db.collection('tareas').where('estado', '==', 'pendiente').get();
      for (const d of snap.docs) {
        const t = d.data();
        if (!t.asignadoA || !t.vence || t.vence > today) continue;
        const overdue = t.vence < today;
        await sendToAll(
          { title: overdue ? '⏰ Tarea vencida' : '📋 Tarea para hoy', body: String(t.titulo || 'Tarea').slice(0, 140) },
          { kind: 'task_due' },
          { onlyUid: t.asignadoA }
        );
      }
    } catch (e) { logger.error('taskDueReminders', e); }
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

    // --- Aprobación de cotizaciones (usuarios supervisados) ---
    const befA = before && before.approval && before.approval.status;
    const aftA = after.approval && after.approval.status;
    if (aftA === 'pending' && befA !== 'pending') {
      // Nueva solicitud → avisar a los administradores
      try {
        const adminUids = await getAdminUids();
        await sendToAll(
          { title: `🔔 Aprobación pendiente · ${after.numero}`,
            body: `${after.approval.byName || 'Un usuario'} solicita marcar "${after.approval.estado}" · ${after.empresa}` },
          { kind: 'approval_request', quoteId },
          { onlyUids: adminUids, excludeUid: after.approval.by }
        );
      } catch (e) { logger.error('approval_request', e); }
      return;
    }
    if (befA === 'pending' && (aftA === 'approved' || aftA === 'rejected')) {
      // Resuelta → avisar a quien la solicitó
      const to = (before.approval && before.approval.by) || (after.approval && after.approval.by);
      const msg = aftA === 'approved'
        ? { title: `✅ Aprobado · ${after.numero}`, body: `Tu cambio a "${after.approval.estado}" fue aprobado · ${after.empresa}` }
        : { title: `🚫 Rechazado · ${after.numero}`, body: `Tu solicitud fue rechazada${after.approval && after.approval.motivo ? ': ' + after.approval.motivo : ''} · ${after.empresa}` };
      try { if (to) await sendToAll(msg, { kind: 'approval_result', quoteId }, { onlyUid: to }); }
      catch (e) { logger.error('approval_result', e); }
      return; // no duplicar con el push genérico de cambio de estado
    }

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
// Soporta segmentación (target = 'all' | uid) y programación (scheduledFor).
async function deliverBroadcast(ref, data) {
  const onlyUids = Array.isArray(data.targets) && data.targets.length ? data.targets : null;
  const onlyUid = (!onlyUids && data.target && data.target !== 'all') ? data.target : null;
  const result = await sendToAll(
    { title: data.title, body: data.body || '' },
    { kind: 'admin_broadcast' },
    { onlyUid, onlyUids }
  );
  await ref.update({ status: 'sent', sent: result.sent, removedTokens: result.removed, sentAt: new Date() });
  logger.info(`Broadcast enviado · target=${data.target || 'all'} · ${result.sent} tokens · ${result.removed} limpiados`);
  return result;
}

exports.onAdminBroadcast = onDocumentWritten(
  { document: 'adminBroadcasts/{id}', region: 'us-central1' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    const before = event.data && event.data.before && event.data.before.data();
    if (before || !after) return; // solo en creación
    if (!after.title) return;

    // Programada a futuro → no enviar ahora; la enviará sendScheduledBroadcasts.
    const sched = after.scheduledFor && after.scheduledFor.toDate ? after.scheduledFor.toDate() : null;
    if (sched && sched.getTime() > Date.now() + 30000) {
      if (after.status !== 'scheduled') await event.data.after.ref.update({ status: 'scheduled' });
      logger.info(`Broadcast programado para ${sched.toISOString()}`);
      return;
    }
    await deliverBroadcast(event.data.after.ref, after);
  }
);

// ---------- 3b) Envío de broadcasts programados (cada 5 min) ----------
exports.sendScheduledBroadcasts = onSchedule(
  { schedule: '*/5 * * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const snap = await db.collection('adminBroadcasts').where('status', '==', 'scheduled').get();
    if (snap.empty) return;
    const now = Date.now();
    const due = snap.docs.filter(d => {
      const sf = d.data().scheduledFor;
      const t = sf && sf.toDate ? sf.toDate() : null;
      return t && t.getTime() <= now;
    });
    for (const doc of due) {
      try { await deliverBroadcast(doc.ref, doc.data()); }
      catch (e) { logger.error('Error enviando broadcast programado', doc.id, e); }
    }
    if (due.length) logger.info(`Broadcasts programados enviados: ${due.length}`);
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
  { region: 'us-central1', secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    // Solo el equipo autenticado puede invocar la IA (evita abuso de la cuota de Gemini)
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    // Mismo modelo que las reglas: dueño, admin o usuario aprobado.
    const email = (request.auth.token && request.auth.token.email) || '';
    let allowed = email === 'ignaciiio.mate@gmail.com';
    if (!allowed) {
      const uSnap = await db.collection('users').doc(request.auth.uid).get();
      const ud = uSnap.exists ? uSnap.data() : {};
      allowed = ud.isAdmin === true || ud.approved === true;
    }
    if (!allowed) {
      throw new HttpsError('permission-denied', 'Tu acceso está pendiente de aprobación por un administrador.');
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
    if (!apiKey) {
      logger.error('GEMINI_API_KEY no configurada');
      throw new HttpsError('failed-precondition', 'La IA no está configurada (falta la API key de Gemini).');
    }
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
