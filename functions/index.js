// Cloud Functions para SonqollayAPP
// - dailyFollowUpReminders: corre todos los días 09:00 America/Santiago
//   y envía push FCM por cada cotización cuyo "seguimiento" sea hoy,
//   esté vencido (no Adjudicada/Perdida) o caiga dentro de los próximos 3 días.
// - onQuoteSeguimientoToday: dispara push al instante si se crea/edita
//   una cotización con seguimiento = hoy.
// - notifyOnNewQuote: notifica al crear una cotización nueva.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

// ---------- Helpers ----------
function todayISO(tz = 'America/Santiago') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function formatCLP(v) {
  if (v == null || v === '' || isNaN(v)) return '—';
  return '$ ' + Number(v).toLocaleString('es-CL');
}

async function getUserTokens(uid) {
  const snap = await db.collection('users').doc(uid).collection('fcmTokens').get();
  return snap.docs.map(d => ({ id: d.id, token: d.data().token || d.id }));
}

async function sendToUser(uid, notification, data = {}) {
  const tokens = await getUserTokens(uid);
  if (!tokens.length) return { sent: 0, removed: 0 };

  const message = {
    tokens: tokens.map(t => t.token),
    notification,
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    webpush: {
      fcmOptions: { link: '/' },
      notification: { icon: '/icon.svg', badge: '/icon.svg' },
    },
  };

  const res = await getMessaging().sendEachForMulticast(message);

  // Limpieza de tokens inválidos
  const toDelete = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument') {
        toDelete.push(tokens[i].id);
      } else {
        logger.warn('Fallo enviando a token', tokens[i].id, code);
      }
    }
  });
  if (toDelete.length) {
    const batch = db.batch();
    toDelete.forEach(id => batch.delete(db.collection('users').doc(uid).collection('fcmTokens').doc(id)));
    await batch.commit();
  }

  return { sent: res.successCount, removed: toDelete.length };
}

// ---------- 1) Recordatorio diario de seguimientos ----------
exports.dailyFollowUpReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago', region: 'us-central1' },
  async () => {
    const today = todayISO();
    const usersSnap = await db.collection('users').get();
    logger.info(`Verificando seguimientos · ${today} · ${usersSnap.size} usuarios`);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const quotesSnap = await db.collection('users').doc(uid).collection('quotes')
        .where('seguimiento', '>', '').get();

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
      if (!total) continue;

      const lines = [];
      if (buckets.hoy.length) {
        lines.push(`📌 Hoy: ${buckets.hoy.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);
      }
      if (buckets.vencidos.length) {
        lines.push(`⚠ Vencidos: ${buckets.vencidos.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);
      }
      if (buckets.proximos.length) {
        lines.push(`🔜 En 1-3 días: ${buckets.proximos.map(q => `${q.numero} (${q.empresa})`).join(', ')}`);
      }

      const title = buckets.hoy.length
        ? `Seguimientos para hoy (${buckets.hoy.length})`
        : buckets.vencidos.length
          ? `Seguimientos vencidos (${buckets.vencidos.length})`
          : `Próximos seguimientos (${buckets.proximos.length})`;

      const result = await sendToUser(uid, {
        title,
        body: lines.join('\n'),
      }, { kind: 'follow_up_digest', total });

      logger.info(`Usuario ${uid}: enviadas ${result.sent}, tokens limpiados ${result.removed}`);
    }
  }
);

// ---------- 2) Aviso instantáneo al guardar con seguimiento = hoy ----------
exports.onQuoteSeguimientoToday = onDocumentWritten(
  { document: 'users/{uid}/quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.data();
    const before = event.data && event.data.before && event.data.before.data();
    if (!after) return; // borrado

    const today = todayISO();
    if (after.seguimiento !== today) return;
    // Solo si cambió a hoy o es nuevo
    if (before && before.seguimiento === after.seguimiento) return;

    const { uid } = event.params;
    await sendToUser(uid, {
      title: `Seguimiento HOY · ${after.numero}`,
      body: `${after.empresa} — ${after.descripcion || ''}`.slice(0, 200),
    }, { kind: 'follow_up_today', quoteId: event.params.quoteId });
  }
);

// ---------- 3) Aviso al crear cotización ----------
exports.notifyOnNewQuote = onDocumentWritten(
  { document: 'users/{uid}/quotes/{quoteId}', region: 'us-central1' },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (before || !after) return; // solo creación

    const { uid } = event.params;
    await sendToUser(uid, {
      title: `Nueva cotización · ${after.numero}`,
      body: `${after.empresa} — ${formatCLP(after.valor)}`,
    }, { kind: 'new_quote', quoteId: event.params.quoteId });
  }
);
