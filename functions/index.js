// Cloud Functions para SonqollayAPP
// Cotizaciones y clientes son compartidos (colecciones globales).
// Las notificaciones push se envían a todos los usuarios con tokens registrados.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
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
      fcmOptions: { link: '/' },
      notification: { icon: '/logo.png', badge: '/logo.png' },
    },
  };

  const res = await getMessaging().sendEachForMulticast(message);

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

// ---------- 3) Aviso al crear cotización ----------
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
