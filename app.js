// SonqollayAPP - Firestore + FCM + Google Auth
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, onSnapshot, setDoc, deleteDoc,
  serverTimestamp, query, orderBy, limit, writeBatch, getDocs, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  getMessaging, getToken, onMessage, isSupported
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js';
import {
  getAnalytics, isSupported as analyticsSupported
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';
import {
  getFunctions, httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { firebaseConfig, VAPID_KEY } from './firebase-config.js';
import {
  formatCLP, formatCLPShort, parseValor, formatDate, daysUntil, daysSinceUpdated,
  nextVersionNumero, escapeHtml, getSeguimientoStatus, generateICS, fmtDuration, timeAgo,
} from './lib/format.js';
import { seedQuotes } from './lib/seed-data.js';
import { getRates, cachedUf } from './lib/indicadores.js';
import { startAppTour, tourSeen } from './lib/tour.js';

// ---------- Init Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const dbf = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const googleProvider = new GoogleAuthProvider();
const fbFunctions = getFunctions(app, 'us-central1');

analyticsSupported().then(ok => { if (ok) getAnalytics(app); }).catch(() => {});

// ---------- Helpers ----------
// Datos demo del sembrado → ./lib/seed-data.js · Helpers puros → ./lib/format.js
// IDs sin colisiones: crypto.randomUUID() en contexto seguro (PWA https/localhost);
// fallback solo por compatibilidad con navegadores muy antiguos.
const uid = () => (self.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function getVersionFamily(q) {
  const rootId = q.parentId || q.id;
  return quotes.filter(x => x.id === rootId || x.parentId === rootId)
    .sort((a, b) => (a.version || 1) - (b.version || 1));
}

function downloadICS(q) {
  const content = generateICS(q);
  if (!content) { showToast('Sin fecha de seguimiento'); return; }
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seg_${(q.numero || 'cot').replace(/[^a-zA-Z0-9_-]/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Archivo .ics descargado · ábrelo para agregar al calendario');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}

let _autoTourDone = false;
function hideSplash() {
  const el = document.getElementById('splashScreen');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hiding');
  setTimeout(() => el.classList.add('hidden'), 350);
  // Auto-arranque del tutorial la primera vez que un usuario entra
  if (!_autoTourDone && !tourSeen()) {
    _autoTourDone = true;
    setTimeout(() => { try { startAppTour(TOUR_STEPS); } catch (_) {} }, 1000);
  }
}

function skeletonCards(n = 3) {
  const widths = [[68, 52, 38], [62, 59, 38], [74, 45, 38], [56, 66, 38], [70, 50, 38]];
  return Array.from({ length: n }, (_, i) => {
    const [w1, w2] = widths[i % widths.length];
    const d = (i * 0.08).toFixed(2);
    return `<div class="skeleton-card" style="animation-delay:${d}s">
      <div class="skeleton-row" style="justify-content:space-between;margin-bottom:8px">
        <div class="skeleton-line" style="width:${w1}%;height:14px"></div>
        <div class="skeleton-pill"></div>
      </div>
      <div class="skeleton-line" style="width:${w2}%;animation-delay:${(i*0.08+0.1).toFixed(2)}s"></div>
      <div class="skeleton-line" style="width:40%;animation-delay:${(i*0.08+0.2).toFixed(2)}s;margin-top:4px"></div>
    </div>`;
  }).join('');
}

function skeletonClientCards(n = 4) {
  const widths = [[70, 55], [65, 60], [75, 50], [68, 58]];
  return Array.from({ length: n }, (_, i) => {
    const [w1, w2] = widths[i % widths.length];
    const d = (i * 0.08).toFixed(2);
    return `<div class="skeleton-card" style="animation-delay:${d}s">
      <div class="skeleton-row" style="gap:10px">
        <div class="skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton-line" style="width:${w1}%;height:14px;margin-bottom:8px;animation-delay:${(i*0.08+0.05).toFixed(2)}s"></div>
          <div class="skeleton-line" style="width:${w2}%;animation-delay:${(i*0.08+0.15).toFixed(2)}s"></div>
        </div>
        <div class="skeleton-pill" style="width:48px"></div>
      </div>
    </div>`;
  }).join('');
}

function skeletonKpis() {
  return `<div class="kpis">
    ${[1,2,3].map((_, i) => `<div class="kpi">
      <div class="skeleton-line" style="width:60%;height:11px;margin-bottom:8px;animation-delay:${i*0.1}s"></div>
      <div class="skeleton-line" style="width:75%;height:26px;border-radius:8px;animation-delay:${i*0.1+0.1}s"></div>
    </div>`).join('')}
  </div>`;
}

// ─── Activity logger ───
const DEV_EMAIL = 'ignaciiio.mate@gmail.com'; // desarrollador: no ensucia el feed de actividad
async function logActivity(action, detail) {
  if (!currentUser) return;
  if (currentUser.email === DEV_EMAIL) return; // su "trabajo" se muestra aparte (sesiones/horas)
  try {
    await setDoc(doc(collection(dbf, 'activityLogs'), uid()), {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || currentUser.email || '',
      photoURL: currentUser.photoURL || '',
      action, detail: String(detail || ''),
      sessionId: _sessionId,
      timestamp: serverTimestamp(),
    });
  } catch (_) {}
}

function _flushScreenTime() {
  if (!_viewStart) return;
  const elapsed = Math.round((Date.now() - _viewStart) / 1000);
  if (['dashboard','quotes','clients','settings'].includes(_activeView))
    _screenTime[_activeView] = (_screenTime[_activeView] || 0) + elapsed;
  _viewStart = Date.now();
}

async function _writeSession(final = false) {
  if (!_sessionRef || !currentUser) return;
  _flushScreenTime();
  const duration = Math.round((Date.now() - (_sessionStart || Date.now())) / 1000);
  try {
    await setDoc(_sessionRef, {
      screenTime: { ..._screenTime }, duration,
      ...(final ? { endTime: serverTimestamp() } : {}),
    }, { merge: true });
  } catch (_) {}
}

function _scheduleFlush() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(async () => { await _writeSession(); _scheduleFlush(); }, 30000);
}

async function startActivitySession() {
  if (!currentUser) return;
  _sessionStart = Date.now();
  _viewStart = Date.now();
  _activeView = 'dashboard';
  _screenTime = { dashboard: 0, quotes: 0, clients: 0, settings: 0 };
  _sessionRef = doc(dbf, 'sessions', _sessionId);
  try {
    await setDoc(_sessionRef, {
      sessionId: _sessionId,
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || currentUser.email || '',
      photoURL: currentUser.photoURL || '',
      startTime: serverTimestamp(),
      endTime: null, duration: 0,
      screenTime: { dashboard: 0, quotes: 0, clients: 0, settings: 0 },
    });
  } catch (_) {}
  logActivity('login', '');
  _scheduleFlush();
}

async function endActivitySession() {
  clearTimeout(_flushTimer);
  if (!_sessionRef) return;
  await logActivity('logout', '');
  await _writeSession(true);
  _sessionRef = null;
}

async function checkAdminStatus() {
  try {
    const snap = await getDoc(doc(dbf, 'users', currentUser.uid));
    isAdmin = (currentUser.email === DEV_EMAIL) || (snap.exists() && snap.data().isAdmin === true);
  } catch (_) { isAdmin = (currentUser?.email === DEV_EMAIL); }
  document.getElementById('adminNavSection')?.classList.toggle('hidden', !isAdmin);
  // Para admins, el tile de Clientes se reemplaza por "Notificar usuarios" (push dirigida/masiva)
  document.getElementById('quickTilePush')?.classList.toggle('hidden', !isAdmin);
  document.getElementById('quickTileClients')?.classList.toggle('hidden', isAdmin);
  if (isAdmin) {
    getDocs(collection(dbf, 'users')).then(s => {
      const c = document.getElementById('quickCountUsers'); if (c) c.textContent = s.size;
    }).catch(() => {});
  }
}

// ─── Admin subscriptions ───
function subscribeAdmin() {
  if (unsubAdminActivity || unsubAdminSessions) return;
  const actQ = query(collection(dbf, 'activityLogs'), orderBy('timestamp', 'desc'), limit(200));
  const sesQ = query(collection(dbf, 'sessions'),     orderBy('startTime', 'desc'), limit(500));

  unsubAdminActivity = onSnapshot(actQ, snap => {
    _adminActivity = snap.docs.map(d => d.data());
    renderAdminUsers(); renderAdminActivity();
  }, err => { if (err.code === 'permission-denied') renderAdminGate(false); });

  unsubAdminSessions = onSnapshot(sesQ, snap => {
    _adminSessions = snap.docs.map(d => d.data());
    renderAdminUsers();
  }, err => { console.error('admin sessions', err); if (err.code === 'permission-denied') renderAdminGate(false); });
}

function unsubscribeAdmin() {
  if (unsubAdminActivity) { unsubAdminActivity(); unsubAdminActivity = null; }
  if (unsubAdminSessions) { unsubAdminSessions(); unsubAdminSessions = null; }
}

function renderAdminGate(hasAccess) {
  const gate    = document.getElementById('adminGate');
  const content = document.getElementById('adminContent');
  if (gate)    gate.style.display    = hasAccess ? 'none' : '';
  if (content) content.style.display = hasAccess ? ''     : 'none';
}

function renderAdminUsers() {
  const el = document.getElementById('admin-users');
  if (!el) return;
  const labels = { dashboard: 'Inicio', quotes: 'Cotizaciones', clients: 'Clientes', settings: 'Ajustes' };

  const map = {};
  _adminSessions.forEach(s => {
    if (!map[s.uid]) map[s.uid] = {
      uid: s.uid, displayName: s.displayName, email: s.email, photoURL: s.photoURL,
      sessions: 0, totalTime: 0,
      screenTime: { dashboard: 0, quotes: 0, clients: 0, settings: 0 },
      lastSeen: null,
    };
    const u = map[s.uid];
    u.sessions++;
    u.totalTime += s.duration || 0;
    ['dashboard','quotes','clients','settings'].forEach(v => { u.screenTime[v] += s.screenTime?.[v] || 0; });
    const t = s.startTime?.toDate?.();
    if (t && (!u.lastSeen || t > u.lastSeen)) u.lastSeen = t;
  });

  const users = Object.values(map).sort((a, b) => {
    const ad = (a.email || '') === DEV_EMAIL, bd = (b.email || '') === DEV_EMAIL;
    if (ad !== bd) return ad ? -1 : 1; // el desarrollador siempre arriba de todos
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
  if (!users.length) { el.innerHTML = '<div class="empty"><span>Sin sesiones registradas aún</span></div>'; return; }

  el.innerHTML = users.map(u => {
    const totalST = Object.values(u.screenTime).reduce((s, v) => s + v, 0);
    const bars = ['dashboard','quotes','clients','settings'].map(v => {
      const pct = totalST > 0 ? Math.round(u.screenTime[v] / totalST * 100) : 0;
      return `<div class="st-row">
        <span class="st-label">${labels[v]}</span>
        <div class="st-track"><div class="st-bar" style="width:${pct}%"></div></div>
        <span class="st-val">${fmtDuration(u.screenTime[v])}</span>
      </div>`;
    }).join('');
    const isDev = (u.email || '') === DEV_EMAIL;
    const actionCount = _adminActivity.filter(a => a.uid === u.uid && !['login','logout'].includes(a.action)).length;
    const init = (u.displayName || u.email || '?').trim()[0].toUpperCase();
    return `<div class="admin-user-card${isDev ? ' is-dev' : ''}">
      <div class="auc-header">
        ${u.photoURL ? `<img class="auc-avatar" src="${escapeHtml(u.photoURL)}" alt="" />`
                     : `<div class="auc-avatar auc-avatar-init">${escapeHtml(init)}</div>`}
        <div class="auc-info">
          <span class="auc-name">${escapeHtml(u.displayName || u.email)}${isDev ? ' <span class="dev-tag">🛠️ Desarrollador</span>' : ''}</span>
          <span class="auc-email">${escapeHtml(u.email)}</span>
        </div>
        <div class="auc-stats">
          <span class="auc-stat-big">${fmtDuration(u.totalTime)}</span>
          <span class="auc-stat-sm">${u.sessions} sesión${u.sessions !== 1 ? 'es' : ''}</span>
          ${u.lastSeen ? `<span class="auc-stat-sm muted">${timeAgo(u.lastSeen)}</span>` : ''}
        </div>
      </div>
      <div class="auc-st">${bars}</div>
      ${isDev ? '<div class="auc-foot">🛠️ Desarrollador — construyendo SonqollayAPP</div>'
              : (actionCount ? `<div class="auc-foot">${actionCount} acciones registradas</div>` : '')}
    </div>`;
  }).join('');
}

function renderAdminActivity() {
  const el = document.getElementById('admin-activity');
  if (!el) return;
  const cfg = {
    login:         { text: 'inició sesión',        color: 'var(--success)' },
    logout:        { text: 'cerró sesión',          color: 'var(--muted)'   },
    quote_new:     { text: 'creó cotización',       color: 'var(--accent)'  },
    quote_edit:    { text: 'editó cotización',      color: 'var(--warn)'    },
    quote_delete:  { text: 'eliminó cotización',    color: 'var(--danger)'  },
    client_new:    { text: 'creó cliente',          color: 'var(--accent)'  },
    client_edit:   { text: 'editó cliente',         color: 'var(--warn)'    },
    client_delete: { text: 'eliminó cliente',       color: 'var(--danger)'  },
  };
  const acts = _adminActivity.filter(a => (a.email || '') !== DEV_EMAIL); // el desarrollador no genera ruido
  const total = acts.length;
  const totalPages = Math.max(1, Math.ceil(total / HOME_ACT_PAGE_SIZE));
  if (_homeActPage >= totalPages) _homeActPage = totalPages - 1;
  const start = _homeActPage * HOME_ACT_PAGE_SIZE;
  const items = acts.slice(start, start + HOME_ACT_PAGE_SIZE);

  if (!total) { el.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:13px">Sin actividad registrada aún</div>'; }
  else {
    el.innerHTML = items.map(a => {
      const c = cfg[a.action] || { text: a.action, color: 'var(--muted)' };
      const when = a.timestamp?.toDate ? timeAgo(a.timestamp.toDate()) : '—';
      return `<div class="act-item">
        <div class="act-dot" style="background:${c.color}"></div>
        <div class="act-body">
          <span class="act-who">${escapeHtml(a.displayName || a.email)}</span>
          <span class="act-what">${c.text}</span>
          ${a.detail ? `<span class="act-detail">${escapeHtml(a.detail)}</span>` : ''}
        </div>
        <span class="act-time">${when}</span>
      </div>`;
    }).join('');
  }

  const pgEl = document.getElementById('admin-act-pagination');
  if (!pgEl) return;
  if (totalPages <= 1) { pgEl.innerHTML = ''; return; }
  const btns = [];
  if (_homeActPage > 0) btns.push(`<button class="hpg-btn" data-p="${_homeActPage - 1}">‹</button>`);
  for (let i = 0; i < totalPages; i++) {
    btns.push(`<button class="hpg-btn${i === _homeActPage ? ' hpg-active' : ''}" data-p="${i}">${i + 1}</button>`);
  }
  if (_homeActPage < totalPages - 1) btns.push(`<button class="hpg-btn" data-p="${_homeActPage + 1}">›</button>`);
  pgEl.innerHTML = btns.join('');
  pgEl.querySelectorAll('.hpg-btn').forEach(b => b.addEventListener('click', () => {
    _homeActPage = Number(b.dataset.p);
    renderAdminActivity();
  }));
}

// ---------- Feed de actividad reciente ----------
const AF_CFG = {
  quote_new:      { label: 'creó cotización',      color: '#f97316', group: 'quotes' },
  quote_edit:     { label: 'editó cotización',      color: '#f59e0b', group: 'quotes' },
  quote_delete:   { label: 'eliminó cotización',    color: '#ef4444', group: 'quotes' },
  quote_estado:   { label: 'cambió estado',         color: '#8b5cf6', group: 'quotes' },
  quote_note:     { label: 'agregó nota',           color: '#22c55e', group: 'notes'  },
  quote_contacto: { label: 'registró seguimiento',  color: '#06b6d4', group: 'seg'    },
  client_new:     { label: 'creó cliente',          color: '#f97316', group: 'clients'},
  client_edit:    { label: 'editó cliente',         color: '#f59e0b', group: 'clients'},
  client_delete:  { label: 'eliminó cliente',       color: '#ef4444', group: 'clients'},
};
const AF_AVATAR_COLORS = ['#f97316','#8b5cf6','#06b6d4','#22c55e','#f59e0b','#ec4899','#14b8a6','#3b82f6'];

function afAvatarColor(name) {
  const n = (name || '?').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  return AF_AVATAR_COLORS[n % AF_AVATAR_COLORS.length];
}

function afDayLabel(ts) {
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const itemDay = new Date(date); itemDay.setHours(0,0,0,0);
  const diffDays = Math.round((today - itemDay) / 86400000);
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return date.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderActivityFeed() {
  const el = document.getElementById('afList');
  if (!el) return;

  const filter = _actFeedFilter;
  const logs = _actFeedLogs.filter(a => {
    if (a.email === DEV_EMAIL) return false; // el desarrollador no aparece en el feed
    const cfg = AF_CFG[a.action];
    if (!cfg) return false;
    if (filter === 'all') return true;
    return cfg.group === filter;
  });

  if (!logs.length) {
    el.innerHTML = `<div class="empty" style="margin:32px 0">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
      <span>Sin actividad reciente</span>
    </div>`;
    return;
  }

  // Agrupar por día
  const groups = {};
  const groupOrder = [];
  logs.forEach(a => {
    if (!a.timestamp?.toDate) return;
    const dayKey = afDayLabel(a.timestamp);
    if (!groups[dayKey]) { groups[dayKey] = []; groupOrder.push(dayKey); }
    groups[dayKey].push(a);
  });

  let html = '';
  groupOrder.forEach(day => {
    html += `<div class="af-day-sep">${escapeHtml(day)}</div>`;
    groups[day].forEach(a => {
      const cfg = AF_CFG[a.action] || { label: a.action, color: 'var(--muted)', group: null };
      const when = a.timestamp?.toDate ? timeAgo(a.timestamp.toDate()) : '—';
      const who  = a.displayName || a.email || '?';
      const firstName = who.trim().split(' ')[0];
      const init = firstName[0].toUpperCase();
      const avatarBg = afAvatarColor(who);

      html += `<div class="af-item">
        <div class="af-avatar" style="background:${avatarBg}">${escapeHtml(init)}</div>
        <div class="af-body">
          <div class="af-who-row">
            <span class="af-who">${escapeHtml(firstName)}</span>
            <span class="af-action">
              <span class="af-dot" style="background:${cfg.color}"></span>${cfg.label}
            </span>
          </div>
          ${a.detail ? `<span class="af-detail">${escapeHtml(a.detail)}</span>` : ''}
        </div>
        <span class="af-time">${escapeHtml(when)}</span>
      </div>`;
    });
  });

  el.innerHTML = html;
}

function subscribeActivityFeed() {
  if (unsubActivityFeed) return;
  const q = query(collection(dbf, 'activityLogs'), orderBy('timestamp', 'desc'), limit(80));
  unsubActivityFeed = onSnapshot(q, snap => {
    _actFeedLogs = snap.docs.map(d => d.data());
    renderActivityFeed();
    // Badge: actividad más reciente posterior a la última vista
    const newest = _actFeedLogs[0]?.timestamp?.toDate?.()?.getTime() || 0;
    const badge = document.getElementById('afBadge');
    if (badge) badge.classList.toggle('hidden', !newest || newest <= _actFeedLastSeen);
  }, err => {
    console.warn('Activity feed', err);
    const el = document.getElementById('afList');
    if (el) el.innerHTML = '<div class="empty" style="margin:24px 0">No tienes permiso para ver esta sección aún.<br><small>Despliega las reglas de Firestore.</small></div>';
  });
}

function openActivityFeed() {
  subscribeActivityFeed();
  _actFeedLastSeen = Date.now();
  const badge = document.getElementById('afBadge');
  if (badge) badge.classList.add('hidden');
  document.getElementById('activityFeedSheet').classList.remove('hidden');
}

function closeActivityFeed() {
  document.getElementById('activityFeedSheet').classList.add('hidden');
}

document.getElementById('activityFeedBtn')?.addEventListener('click', openActivityFeed);
document.getElementById('afClose')?.addEventListener('click', closeActivityFeed);
document.getElementById('activityFeedSheet')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeActivityFeed();
});

document.getElementById('afFilters')?.addEventListener('click', e => {
  const btn = e.target.closest('.aff');
  if (!btn) return;
  _actFeedFilter = btn.dataset.aff;
  document.querySelectorAll('#afFilters .aff').forEach(b => b.classList.toggle('active', b === btn));
  renderActivityFeed();
});

// ---------- Estado en memoria ----------
let currentUser = null;
let quotes = [];
let clients = [];
let unsubQuotes = null;
let unsubClients = null;
let quotesLoaded = false;
let clientsLoaded = false;
let _quotesView = 'list';
let _pendingVersionParentId = null;
let _pendingVersionNum = null;

// ---------- Filtros Cotizaciones ----------
let quotesFilters = { estados: [], industria: 'all', tipo: 'all', seg: 'all', sort: 'fecha_desc' };

// ---------- Templates ----------
let templates = [];
let templatesLoaded = false;
let unsubTemplates = null;
const templatesCol = () => collection(dbf, 'templates');

// ---------- Extra Contactos por cliente ----------
let clientExtraContactos = [];

// ─── Activity tracking ───
const _sessionId = uid();
let _sessionStart = null;
let _viewStart = null;
let _activeView = 'dashboard';
let _screenTime = { dashboard: 0, quotes: 0, clients: 0, settings: 0 };
let _sessionRef = null;
let _flushTimer = null;
let isAdmin = false;
let unsubAdminActivity = null;
let unsubAdminSessions = null;
let unsubAppVersion    = null;
let unsubActivityFeed  = null;
let _actFeedLogs       = [];
let _actFeedFilter     = 'all';
let _actFeedLastSeen   = 0;
let _appVersionKnown   = null;
let _adminSessions = [];
let _adminActivity = [];
let _homeActPage = 0;
const HOME_ACT_PAGE_SIZE = 15;

// Colecciones compartidas (toda la empresa)
const quotesCol = () => collection(dbf, 'quotes');
const clientsCol = () => collection(dbf, 'clients');
const tokensCol = () => collection(doc(dbf, 'users', currentUser.uid), 'fcmTokens');

// ---------- Login screen ----------
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
}
function hideLoginScreen() {
  document.getElementById('loginScreen').classList.add('hidden');
}

document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    console.error('Google sign-in error', e);
    showToast('Error al iniciar sesión');
  }
});

// ---------- Email/Password Auth ----------
let _emailAuthMode = 'login'; // 'login' | 'register'

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideLoginError() {
  document.getElementById('loginError').classList.add('hidden');
}

function emailAuthError(code) {
  const map = {
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/network-request-failed': 'Error de conexión. Revisa tu internet.',
  };
  return map[code] || 'Error al iniciar sesión. Intenta de nuevo.';
}

document.getElementById('emailAuthForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideLoginError();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('emailAuthBtn');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    if (_emailAuthMode === 'register') {
      const name = document.getElementById('loginName').value.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    showLoginError(emailAuthError(err.code));
    btn.disabled = false;
    btn.textContent = _emailAuthMode === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
  }
});

document.getElementById('switchModeBtn').addEventListener('click', () => {
  hideLoginError();
  _emailAuthMode = _emailAuthMode === 'login' ? 'register' : 'login';
  const isRegister = _emailAuthMode === 'register';
  document.getElementById('nameField').classList.toggle('hidden', !isRegister);
  document.getElementById('emailAuthBtn').textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesión';
  document.getElementById('switchText').textContent = isRegister ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  document.getElementById('switchModeBtn').textContent = isRegister ? 'Inicia sesión' : 'Regístrate';
  document.getElementById('forgotPasswordBtn').style.display = isRegister ? 'none' : '';
  const pwInput = document.getElementById('loginPassword');
  pwInput.autocomplete = isRegister ? 'new-password' : 'current-password';
});

document.getElementById('forgotPasswordBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { showLoginError('Ingresa tu correo para restablecer la contraseña.'); return; }
  hideLoginError();
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Correo de restablecimiento enviado');
  } catch (err) {
    showLoginError(emailAuthError(err.code));
  }
});

// ---------- Auth ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await endActivitySession();
    unsubscribeAdmin();
    if (unsubQuotes) { unsubQuotes(); unsubQuotes = null; }
    if (unsubClients) { unsubClients(); unsubClients = null; }
    if (unsubTemplates) { unsubTemplates(); unsubTemplates = null; }
    if (unsubAppVersion) { unsubAppVersion(); unsubAppVersion = null; }
    if (unsubActivityFeed) { unsubActivityFeed(); unsubActivityFeed = null; }
    _actFeedLogs = [];
    _appVersionKnown = null;
    currentUser = null;
    quotesLoaded = false;
    clientsLoaded = false;
    isAdmin = false;
    hideSplash();
    showLoginScreen();
    return;
  }
  currentUser = user;
  renderGreeting();
  hideLoginScreen();
  renderUserInfo(user);
  saveUserProfile(user).catch(() => {});
  await Promise.all([checkAdminStatus(), maybeSeed()]);
  renderAll();
  subscribe();
  startActivitySession().catch(() => {});
  setupFcm().catch(e => console.warn('FCM setup', e));
  setupAppVersionListener();
});

async function saveUserProfile(user) {
  await setDoc(doc(dbf, 'users', user.uid), {
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    lastLogin: serverTimestamp(),
  }, { merge: true });
}

function renderUserInfo(user) {
  const photo = document.getElementById('userPhoto');
  const name = document.getElementById('userName');
  const email = document.getElementById('userEmail');
  if (photo) {
    photo.src = user.photoURL || '';
    photo.style.display = user.photoURL ? 'block' : 'none';
  }
  if (name) name.textContent = user.displayName || '';
  if (email) email.textContent = user.email || '';
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  await fbSignOut(auth);
});

// ---------- Seed global (solo si la colección está vacía) ----------
async function maybeSeed() {
  const seedKey = 'sqy_seeded_' + currentUser.uid;
  if (localStorage.getItem(seedKey)) return;
  const snap = await getDocs(quotesCol());
  if (!snap.empty) { localStorage.setItem(seedKey, '1'); return; }

  // IDs deterministas: si dos usuarios siembran a la vez, escriben los MISMOS
  // documentos (last-write-wins) en lugar de duplicar las 12 cotizaciones demo.
  const slug = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const batch = writeBatch(dbf);
  for (const q of seedQuotes) {
    const id = `seed-q-${slug(q.empresa)}-${slug(q.numero)}`;
    batch.set(doc(quotesCol(), id), {
      id, seguimiento: '', notas: '', createdAt: serverTimestamp(),
      createdBy: currentUser.uid, ...q
    });
  }
  const empresas = [...new Set(seedQuotes.map(q => q.empresa))];
  for (const empresa of empresas) {
    const id = `seed-c-${slug(empresa)}`;
    const emails = seedQuotes
      .filter(q => q.empresa === empresa)
      .flatMap(q => (q.contactos || '').split(';').map(s => s.trim()).filter(Boolean));
    batch.set(doc(clientsCol(), id), {
      id, empresa,
      nombre: '', email: [...new Set(emails)][0] || '',
      telefono: '', cargo: '', notas: '',
      createdAt: serverTimestamp(), createdBy: currentUser.uid,
    });
  }
  await batch.commit();
  localStorage.setItem(seedKey, '1');
}

function subscribe() {
  if (unsubQuotes) unsubQuotes();
  if (unsubClients) unsubClients();
  if (unsubTemplates) unsubTemplates();
  quotesLoaded = false;
  clientsLoaded = false;
  renderAll();
  unsubQuotes = onSnapshot(query(quotesCol(), orderBy('fecha', 'desc')), (snap) => {
    quotes = snap.docs.map(d => d.data());
    quotesLoaded = true;
    if (clientsLoaded) hideSplash();
    renderAll();
  }, (err) => {
    console.error(err); showToast('Error leyendo cotizaciones');
  });
  unsubClients = onSnapshot(query(clientsCol(), orderBy('empresa')), (snap) => {
    clients = snap.docs.map(d => d.data());
    clientsLoaded = true;
    if (quotesLoaded) hideSplash();
    renderAll();
  });
  unsubTemplates = onSnapshot(query(templatesCol()), snap => {
    templates = snap.docs.map(d => d.data());
    templatesLoaded = true;
  });
}

// ---------- FCM ----------
// ---------- Force-update listener (dispara cuando superadmin hace update de caché) ----------
function setupAppVersionListener() {
  if (unsubAppVersion) return;
  unsubAppVersion = onSnapshot(doc(dbf, 'config', 'appVersion'), snap => {
    if (!snap.exists()) return;
    const v = snap.data().v;
    if (_appVersionKnown === null) { _appVersionKnown = v; return; }
    if (v !== _appVersionKnown) {
      _appVersionKnown = v;
      showToast('Actualizando app…');
      (async () => {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        const reg = await navigator.serviceWorker?.getRegistration('./sw.js').catch(() => null);
        if (reg) await reg.update().catch(() => {});
        setTimeout(() => location.reload(true), 900);
      })();
    }
  }, () => {});
}

// Scope propio para el SW de FCM: no choca con sw.js (que controla la raíz «/»).
const FCM_SW_SCOPE = './firebase-cloud-messaging-push-scope/';

async function setupFcm() {
  if (!(await isSupported())) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  const messaging = getMessaging(app);

  // Notificaciones con la app en primer plano.
  onMessage(messaging, async (payload) => {
    // Mensajes solo-data: título/cuerpo vienen en payload.data
    const d = payload?.data || payload?.notification || {};
    const title = d.title || 'SonqollayAPP';
    const body = d.body || '';
    pushNotif({ title, body }); // historial in-app
    // Mostrar SIEMPRE el banner del sistema, incluso con la app en primer plano.
    // (En primer plano FCM no dispara onBackgroundMessage, así que lo hacemos aquí.)
    try {
      if (Notification.permission !== 'granted') throw new Error('sin permiso');
      const reg = (await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE))
        || (await navigator.serviceWorker.ready);
      await reg.showNotification(title, {
        body, icon: '/icon-192.png', badge: '/icon-192.png', data: d,
      });
    } catch {
      showToast(`${title}${body ? ' · ' + body : ''}`); // fallback si no hay permiso/SW
    }
  });

  const pushLabel = document.getElementById('pushBtnLabel');
  const setLabel = (txt) => { if (pushLabel) pushLabel.textContent = txt; };

  // Registra el SW de FCM, asegura permiso, obtiene el token y lo guarda.
  // interactive=true → puede pedir permiso y mostrar avisos (uso por botón).
  // interactive=false → silencioso, solo refresca el token si ya hay permiso.
  async function subscribe(interactive) {
    if (!currentUser) return false;
    let step = 'registrar SW';
    try {
      const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: FCM_SW_SCOPE });
      await navigator.serviceWorker.ready;

      let perm = Notification.permission;
      if (perm === 'default' && interactive) perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        if (interactive) showToast(perm === 'denied'
          ? 'Notificaciones bloqueadas. Activalas en los ajustes del navegador.'
          : 'Permiso de notificaciones no concedido');
        return false;
      }

      step = 'obtener token';
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (!token) { if (interactive) showToast('No se pudo obtener el token de notificaciones'); return false; }

      step = 'guardar token';
      await setDoc(doc(tokensCol(), token), {
        token, ua: navigator.userAgent, createdAt: serverTimestamp(),
      }, { merge: true });
      setLabel('Notificaciones activadas ✓');
      updatePushPrompt();
      return true;
    } catch (e) {
      e._step = step;
      throw e;
    }
  }

  const btn = document.getElementById('enablePushBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      setLabel('Activando…');
      try {
        const ok = await subscribe(true);
        if (ok) showToast('Notificaciones activadas');
        else setLabel('Activar notificaciones');
      } catch (e) {
        console.error('FCM', e?._step, e);
        showToast(`Error al activar (${e?._step || '?'}): ${e?.code || e?.message || e}`);
        setLabel('Activar notificaciones');
      }
    });
  }

  // Si el permiso ya está concedido, re-suscribir en silencio en cada carga
  // para mantener el token siempre fresco (sobrevive a reinstalaciones/rotaciones).
  if (Notification.permission === 'granted') {
    subscribe(false).catch((e) => console.warn('FCM refresh', e));
  } else {
    setLabel('Activar notificaciones');
  }
  updatePushPrompt();
}

// ---------- Indicadores USD/UF ----------
let _ufValue = cachedUf();
const _fmtCLPplain = (n) => '$ ' + Math.round(n).toLocaleString('es-CL');

async function renderRates(force = false) {
  const usdEl = document.getElementById('rateUsd');
  const ufEl  = document.getElementById('rateUf');
  if (!usdEl || !ufEl) return;
  try {
    const r = await getRates({ force });
    if (r.dolar != null) usdEl.textContent = '$' + Math.round(r.dolar).toLocaleString('es-CL');
    if (r.uf != null)    ufEl.textContent  = '$' + Math.round(r.uf).toLocaleString('es-CL');
    if (r.uf) _ufValue = r.uf;
    const w = document.getElementById('ratesWidget');
    if (w && r.fecha) {
      const f = new Date(r.fecha);
      w.title = `Dólar y UF · ${isNaN(f.getTime()) ? r.fecha : f.toLocaleDateString('es-CL')} · toca para actualizar`;
    }
    updateUfHint();
  } catch {
    if (!_ufValue) { usdEl.textContent = '—'; ufEl.textContent = '—'; }
  }
}

function updateUfHint() {
  const hint = document.getElementById('ufHint');
  if (!hint) return;
  const valorInput = document.querySelector('#quoteForm [name="valor"]');
  const clp = valorInput ? parseValor(valorInput.value) : null;
  if (clp && _ufValue) {
    hint.textContent = `≈ ${(clp / _ufValue).toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF  ·  UF hoy ${_fmtCLPplain(_ufValue)}`;
  } else if (_ufValue) {
    hint.textContent = `UF hoy: ${_fmtCLPplain(_ufValue)}`;
  } else {
    hint.textContent = '';
  }
}

document.getElementById('ratesWidget')?.addEventListener('click', () => {
  showToast('Actualizando indicadores…');
  renderRates(true);
});

document.getElementById('ufToClpBtn')?.addEventListener('click', () => {
  const ufInput = document.getElementById('quoteValorUf');
  const valorInput = document.querySelector('#quoteForm [name="valor"]');
  const uf = parseFloat((ufInput?.value || '').replace(/\./g, '').replace(',', '.'));
  if (!_ufValue) { showToast('Aún no tengo el valor de la UF. Toca el indicador de arriba.'); return; }
  if (!uf || isNaN(uf)) { showToast('Ingresa un monto en UF.'); return; }
  const clp = Math.round(uf * _ufValue);
  if (valorInput) valorInput.value = clp.toLocaleString('es-CL');
  updateUfHint();
  showToast(`${uf} UF = ${_fmtCLPplain(clp)}`);
});

document.querySelector('#quoteForm [name="valor"]')?.addEventListener('input', updateUfHint);

renderRates(false);

// ---------- Tour guiado ----------
const TOUR_STEPS = [
  { title: '¡Bienvenido a SonqollayAPP! 👋', text: 'Te muestro en 1 minuto cómo moverte por la app. Puedes salir cuando quieras con «Salir» o la tecla Esc.' },
  { nav: 'dashboard', el: '#ratesWidget', title: 'Dólar y UF del día', text: 'Aquí ves el valor del dólar y la UF de hoy. Toca para actualizarlos. También puedes cotizar en UF al crear una cotización.' },
  { nav: 'dashboard', el: '#activityFeedBtn', title: 'Actividad del equipo', text: 'El rayo ⚡ muestra la actividad reciente del equipo en tiempo real: quién creó o movió qué.' },
  { nav: 'dashboard', el: '#hoyGreeting', title: 'Inicio — tu día', text: 'Tu resumen: cotizaciones que requieren seguimiento, vencidas y sin respuesta. Lo urgente, primero.' },
  { nav: 'dashboard', el: '#fab', title: 'Crear rápido', text: 'El botón + crea una cotización o un cliente nuevo en segundos. Incluso puedes dictarlo por voz 🎤 (la IA completa los campos).' },
  { nav: 'quotes', el: '#quotesViewToggle', title: 'Cotizaciones', text: 'Ve tus cotizaciones como Lista, Kanban (arrastra entre estados) o Proyectos. El Kanban muestra el pronóstico ponderado.' },
  { nav: 'quotes', el: '#quotesFilterToggle', title: 'Filtrar y ordenar', text: 'Filtra por estado, industria, tipo de servicio o seguimiento, y ordena como prefieras.' },
  { nav: 'quotes', el: '#quotes-list', title: 'Detalle de cada cotización', text: 'Toca una cotización para abrir su detalle: generar PDF con tu marca, compartir por WhatsApp, registrar un seguimiento (con tipo de contacto) y dictar avances por voz 🎤.' },
  { nav: 'clients', el: '#clientFilterToggle', title: 'Clientes', text: 'Busca y filtra tu cartera: completitud de ficha, industria, con/sin cotizaciones, y más.' },
  { nav: 'settings', el: '#enablePushBtn', title: 'Notificaciones', text: 'Activa las notificaciones para recibir los recordatorios de seguimiento (9:00 y 18:00) y las novedades del equipo.' },
  { nav: 'settings', el: '#startTourBtn', title: '¡Listo! 🚀', text: 'Eso es lo esencial. Puedes repetir este tutorial cuando quieras desde aquí o desde el menú ≡. ¡A vender!' },
];
function launchTour() { startAppTour(TOUR_STEPS); }
document.getElementById('startTourBtn')?.addEventListener('click', launchTour);

// Persiana de filtros: el encabezado expande/colapsa los grupos (clientes y cotizaciones)
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.cf-head-toggle');
  if (!toggle) return;
  toggle.closest('.filter-panel')?.classList.toggle('collapsed');
});

// ── Menú del header (≡) ──
(function setupHeaderMenu() {
  const btn = document.getElementById('menuBtn');
  if (!btn) return;
  let menu = null;
  const close = () => { if (menu) { menu.remove(); menu = null; document.removeEventListener('click', onDoc, true); } };
  const onDoc = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) { close(); return; }
    menu = document.createElement('div');
    menu.className = 'header-menu';
    menu.innerHTML = `
      <button data-act="academia">📚 Academia</button>
      <button data-act="tour">🎓 Cómo usar la app</button>
      <button data-act="settings">⚙️ Ajustes</button>`;
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    menu.querySelector('[data-act="academia"]').onclick = () => { close(); showView('academia'); };
    menu.querySelector('[data-act="tour"]').onclick = () => { close(); launchTour(); };
    menu.querySelector('[data-act="settings"]').onclick = () => { close(); document.querySelector('.bottom-nav [data-view="settings"]')?.click(); };
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  });
})();

// ---------- Greeting ----------
function renderGreeting() {
  const grEl = document.getElementById('hoyGreeting');
  const dtEl = document.getElementById('hoyDate');
  if (!grEl) return;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = currentUser?.displayName?.split(' ')[0] || '';
  grEl.textContent = nombre ? `${saludo}, ${nombre}` : saludo;
  const now = new Date();
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  dtEl.textContent = `${dias[now.getDay()]} ${now.getDate()} ${meses[now.getMonth()]}`;
}

// ---------- Hoy Urgente ----------
function renderHoyUrgente() {
  const urgEl = document.getElementById('hoy-urgente-section');
  if (!urgEl || !quotesLoaded) return;

  const overdue = quotes.filter(q => {
    if (!q.seguimiento) return false;
    const e = (q.estado || '').toLowerCase();
    if (e === 'adjudicada' || e === 'perdida') return false;
    return daysUntil(q.seguimiento) <= 0;
  }).sort((a, b) => a.seguimiento.localeCompare(b.seguimiento));

  // "Requieren seguimiento" — siempre visible (urgente)
  if (overdue.length) {
    urgEl.innerHTML = `<div class="hoy-section-header urgent">
      <span class="hoy-dot urgent"></span>Requieren seguimiento
    </div>
    <div class="list">${overdue.map(q => cardQuoteHtml(q, { registrar: true })).join('')}</div>`;
    bindQuoteCards(urgEl);
  } else {
    urgEl.innerHTML = '';
  }

  // "Sin respuesta +14 días" — acordeón
  const sinRespuesta = quotes.filter(q => {
    const e = (q.estado || '').toLowerCase();
    if (e !== 'enviada' && e !== 'en revisión') return false;
    return daysSinceUpdated(q) >= 14;
  }).sort((a, b) => daysSinceUpdated(b) - daysSinceUpdated(a));

  const wrap  = document.getElementById('acc-wrap-sinresp');
  const body  = document.getElementById('acc-body-sinresp');
  const badge = document.getElementById('acc-ct-sinresp');
  if (wrap && body && badge) {
    if (sinRespuesta.length) {
      wrap.hidden = false;
      badge.textContent = sinRespuesta.length;
      badge.className = 'acc-badge has-warn';
      body.innerHTML = `<div class="list">${sinRespuesta.map(q => cardQuoteHtml(q, { registrar: true })).join('')}</div>`;
      bindQuoteCards(body);
    } else {
      wrap.hidden = true;
    }
  }
}

// ---------- Render ----------
function renderAll() {
  renderDashboard();
  renderPlanner();
  renderQuotes();
  renderProyectos();
  renderClients();
  renderCompaniesDatalist();
  updateQuickCounts();
}

// Muestra el aviso de "Activar notificaciones" en Inicio solo si no están activas.
function updatePushPrompt() {
  const card = document.getElementById('pushPromptCard');
  if (!card) return;
  const supported = ('Notification' in window) && ('serviceWorker' in navigator);
  const needs = supported && Notification.permission !== 'granted';
  card.classList.toggle('hidden', !needs);
}
document.getElementById('pushPromptActivate')?.addEventListener('click', () => {
  document.getElementById('enablePushBtn')?.click(); // reusa el flujo de activación
  setTimeout(updatePushPrompt, 1500);
});

function renderDashboard() {
  renderGreeting();
  updatePushPrompt();
  renderHoyUrgente();
  if (!quotesLoaded || !clientsLoaded) {
    const kpiEl = document.getElementById('kpi-metrics')?.previousElementSibling;
    document.getElementById('kpi-quotes').textContent = '—';
    document.getElementById('kpi-clients').textContent = '—';
    document.getElementById('kpi-total').textContent = '—';
  } else {
    document.getElementById('kpi-quotes').textContent = quotes.length;
    document.getElementById('kpi-clients').textContent = clients.length;
    const total = quotes.reduce((s, q) => s + (Number(q.valor) || 0), 0);
    document.getElementById('kpi-total').textContent = formatCLPShort(total);
  }

  // Semáforo summary
  const smEl = document.getElementById('semaforo-summary');
  if (smEl) {
    if (!quotesLoaded) {
      smEl.innerHTML = '';
    } else {
      const active = quotes.filter(q => {
        if (!q.seguimiento) return false;
        const e = (q.estado || '').toLowerCase();
        return e !== 'adjudicada' && e !== 'perdida';
      });
      if (!active.length) {
        smEl.innerHTML = '';
      } else {
        const red    = active.filter(q => daysUntil(q.seguimiento) <= 0).length;
        const yellow = active.filter(q => { const d = daysUntil(q.seguimiento); return d > 0 && d <= 3; }).length;
        const green  = active.filter(q => daysUntil(q.seguimiento) > 3).length;
        smEl.innerHTML = `<div class="semaforo-summary">
          <div class="ss-item${red === 0 ? ' zero' : ''}">
            <span class="ss-dot red"></span>
            <span class="ss-count red">${red}</span>
            <span class="ss-lbl">Vencido${red !== 1 ? 's' : ''}</span>
          </div>
          <div class="ss-item${yellow === 0 ? ' zero' : ''}">
            <span class="ss-dot yellow"></span>
            <span class="ss-count yellow">${yellow}</span>
            <span class="ss-lbl">Próximo${yellow !== 1 ? 's' : ''}</span>
          </div>
          <div class="ss-item${green === 0 ? ' zero' : ''}">
            <span class="ss-dot green"></span>
            <span class="ss-count green">${green}</span>
            <span class="ss-lbl">Al día</span>
          </div>
        </div>`;
      }
    }
  }

  const followUps = quotes
    .filter(q => q.seguimiento)
    .sort((a, b) => a.seguimiento.localeCompare(b.seguimiento))
    .slice(0, 5);
  const fuEl = document.getElementById('follow-ups');
  const fuBadge = document.getElementById('acc-ct-followups');
  if (!quotesLoaded) {
    if (fuEl) fuEl.innerHTML = skeletonCards(2);
  } else if (!followUps.length) {
    if (fuEl) fuEl.innerHTML = '<div class="empty">Sin seguimientos programados</div>';
    if (fuBadge) { fuBadge.textContent = '0'; fuBadge.className = 'acc-badge'; }
  } else {
    if (fuEl) { fuEl.innerHTML = followUps.map(q => cardQuoteHtml(q)).join(''); bindQuoteCards(fuEl); }
    if (fuBadge) { fuBadge.textContent = followUps.length; fuBadge.className = 'acc-badge has-items'; }
  }

  const recEl = document.getElementById('recent-quotes');
  const recBadge = document.getElementById('acc-ct-recent');
  if (!quotesLoaded) {
    if (recEl) recEl.innerHTML = skeletonCards(3);
  } else {
    const recent = [...quotes]
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      .slice(0, 5);
    if (recEl) {
      recEl.innerHTML = recent.length
        ? recent.map(q => cardQuoteHtml(q)).join('')
        : '<div class="empty">Aún no hay cotizaciones</div>';
      bindQuoteCards(recEl);
    }
    if (recBadge) { recBadge.textContent = recent.length; recBadge.className = recent.length ? 'acc-badge has-items' : 'acc-badge'; }
  }
  renderMetrics();
}

function renderMetrics() {
  const el = document.getElementById('kpi-metrics');
  if (!el || !quotesLoaded) return;

  const closed = quotes.filter(q => {
    const e = (q.estado||'').toLowerCase();
    return e === 'adjudicada' || e === 'perdida';
  });
  const won = quotes.filter(q => (q.estado||'').toLowerCase() === 'adjudicada');
  const winRate = closed.length ? Math.round(won.length / closed.length * 100) : null;

  const active = quotes.filter(q => {
    const e = (q.estado||'').toLowerCase();
    return e !== 'adjudicada' && e !== 'perdida';
  });
  const pipeline = active.reduce((s, q) => s + (Number(q.valor)||0), 0);

  const withValue = quotes.filter(q => q.valor != null && q.valor !== '' && !isNaN(q.valor));
  const avgTicket = withValue.length ? Math.round(withValue.reduce((s,q) => s + Number(q.valor), 0) / withValue.length) : null;

  // Monthly chart: last 6 months
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('es-CL', { month: 'short' });
    const count = quotes.filter(q => (q.fecha||'').startsWith(key)).length;
    months.push({ label, count });
  }
  const maxCount = Math.max(...months.map(m => m.count), 1);

  // Tipo breakdown
  const TIPOS = ['Consultoría', 'Academia', 'AURA'];
  const tipoRows = TIPOS.map(tipo => {
    const list = active.filter(q => q.tipoServicio === tipo);
    if (!list.length) return '';
    const val = list.reduce((s, q) => s + (Number(q.valor)||0), 0);
    return `<div class="tipo-metric-row"><span class="tag-tipo">${escapeHtml(tipo)}</span><span class="tipo-metric-count">${list.length} cot.</span><span class="tipo-metric-val">${formatCLP(val)}</span></div>`;
  }).filter(Boolean).join('');

  el.innerHTML = `
    <div class="metrics-row">
      <div class="metric-card">
        <div class="metric-val">${winRate !== null ? winRate + '%' : '—'}</div>
        <div class="metric-lbl">Tasa de cierre</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">${avgTicket !== null ? formatCLP(avgTicket) : '—'}</div>
        <div class="metric-lbl">Ticket promedio</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">${formatCLP(pipeline)}</div>
        <div class="metric-lbl">Pipeline activo</div>
      </div>
    </div>
    ${tipoRows ? `<div class="chart-section"><div class="chart-title">Pipeline por tipo de servicio</div>${tipoRows}</div>` : ''}
    <div class="chart-section">
      <div class="chart-title">Cotizaciones por mes</div>
      <div class="mini-chart">
        ${months.map(m => `
          <div class="chart-col">
            <div class="chart-bar-wrap">
              <div class="chart-bar" style="height:${m.count ? Math.max(Math.round(m.count/maxCount*100), 8) : 0}%"></div>
            </div>
            <div class="chart-label">${m.label}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---------- Planner semanal ----------
function renderPlanner() {
  const todayCardEl = document.getElementById('plannerTodayCard');
  const weekStripEl = document.getElementById('plannerWeekStrip');
  const daysListEl  = document.getElementById('plannerDaysList');
  if (!todayCardEl) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const todayISO = toISO(today);

  const DAYS_ES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const MONTHS_NOTE = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // 7-day window: today … today+6
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  // Active quotes (not won/lost)
  const active = quotes.filter(q => {
    if (!q.seguimiento) return false;
    const e = (q.estado || '').toLowerCase();
    return e !== 'adjudicada' && e !== 'perdida';
  });

  // Overdue (seguimiento before today)
  const overdue = active.filter(q => daysUntil(q.seguimiento) < 0)
    .sort((a, b) => a.seguimiento.localeCompare(b.seguimiento));

  // Group by day for the 7-day window
  const byDay = {};
  days.forEach(d => {
    const key = toISO(d);
    byDay[key] = active.filter(q => q.seguimiento === key);
  });

  // Contacted today: notes have a timestamp from today
  const pad = n => String(n).padStart(2, '0');
  const todayNotePrefix = `[${pad(today.getDate())} ${MONTHS_NOTE[today.getMonth()]} ${today.getFullYear()}`;
  const contactedToday = quotes.filter(q => q.notas && q.notas.includes(todayNotePrefix));

  // ── Today summary card ──
  if (!quotesLoaded) {
    todayCardEl.innerHTML = `<div class="planner-today-card">${skeletonCards(1)}</div>`;
  } else {
    const todayScheduled  = (byDay[todayISO] || []).length;
    const overdueCount    = overdue.length;
    const totalPending    = todayScheduled + overdueCount;
    const contactedCount  = contactedToday.length;
    const dayLabel = `${DAYS_ES[today.getDay()]} ${today.getDate()} ${MONTHS_ES[today.getMonth()]}`;
    const pendingColor = overdueCount > 0 ? 'red' : todayScheduled > 0 ? 'warn' : 'success';

    todayCardEl.innerHTML = `
      <div class="planner-today-card">
        <div class="planner-today-label">Hoy · ${escapeHtml(dayLabel)}</div>
        <div class="planner-today-stats">
          <div class="planner-stat${totalPending === 0 ? ' zero' : ''}">
            <span class="planner-stat-num ${pendingColor}">${totalPending}</span>
            <span class="planner-stat-lbl">pendiente${totalPending !== 1 ? 's' : ''}<br>hoy</span>
          </div>
          <div class="planner-stat-div"></div>
          <div class="planner-stat${contactedCount === 0 ? ' zero' : ''}">
            <span class="planner-stat-num success">${contactedCount}</span>
            <span class="planner-stat-lbl">contactado${contactedCount !== 1 ? 's' : ''}<br>hoy</span>
          </div>
        </div>
        ${overdueCount > 0 ? `<div class="planner-overdue-hint">
          <span class="sm-dot red pulse"></span>
          ${overdueCount} seguimiento${overdueCount !== 1 ? 's' : ''} vencido${overdueCount !== 1 ? 's' : ''} sin atender
        </div>` : ''}
      </div>`;
  }

  // ── Week strip ──
  if (!quotesLoaded) {
    weekStripEl.innerHTML = `<div class="planner-week-row">${Array.from({length:7}, () =>
      '<div class="planner-day-pill empty"><div class="skeleton-line" style="width:70%;height:10px;margin:2px auto"></div></div>'
    ).join('')}</div>`;
  } else {
    weekStripEl.innerHTML = `<div class="planner-week-row">` +
      days.map(d => {
        const key = toISO(d);
        const isToday = key === todayISO;
        const count = (byDay[key] || []).length + (isToday ? overdue.length : 0);
        const intensity = count === 0 ? '' : count <= 2 ? ' low' : count <= 4 ? ' mid' : ' high';
        return `<div class="planner-day-pill${isToday ? ' today' : ''}${count === 0 ? ' empty' : ''}">
          <span class="planner-pill-name">${DAYS_ES[d.getDay()]}</span>
          <span class="planner-pill-date">${d.getDate()}</span>
          <span class="planner-pill-count${intensity}">${count || '·'}</span>
        </div>`;
      }).join('') +
    `</div>`;
  }

  // ── Day sections ──
  if (!quotesLoaded) {
    daysListEl.innerHTML = skeletonCards(3);
    return;
  }

  let html = '';

  // Overdue section
  if (overdue.length) {
    html += `<div class="planner-day-block overdue">
      <div class="planner-day-header">
        <span class="sm-dot red pulse"></span>
        <span class="planner-day-name">Vencidos</span>
        <span class="planner-day-badge red">${overdue.length} seg.</span>
      </div>
      <div class="list">${overdue.map(q => cardQuoteHtml(q, { registrar: true })).join('')}</div>
    </div>`;
  }

  // One section per day
  days.forEach(d => {
    const key = toISO(d);
    const dayQuotes = byDay[key] || [];
    if (!dayQuotes.length) return;

    const isToday    = key === todayISO;
    const isTomorrow = daysUntil(key) === 1;
    let label;
    if (isToday)         label = `Hoy · ${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
    else if (isTomorrow) label = `Mañana · ${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
    else                 label = `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;

    html += `<div class="planner-day-block">
      <div class="planner-day-header">
        <span class="planner-day-name">${escapeHtml(label)}</span>
        <span class="planner-day-badge">${dayQuotes.length} seg.</span>
      </div>
      <div class="list">${dayQuotes.map(q => cardQuoteHtml(q)).join('')}</div>
    </div>`;
  });

  if (!html) {
    html = `<div class="empty" style="margin-top:20px">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5m-9-6h.008v.008H12V9zm0 3.75h.008v.008H12v-.008zM12 16.5h.008v.008H12V16.5zm-3.75-3h.008v.008H8.25V13.5zm0 3h.008v.008H8.25v-.008zm7.5-3h.008v.008H15.75V13.5zm0 3h.008v.008H15.75v-.008z"/></svg>
      <span>Sin seguimientos esta semana</span>
      <p class="hint">Asigna fechas de seguimiento a tus cotizaciones para planificar tu semana</p>
    </div>`;
  }

  daysListEl.innerHTML = html;
  bindQuoteCards(daysListEl);
}

// ---------- Dashboard sub-tabs ----------
document.getElementById('dashboardTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.dtab');
  if (!btn) return;
  const tab = btn.dataset.dtab;
  document.querySelectorAll('.dtab').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
  ['dashResumen','dashSemana','dashNotifs'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = (id === `dash${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    if (isActive) {
      el.classList.add('dtab-active');
    } else {
      el.classList.remove('dtab-active');
    }
  });
  if (tab === 'notifs') { renderNotifList(); markNotifsRead(); }
});

// ---------- Notification history ----------
const NOTIF_KEY = 'sonqollay_notif_history';
const NOTIF_MAX = 50;

function loadNotifHistory() {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]'); } catch { return []; }
}
function saveNotifHistory(list) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(list.slice(0, NOTIF_MAX)));
}

function pushNotif({ title, body = '', timestamp = Date.now() }) {
  const list = loadNotifHistory();
  list.unshift({ id: String(timestamp) + Math.random().toString(36).slice(2), title, body, timestamp, read: false });
  saveNotifHistory(list);
  renderNotifList();
  updateNotifBadge();
}

function markNotifsRead() {
  const list = loadNotifHistory().map(n => ({ ...n, read: true }));
  saveNotifHistory(list);
  updateNotifBadge();
}

function updateNotifBadge() {
  const unread = loadNotifHistory().filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
}

function timeAgoShort(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)  return 'Ahora';
  const m = Math.round(s / 60);
  if (m < 60)  return `Hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `Hace ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30)  return `Hace ${d}d`;
  return new Date(ts).toLocaleDateString('es-CL');
}

function renderNotifList() {
  const el = document.getElementById('notifList');
  if (!el) return;
  const list = loadNotifHistory();
  if (!list.length) {
    el.innerHTML = '<div class="empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg><span>Sin notificaciones aún</span></div>';
    return;
  }
  el.innerHTML = list.map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}" data-id="${escapeHtml(n.id)}">
      <div class="notif-dot"></div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-preview">${escapeHtml(n.body)}</div>` : ''}
        <div class="notif-time">${timeAgoShort(n.timestamp)}</div>
      </div>
      <svg class="notif-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
    </div>`).join('');

  el.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      const n = list.find(x => x.id === item.dataset.id);
      if (!n) return;
      openNotifSheet(n);
    });
  });
}

function openNotifSheet(n) {
  document.getElementById('notifSheetTitle').textContent = n.title;
  document.getElementById('notifSheetBody').textContent  = n.body || '';
  document.getElementById('notifSheetTime').textContent  = new Date(n.timestamp).toLocaleString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
  document.getElementById('notifSheet').classList.remove('hidden');
}

document.getElementById('notifSheetClose')?.addEventListener('click', () => {
  document.getElementById('notifSheet').classList.add('hidden');
});
document.getElementById('notifSheet')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('notifSheet').classList.add('hidden');
});

document.getElementById('notifClearAll')?.addEventListener('click', () => {
  saveNotifHistory([]);
  renderNotifList();
  updateNotifBadge();
});

// Escuchar mensajes del service worker (notificaciones en background)
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'PUSH_RECEIVED') {
    pushNotif({ title: event.data.title, body: event.data.body, timestamp: event.data.timestamp });
  }
});

// Inicializar badge al cargar
updateNotifBadge();

function cardQuoteHtml(q, opts = {}) {
  const estadoClass = (q.estado || 'Borrador').split(' ')[0];
  const sm = getSeguimientoStatus(q);
  const academiaCupos = q.tipoServicio === 'Academia' && q.cursoCupos ? `${q.cursoInscritos||0}/${q.cursoCupos} cupos` : '';
  return `
    <div class="card" data-quote-id="${q.id}" data-estado="${escapeHtml(q.estado || 'Borrador')}">
      <div class="card-row">
        <div class="card-title">${escapeHtml(q.numero)} · ${escapeHtml(q.empresa)}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <span class="tag estado-${escapeHtml(estadoClass)}">${escapeHtml(q.estado || 'Borrador')}</span>
          ${q.version > 1 ? `<span class="tag-version">v${q.version}</span>` : ''}
          ${q.tipoServicio ? `<span class="tag-tipo">${escapeHtml(q.tipoServicio)}</span>` : ''}
          ${q.industria ? `<span class="tag-industria">${escapeHtml(q.industria)}</span>` : ''}
        </div>
      </div>
      <div class="card-sub">${escapeHtml(q.descripcion || '—')}</div>
      <div class="card-row">
        <span class="card-meta">${formatDate(q.fecha)}</span>
        <span class="card-meta">
          <strong style="color:var(--text)">${formatCLP(q.valor)}</strong>
          ${academiaCupos ? ` · <span style="color:var(--muted)">${academiaCupos}</span>` : ''}
        </span>
      </div>
      ${sm ? `<div class="sm-row tappable" data-seg-id="${q.id}">
        <span class="sm-dot ${sm.key}${sm.key === 'red' ? ' pulse' : ''}"></span>
        <span class="sm-label ${sm.key}">${sm.label}</span>
        <span class="sm-date">${formatDate(q.seguimiento)}</span>
        <svg class="sm-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
      </div>` : ''}
      ${opts.registrar ? `<button class="btn-registrar" data-registrar-id="${q.id}">📞 Registrar contacto</button>` : ''}
    </div>`;
}

function bindQuoteCards(root) {
  root.querySelectorAll('[data-quote-id]').forEach(el => {
    el.addEventListener('click', () => openQuoteDetail(el.dataset.quoteId));
  });
  root.querySelectorAll('[data-seg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openSeguimientoSheet(el.dataset.segId);
    });
  });
  root.querySelectorAll('[data-registrar-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openSeguimientoSheet(el.dataset.registrarId);
    });
  });
}

function applyQuotesFilters(list) {
  if (quotesFilters.estados.length) {
    list = list.filter(q => quotesFilters.estados.includes(q.estado || 'Borrador'));
  }
  if (quotesFilters.industria !== 'all') {
    list = list.filter(q => q.industria === quotesFilters.industria);
  }
  if (quotesFilters.tipo !== 'all') {
    list = list.filter(q => (q.tipoServicio || '') === quotesFilters.tipo);
  }
  if (quotesFilters.seg === 'con') list = list.filter(q => !!q.seguimiento);
  if (quotesFilters.seg === 'sin') list = list.filter(q => !q.seguimiento);
  if (quotesFilters.seg === 'vencido') list = list.filter(q => {
    if (!q.seguimiento) return false;
    const e = (q.estado || '').toLowerCase();
    if (e === 'adjudicada' || e === 'perdida') return false;
    return daysUntil(q.seguimiento) <= 0;
  });
  return list;
}

function updateFilterBadge() {
  const count = quotesFilters.estados.length
    + (quotesFilters.industria !== 'all' ? 1 : 0)
    + (quotesFilters.tipo !== 'all' ? 1 : 0)
    + (quotesFilters.seg !== 'all' ? 1 : 0);
  const badge = document.getElementById('filterBadge');
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
  document.getElementById('quotesFilterToggle')?.classList.toggle('active', count > 0);
}

// Chips de industria del filtro de cotizaciones (dinámicos según los datos)
function renderQuoteIndustriaChips() {
  const container = document.getElementById('qfIndustriaFilter');
  const row = document.getElementById('qf-row-industria');
  if (!container) return;
  const inds = [...new Set(quotes.map(q => q.industria).filter(Boolean))].sort();
  if (row) row.hidden = inds.length === 0;
  const cur = quotesFilters.industria;
  container.innerHTML = `<button class="sfchip${cur === 'all' ? ' active' : ''}" data-ind="all">Todas</button>`
    + inds.map(i => `<button class="sfchip${cur === i ? ' active' : ''}" data-ind="${escapeHtml(i)}">${escapeHtml(i)}</button>`).join('');
}

function renderQuotes() {
  renderQuoteIndustriaChips();
  if (_quotesView === 'pipeline') { renderPipeline(); return; }
  if (_quotesView === 'proyectos') { renderProyectos(); return; }
  if (!quotesLoaded) { document.getElementById('quotes-list').innerHTML = skeletonCards(5); return; }
  const q = (document.getElementById('search-quotes').value || '').toLowerCase().trim();
  let list = [...quotes];
  if (q) {
    list = list.filter(x =>
      (x.empresa||'').toLowerCase().includes(q) ||
      (x.numero||'').toLowerCase().includes(q) ||
      (x.descripcion||'').toLowerCase().includes(q) ||
      (x.contactos||'').toLowerCase().includes(q)
    );
  }
  list = applyQuotesFilters(list);
  // Orden
  const s = quotesFilters.sort;
  if (s === 'fecha_asc')        list.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  else if (s === 'valor_desc')  list.sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0));
  else if (s === 'empresa')     list.sort((a, b) => (a.empresa || '').localeCompare(b.empresa || ''));
  else                          list.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const el = document.getElementById('quotes-list');
  el.innerHTML = list.length
    ? list.map(x => cardQuoteHtml(x)).join('')
    : '<div class="empty">Sin resultados</div>';
  bindQuoteCards(el);
}

const CLIENTS_PER_PAGE = 10;
let clientsPage = 0;

const clientFilters = { semaforo: 'all', industria: 'all', tipo: 'all', cotiz: 'all', notas: 'all', sort: 'empresa' };

function clientActiveFilterCount() {
  return ['semaforo', 'industria', 'tipo', 'cotiz', 'notas'].filter(k => clientFilters[k] !== 'all').length;
}

function updateClientFilterBadge() {
  const n = clientActiveFilterCount();
  const badge = document.getElementById('clientFilterBadge');
  const btn   = document.getElementById('clientFilterToggle');
  if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  if (btn)   btn.classList.toggle('active', n > 0);
}

function renderClientIndustriaChips() {
  const container = document.getElementById('clientIndustriaFilter');
  const row       = document.getElementById('cf-row-industria');
  if (!container) return;
  const industries = [...new Set(clients.map(c => c.industria).filter(Boolean))].sort();
  if (row) row.hidden = industries.length === 0;
  const cur = clientFilters.industria;
  container.innerHTML = `<button class="sfchip${cur === 'all' ? ' active' : ''}" data-ind="all">Todas</button>`
    + industries.map(ind =>
        `<button class="sfchip${cur === ind ? ' active' : ''}" data-ind="${escapeHtml(ind)}">${escapeHtml(ind)}</button>`
      ).join('');
}

function clientSemaforo(c) {
  const fields = [c.empresa, c.nombre, c.email, c.telefono, c.cargo];
  const filled = fields.filter(f => f && String(f).trim()).length;
  if (filled >= 5) return 'green';
  if (filled >= 3) return 'yellow';
  return 'red';
}

function renderClients() {
  if (!clientsLoaded) { document.getElementById('clients-list').innerHTML = skeletonClientCards(4); return; }
  renderClientIndustriaChips();
  const q = (document.getElementById('search-clients').value || '').toLowerCase().trim();
  let list = [...clients];
  if (q) {
    list = list.filter(x =>
      (x.empresa||'').toLowerCase().includes(q) ||
      (x.nombre||'').toLowerCase().includes(q) ||
      (x.email||'').toLowerCase().includes(q)
    );
  }
  if (clientFilters.semaforo !== 'all') {
    list = list.filter(c => clientSemaforo(c) === clientFilters.semaforo);
  }
  if (clientFilters.industria !== 'all') {
    list = list.filter(c => c.industria === clientFilters.industria);
  }
  if (clientFilters.tipo !== 'all') {
    list = list.filter(c => quotes.some(qq => qq.empresa === c.empresa && qq.tipoServicio === clientFilters.tipo));
  }
  if (clientFilters.cotiz === 'con') list = list.filter(c => quotes.some(qq => qq.empresa === c.empresa));
  if (clientFilters.cotiz === 'sin') list = list.filter(c => !quotes.some(qq => qq.empresa === c.empresa));
  if (clientFilters.notas === 'con') list = list.filter(c => c.notas && String(c.notas).trim());
  if (clientFilters.notas === 'sin') list = list.filter(c => !c.notas || !String(c.notas).trim());

  // Orden
  const _count = c => quotes.filter(qq => qq.empresa === c.empresa).length;
  if (clientFilters.sort === 'recientes') {
    list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
  } else if (clientFilters.sort === 'cotizaciones') {
    list.sort((a, b) => _count(b) - _count(a) || (a.empresa || '').localeCompare(b.empresa || ''));
  } else {
    list.sort((a, b) => (a.empresa || '').localeCompare(b.empresa || ''));
  }

  const el = document.getElementById('clients-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin clientes</div>'; return; }

  const totalPages = Math.ceil(list.length / CLIENTS_PER_PAGE);
  if (clientsPage >= totalPages) clientsPage = Math.max(0, totalPages - 1);
  const page = list.slice(clientsPage * CLIENTS_PER_PAGE, (clientsPage + 1) * CLIENTS_PER_PAGE);

  let html = page.map(c => {
    const count  = quotes.filter(qq => qq.empresa === c.empresa).length;
    const sema   = clientSemaforo(c);
    const notas  = parseNotes(c.notas || '');
    const firstNota = notas[0];
    const notaPreview = firstNota
      ? (typeof firstNota === 'object' ? firstNota.text : firstNota)
      : '';
    return `
      <div class="card" data-client-id="${c.id}">
        <div class="card-row">
          <div style="display:flex;align-items:flex-start;gap:8px;flex:1;min-width:0">
            <div class="sema-dot ${sema}" title="${sema==='green'?'Completo':sema==='yellow'?'Casi completo':'Incompleto'}"></div>
            <div class="card-title" style="margin:0">${escapeHtml(c.empresa)}</div>
          </div>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <span class="tag">${count} cot.</span>
            ${c.industria ? `<span class="tag-industria">${escapeHtml(c.industria)}</span>` : ''}
          </div>
        </div>
        <div class="card-sub">${escapeHtml(c.nombre || c.email || '—')}</div>
        ${c.email ? `<div class="card-meta">${escapeHtml(c.email)}</div>` : ''}
        ${notaPreview ? `
        <div class="client-notes-row" data-notes-id="${escapeHtml(c.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
          <span class="client-notes-preview">${escapeHtml(notaPreview)}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
        </div>` : ''}
      </div>`;
  }).join('');

  if (totalPages > 1) {
    html += `<div class="pagination">
      <button class="pg-btn" id="pgPrev" ${clientsPage === 0 ? 'disabled' : ''}>← Anterior</button>
      <span class="pg-info">${clientsPage + 1} / ${totalPages}</span>
      <button class="pg-btn" id="pgNext" ${clientsPage >= totalPages - 1 ? 'disabled' : ''}>Siguiente →</button>
    </div>`;
  }

  el.innerHTML = html;
  el.querySelectorAll('[data-client-id]').forEach(node => {
    node.addEventListener('click', (e) => {
      if (e.target.closest('[data-notes-id]')) return;
      openClientForm(node.dataset.clientId);
    });
  });
  el.querySelectorAll('[data-notes-id]').forEach(node => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = clients.find(x => x.id === node.dataset.notesId);
      if (c) openClientNotesSheet(c);
    });
  });
  document.getElementById('pgPrev')?.addEventListener('click', () => { clientsPage--; renderClients(); });
  document.getElementById('pgNext')?.addEventListener('click', () => { clientsPage++; renderClients(); });
}

function openClientNotesSheet(c) {
  document.getElementById('clientNotesSheetTitle').textContent = `Notas · ${c.empresa}`;
  const notas = parseNotes(c.notas || '');
  const body  = document.getElementById('clientNotesSheetBody');
  if (!notas.length) {
    body.innerHTML = '<p style="color:var(--muted);font-size:14px;padding:8px 0">Sin notas registradas.</p>';
  } else {
    body.innerHTML = notas.map(n => {
      const m = parseNoteMeta(n);
      const meta = [m.ts && escapeHtml(m.ts), m.author && `<b>${escapeHtml(m.author)}</b>`, m.tag && escapeHtml(m.tag)].filter(Boolean).join(' · ');
      return `<div class="nota-item">${meta ? `<div class="nota-ts">${meta}</div>` : ''}<div class="nota-text">${escapeHtml(m.text)}</div></div>`;
    }).join('');
  }
  document.getElementById('clientNotesSheet').classList.remove('hidden');
}

document.getElementById('clientNotesSheetClose')?.addEventListener('click', () => {
  document.getElementById('clientNotesSheet').classList.add('hidden');
});
document.getElementById('clientNotesSheet')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('clientNotesSheet').classList.add('hidden');
});

// Toggle panel
document.getElementById('clientFilterToggle')?.addEventListener('click', () => {
  const panel = document.getElementById('clientFilterPanel');
  const btn   = document.getElementById('clientFilterToggle');
  const open  = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
});

// Semáforo
document.getElementById('clientSemaforoFilter')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.sfchip');
  if (!chip) return;
  clientFilters.semaforo = chip.dataset.sf;
  document.querySelectorAll('#clientSemaforoFilter .sfchip').forEach(c => c.classList.toggle('active', c === chip));
  clientsPage = 0; updateClientFilterBadge(); renderClients();
});

// Industria
document.getElementById('clientIndustriaFilter')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.sfchip');
  if (!chip) return;
  clientFilters.industria = chip.dataset.ind;
  document.querySelectorAll('#clientIndustriaFilter .sfchip').forEach(c => c.classList.toggle('active', c === chip));
  clientsPage = 0; updateClientFilterBadge(); renderClients();
});

// Grupos de chips (tipo / cotizaciones / notas / orden)
function _bindClientChips(containerId, attr, key) {
  document.getElementById(containerId)?.addEventListener('click', (e) => {
    const chip = e.target.closest('.sfchip');
    if (!chip) return;
    clientFilters[key] = chip.dataset[attr];
    document.querySelectorAll('#' + containerId + ' .sfchip').forEach(c => c.classList.toggle('active', c === chip));
    clientsPage = 0; updateClientFilterBadge(); renderClients();
  });
}
_bindClientChips('clientTipoFilter',  'tipo',  'tipo');
_bindClientChips('clientCotizFilter', 'cotiz', 'cotiz');
_bindClientChips('clientNotasFilter', 'notas', 'notas');
_bindClientChips('clientSortFilter',  'sort',  'sort');

// Limpiar filtros (resetea filtros y orden a A–Z)
document.getElementById('clientFilterClear')?.addEventListener('click', () => {
  Object.assign(clientFilters, { semaforo: 'all', industria: 'all', tipo: 'all', cotiz: 'all', notas: 'all', sort: 'empresa' });
  const setActive = (id, attr, val) =>
    document.querySelectorAll('#' + id + ' .sfchip').forEach(c => c.classList.toggle('active', c.dataset[attr] === val));
  setActive('clientSemaforoFilter', 'sf', 'all');
  setActive('clientTipoFilter', 'tipo', 'all');
  setActive('clientCotizFilter', 'cotiz', 'all');
  setActive('clientNotasFilter', 'notas', 'all');
  setActive('clientSortFilter', 'sort', 'empresa');
  renderClientIndustriaChips();
  clientsPage = 0; updateClientFilterBadge(); renderClients();
});

function renderCompaniesDatalist() {
  const dl = document.getElementById('companies');
  const names = [...new Set(clients.map(c => c.empresa).concat(quotes.map(q => q.empresa)))];
  dl.innerHTML = names.sort().map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

// ---------- Navegación ----------
function showView(name) {
  const wasAdmin = document.getElementById('view-admin')?.classList.contains('active');
  if (wasAdmin && name !== 'admin') unsubscribeAdmin();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);

  _flushScreenTime();
  _activeView = name;
  _viewStart = Date.now();

  if (name === 'admin') {
    renderAdminGate(isAdmin);
    if (isAdmin) subscribeAdmin();
  }
  if (name === 'academia') subscribeAcademia();
}
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- Academia: agenda de reuniones y clases ----------
let _acadEvents = [];
let unsubAcademia = null;
let _acadEditId = null;

function subscribeAcademia() {
  if (unsubAcademia) return;
  unsubAcademia = onSnapshot(
    query(collection(dbf, 'academiaEventos'), orderBy('fechaHora', 'asc')),
    snap => { _acadEvents = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAcademia(); },
    err => {
      console.warn('Academia', err);
      const el = document.getElementById('acadList');
      if (el) el.innerHTML = '<div class="empty" style="margin:24px 0"><span>No tienes acceso a Academia todavía.</span></div>';
    }
  );
}

function renderAcademia() {
  const el = document.getElementById('acadList');
  if (!el) return;
  if (!_acadEvents.length) {
    el.innerHTML = '<div class="empty" style="margin:24px 0"><span>Aún no hay reuniones ni clases agendadas.</span></div>';
    return;
  }
  const now = Date.now();
  const today = new Date();
  const isToday = (d) => d.toDateString() === today.toDateString();
  const fmtDT = (d) => d.toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const groups = { hoy: [], prox: [], pasados: [] };
  _acadEvents.forEach(ev => {
    const d = ev.fechaHora?.toDate?.();
    if (!d) return;
    if (isToday(d)) groups.hoy.push({ ev, d });
    else if (d.getTime() >= now) groups.prox.push({ ev, d });
    else groups.pasados.push({ ev, d });
  });
  groups.pasados.reverse();
  const card = ({ ev, d }) => {
    const past = d.getTime() < now;
    const emoji = ev.tipo === 'Clase' ? '📚' : '🤝';
    return `<button class="acad-card${past ? ' past' : ''}" data-acad-id="${escapeHtml(ev.id)}">
      <div class="acad-card-icon">${emoji}</div>
      <div class="acad-card-body">
        <div class="acad-card-title">${escapeHtml(ev.titulo || '(sin título)')}</div>
        <div class="acad-card-when">${escapeHtml(fmtDT(d))}</div>
        ${ev.descripcion ? `<div class="acad-card-desc">${escapeHtml(ev.descripcion)}</div>` : ''}
      </div>
      <span class="acad-card-tag">${escapeHtml(ev.tipo || 'Reunión')}</span>
    </button>`;
  };
  let html = '';
  if (groups.hoy.length)     html += '<div class="acad-sep">Hoy</div>' + groups.hoy.map(card).join('');
  if (groups.prox.length)    html += '<div class="acad-sep">Próximos</div>' + groups.prox.map(card).join('');
  if (groups.pasados.length) html += '<div class="acad-sep">Pasados</div>' + groups.pasados.map(card).join('');
  el.innerHTML = html;
  el.querySelectorAll('[data-acad-id]').forEach(b => b.addEventListener('click', () => openAcadSheet(b.dataset.acadId)));
}

function openAcadSheet(id) {
  _acadEditId = id || null;
  const ev = id ? _acadEvents.find(e => e.id === id) : null;
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('acadSheetTitle').textContent = ev ? 'Editar' : 'Agendar';
  document.getElementById('acadTipo').value = ev?.tipo || 'Reunión';
  document.getElementById('acadTitulo').value = ev?.titulo || '';
  document.getElementById('acadDesc').value = ev?.descripcion || '';
  const d = ev?.fechaHora?.toDate?.();
  document.getElementById('acadFecha').value = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
  document.getElementById('acadHora').value = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  document.getElementById('acadDelete').classList.toggle('hidden', !ev);
  const fb = document.getElementById('acadFeedback'); if (fb) fb.textContent = '';
  document.getElementById('acadSheet').classList.remove('hidden');
}
function closeAcadSheet() { document.getElementById('acadSheet').classList.add('hidden'); }

document.getElementById('acadBack')?.addEventListener('click', () => showView('dashboard'));
document.getElementById('acadNew')?.addEventListener('click', () => openAcadSheet(null));
document.getElementById('acadClose')?.addEventListener('click', closeAcadSheet);
document.getElementById('acadSheet')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAcadSheet(); });

document.getElementById('acadSave')?.addEventListener('click', async () => {
  const tipo = document.getElementById('acadTipo').value;
  const titulo = document.getElementById('acadTitulo').value.trim();
  const descripcion = document.getElementById('acadDesc').value.trim();
  const fecha = document.getElementById('acadFecha').value;
  const hora = document.getElementById('acadHora').value;
  const fb = document.getElementById('acadFeedback');
  if (!titulo) { fb.style.color = 'var(--warn)'; fb.textContent = 'Escribe un título.'; return; }
  if (!fecha || !hora) { fb.style.color = 'var(--warn)'; fb.textContent = 'Indica fecha y hora.'; return; }
  const dt = new Date(`${fecha}T${hora}`);
  if (isNaN(dt.getTime())) { fb.style.color = 'var(--warn)'; fb.textContent = 'Fecha u hora inválida.'; return; }
  const btn = document.getElementById('acadSave'); btn.disabled = true;
  fb.style.color = 'var(--muted)'; fb.textContent = 'Guardando…';
  try {
    if (_acadEditId) {
      await setDoc(doc(dbf, 'academiaEventos', _acadEditId), {
        tipo, titulo, descripcion, fechaHora: dt,
        notified15: false, notifiedDay: false, // reprograma los avisos
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else {
      await setDoc(doc(collection(dbf, 'academiaEventos'), uid()), {
        tipo, titulo, descripcion, fechaHora: dt,
        notified15: false, notifiedDay: false,
        createdBy: currentUser?.displayName || currentUser?.email || '',
        createdAt: serverTimestamp(),
      });
    }
    closeAcadSheet();
    showToast(_acadEditId ? 'Evento actualizado' : 'Evento agendado · avisaremos por push');
  } catch (e) {
    fb.style.color = 'var(--danger)'; fb.textContent = 'Error: ' + (e.message || e);
  } finally { btn.disabled = false; }
});

document.getElementById('acadDelete')?.addEventListener('click', async () => {
  if (!_acadEditId) return;
  if (!confirm('¿Eliminar este evento de la agenda?')) return;
  try { await deleteDoc(doc(dbf, 'academiaEventos', _acadEditId)); closeAcadSheet(); showToast('Evento eliminado'); }
  catch (e) { showToast('Error al eliminar'); }
});

// ---------- Theme Toggle ----------
function applyTheme(light, animate = false) {
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  const label = document.getElementById('themeLabel');
  const pill  = document.getElementById('themeSwitchPill');
  const wrap  = document.getElementById('themeAnimWrap');
  if (label) label.textContent = light ? 'Modo claro' : 'Modo oscuro';
  if (pill)  pill.classList.toggle('pill-on', light);
  if (animate && wrap) {
    wrap.classList.add('theme-spin');
    wrap.addEventListener('animationend', () => wrap.classList.remove('theme-spin'), { once: true });
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = light ? '#f5f7fa' : '#0a1628';
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  applyTheme(saved === 'light', false);
})();

document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
  const light = document.documentElement.getAttribute('data-theme') !== 'light';
  localStorage.setItem('theme', light ? 'light' : 'dark');
  applyTheme(light, true);
});

// ---------- Quick Access Tiles ----------
document.getElementById('quickTileQuotes')?.addEventListener('click', () => showView('quotes'));
document.getElementById('quickTileClients')?.addEventListener('click', () => showView('clients'));

// ── Notificar usuarios (admin): ver usuarios + push dirigida/grupo/masiva con confirmación ──
let _pushUsers = [];
let _pushAll = true;
const _pushSel = new Set();
let _pushDeliveryUnsub = null;

function openUsersPush() {
  document.getElementById('usersPushSheet')?.classList.remove('hidden');
  loadPushUsers();
}
function closeUsersPush() {
  document.getElementById('usersPushSheet')?.classList.add('hidden');
  if (_pushDeliveryUnsub) { _pushDeliveryUnsub(); _pushDeliveryUnsub = null; }
}

function updatePushSelCount() {
  const el = document.getElementById('upSelCount');
  if (!el) return;
  el.textContent = _pushAll ? '· todos' : `· ${_pushSel.size} seleccionado${_pushSel.size !== 1 ? 's' : ''}`;
  el.style.color = _pushAll ? 'var(--muted)' : 'var(--accent)';
}

function renderPushUsers() {
  const listEl = document.getElementById('upUsersList');
  if (!listEl) return;
  if (!_pushUsers.length) { listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 2px">Sin usuarios registrados.</div>'; return; }
  listEl.innerHTML = _pushUsers.map(u => {
    const name = u.displayName || u.email || '—';
    const init = (name.trim()[0] || '?').toUpperCase();
    const av = u.photoURL ? `<div class="up-user-av"><img src="${escapeHtml(u.photoURL)}" alt=""></div>` : `<div class="up-user-av">${escapeHtml(init)}</div>`;
    const tok = u.tokens > 0 ? `<span class="up-user-tok on">📱 ${u.tokens}</span>` : '<span class="up-user-tok off">sin push</span>';
    const checked = _pushSel.has(u.uid) ? ' checked' : '';
    return `<label class="up-user${_pushAll ? ' dim' : ''}">
      <input type="checkbox" class="up-chk" data-uid="${escapeHtml(u.uid)}"${checked}${_pushAll ? ' disabled' : ''}>
      ${av}
      <div class="up-user-info"><div class="up-user-name">${escapeHtml(name)}</div><div class="up-user-mail">${escapeHtml(u.email || '')}</div></div>
      ${tok}
    </label>`;
  }).join('');
  listEl.querySelectorAll('.up-chk').forEach(chk => chk.addEventListener('change', () => {
    if (chk.checked) _pushSel.add(chk.dataset.uid); else _pushSel.delete(chk.dataset.uid);
    updatePushSelCount();
  }));
}

async function loadPushUsers() {
  const listEl = document.getElementById('upUsersList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 2px">Cargando usuarios…</div>';
  updatePushSelCount();
  try {
    const snap = await getDocs(collection(dbf, 'users'));
    _pushUsers = await Promise.all(snap.docs.map(async d => {
      let tokens = 0;
      try { tokens = (await getDocs(collection(dbf, 'users', d.id, 'fcmTokens'))).size; } catch (_) {}
      return { uid: d.id, ...d.data(), tokens };
    }));
    _pushUsers.sort((a, b) => (b.tokens - a.tokens) || (a.displayName || '').localeCompare(b.displayName || ''));
    const countEl = document.getElementById('quickCountUsers');
    if (countEl) countEl.textContent = _pushUsers.length;
    renderPushUsers();
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:8px 2px">No se pudieron cargar los usuarios: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

document.getElementById('upAll')?.addEventListener('change', (e) => {
  _pushAll = e.target.checked;
  updatePushSelCount();
  renderPushUsers();
});
document.getElementById('quickTilePush')?.addEventListener('click', openUsersPush);
document.getElementById('usersPushClose')?.addEventListener('click', closeUsersPush);
document.getElementById('usersPushSheet')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeUsersPush(); });

document.getElementById('upSend')?.addEventListener('click', async () => {
  const title = document.getElementById('upTitle')?.value.trim();
  const body  = document.getElementById('upBody')?.value.trim() || '';
  const fb  = document.getElementById('upFeedback');
  const btn = document.getElementById('upSend');
  if (!title) { if (fb) { fb.style.color = 'var(--warn)'; fb.textContent = 'Escribe un título.'; } return; }
  if (!_pushAll && _pushSel.size === 0) { if (fb) { fb.style.color = 'var(--warn)'; fb.textContent = 'Marca «todos» o selecciona al menos un usuario.'; } return; }

  const payload = _pushAll ? { target: 'all' } : { targets: [..._pushSel] };
  const destLabel = _pushAll ? 'todos los usuarios' : `${_pushSel.size} usuario${_pushSel.size !== 1 ? 's' : ''}`;
  btn.disabled = true; if (fb) { fb.style.color = 'var(--muted)'; fb.textContent = 'Enviando…'; }
  try {
    const id = uid();
    await setDoc(doc(collection(dbf, 'adminBroadcasts'), id), {
      title, body, ...payload,
      status: 'sending',
      createdAt: serverTimestamp(),
      sentBy: currentUser?.displayName || currentUser?.email || 'Admin',
    });
    if (fb) { fb.style.color = 'var(--muted)'; fb.textContent = `Enviando a ${destLabel}…`; }
    document.getElementById('upTitle').value = '';
    document.getElementById('upBody').value = '';
    // Confirmación de entrega: la Cloud Function actualiza el doc con "sent"
    if (_pushDeliveryUnsub) _pushDeliveryUnsub();
    _pushDeliveryUnsub = onSnapshot(doc(dbf, 'adminBroadcasts', id), s => {
      const d = s.data();
      if (d && d.status === 'sent') {
        if (fb) { fb.style.color = 'var(--success)'; fb.textContent = `✓ Entregada a ${d.sent} dispositivo${d.sent !== 1 ? 's' : ''}.`; }
        if (_pushDeliveryUnsub) { _pushDeliveryUnsub(); _pushDeliveryUnsub = null; }
      }
    }, () => {});
    setTimeout(() => { if (_pushDeliveryUnsub) { _pushDeliveryUnsub(); _pushDeliveryUnsub = null; } }, 30000);
  } catch (e) {
    if (fb) { fb.style.color = 'var(--danger)'; fb.textContent = 'Error: ' + (e.message || e); }
  } finally { btn.disabled = false; }
});
document.getElementById('quickNewQuote')?.addEventListener('click', () => openQuoteForm());
document.getElementById('quickNewClient')?.addEventListener('click', () => openClientForm());

function updateQuickCounts() {
  const qEl = document.getElementById('quickCountQuotes');
  const cEl = document.getElementById('quickCountClients');
  if (qEl) qEl.textContent = quotes.length;
  if (cEl) cEl.textContent = clients.length;
}

// ---------- FAB ----------
const fab = document.getElementById('fab');
const sheet = document.getElementById('fabMenu');
fab.addEventListener('click', () => sheet.classList.remove('hidden'));
document.getElementById('closeSheet').addEventListener('click', () => sheet.classList.add('hidden'));
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
sheet.querySelectorAll('[data-new]').forEach(btn => {
  btn.addEventListener('click', () => {
    sheet.classList.add('hidden');
    if (btn.dataset.new === 'quote') openQuoteForm();
    else openClientForm();
  });
});

// ---------- Modal Cotización ----------
const quoteModal = document.getElementById('quoteModal');
const quoteForm = document.getElementById('quoteForm');
let editingQuoteId = null;
let _editingTipo = '';
let _editingIndustriaQuote = '';
let _quoteItems = [];
let _proyectoSheetId = null;
let _hitosTemp = [];

function openQuoteForm(id, prefill = null) {
  editingQuoteId = id || null;
  _pendingVersionParentId = prefill?._parentId || null;
  _pendingVersionNum = prefill?._version || null;
  quoteForm.reset();
  document.getElementById('quoteTitle').textContent = id ? 'Editar cotización' : 'Nueva cotización';
  document.getElementById('quoteDelete').hidden = !id;
  if (id) {
    const q = quotes.find(x => x.id === id);
    if (q) {
      quoteForm.empresa.value = q.empresa || '';
      quoteForm.numero.value = q.numero || '';
      quoteForm.fecha.value = q.fecha || '';
      quoteForm.descripcion.value = q.descripcion || '';
      quoteForm.valor.value = q.valor != null ? q.valor : '';
      quoteForm.rut.value = q.rut || '';
      quoteForm.contactos.value = q.contactos || '';
      quoteForm.estado.value = q.estado || 'Borrador';
      quoteForm.seguimiento.value = q.seguimiento || '';
      quoteForm.formaPago.value = q.formaPago || '';
      quoteForm.validezDias.value = q.validezDias != null ? q.validezDias : '';
      quoteForm.notas.value = q.notas || '';
      _editingTipo = q.tipoServicio || '';
      _editingIndustriaQuote = q.industria || '';
      _quoteItems = q.items ? q.items.map(i => ({...i})) : [];
      // Academia fields
      if (q.tipoServicio === 'Academia') {
        if (quoteForm.cursoNombre) quoteForm.cursoNombre.value = q.cursoNombre || '';
        if (quoteForm.cursoFecha) quoteForm.cursoFecha.value = q.cursoFecha || '';
        if (quoteForm.cursoModalidad) quoteForm.cursoModalidad.value = q.cursoModalidad || '';
        if (quoteForm.cursoCupos) quoteForm.cursoCupos.value = q.cursoCupos != null ? q.cursoCupos : '';
        if (quoteForm.cursoInscritos) quoteForm.cursoInscritos.value = q.cursoInscritos != null ? q.cursoInscritos : '';
      }
    }
  } else if (prefill) {
    quoteForm.empresa.value = prefill.empresa || '';
    quoteForm.numero.value = prefill.numero || '';
    quoteForm.fecha.value = prefill.fecha || new Date().toISOString().slice(0,10);
    quoteForm.descripcion.value = prefill.descripcion || '';
    quoteForm.valor.value = prefill.valor != null ? prefill.valor : '';
    quoteForm.rut.value = prefill.rut || '';
    quoteForm.contactos.value = prefill.contactos || '';
    quoteForm.estado.value = prefill.estado || 'Borrador';
    quoteForm.seguimiento.value = prefill.seguimiento || '';
    quoteForm.formaPago.value = prefill.formaPago || '';
    quoteForm.validezDias.value = prefill.validezDias != null ? prefill.validezDias : '';
    quoteForm.notas.value = prefill.notas || '';
    _editingTipo = prefill.tipoServicio || '';
    _editingIndustriaQuote = prefill.industria || '';
    _quoteItems = prefill.items ? prefill.items.map(i => ({...i})) : [];
  } else {
    quoteForm.fecha.value = new Date().toISOString().slice(0,10);
    quoteForm.estado.value = 'Borrador';
    _editingTipo = '';
    _editingIndustriaQuote = '';
    _quoteItems = [];
  }
  updateTipoChips();
  updateIndustriaChips('quote');
  renderQuoteItems();
  const ufField = document.getElementById('quoteValorUf');
  if (ufField) ufField.value = '';
  updateUfHint();
  quoteModal.classList.remove('hidden');
}

document.getElementById('quoteClose').addEventListener('click', () => quoteModal.classList.add('hidden'));

document.getElementById('quoteSave').addEventListener('click', async () => {
  const data = {
    empresa: quoteForm.empresa.value.trim(),
    numero: quoteForm.numero.value.trim(),
    fecha: quoteForm.fecha.value,
    descripcion: quoteForm.descripcion.value.trim(),
    valor: parseValor(quoteForm.valor.value),
    rut: quoteForm.rut.value.trim(),
    contactos: quoteForm.contactos.value.trim(),
    estado: quoteForm.estado.value,
    seguimiento: quoteForm.seguimiento.value || '',
    formaPago: quoteForm.formaPago.value.trim(),
    validezDias: parseInt(quoteForm.validezDias.value) || null,
    notas: quoteForm.notas.value.trim(),
    tipoServicio: _editingTipo,
    industria: _editingIndustriaQuote,
    items: _quoteItems,
    ...((_editingTipo === 'Academia') ? {
      cursoNombre: (quoteForm.cursoNombre?.value || '').trim(),
      cursoFecha: quoteForm.cursoFecha?.value || '',
      cursoModalidad: quoteForm.cursoModalidad?.value || '',
      cursoCupos: parseInt(quoteForm.cursoCupos?.value) || null,
      cursoInscritos: parseInt(quoteForm.cursoInscritos?.value) || null,
    } : {}),
  };
  if (!data.empresa || !data.numero || !data.fecha) {
    showToast('Empresa, N° y fecha son obligatorios');
    return;
  }
  try {
    const id = editingQuoteId || uid();
    // Compute change log if editing
    const logEntries = [];
    if (editingQuoteId) {
      const prev = quotes.find(x => x.id === editingQuoteId);
      if (prev) {
        const fields = { empresa:'Empresa', numero:'N°', fecha:'Fecha', descripcion:'Descripción', valor:'Valor', estado:'Estado', seguimiento:'Seguimiento' };
        const changes = Object.entries(fields)
          .filter(([k]) => String(prev[k]||'') !== String(data[k]||''))
          .map(([k, label]) => `${label}: ${prev[k]||'—'} → ${data[k]||'—'}`);
        if (changes.length) logEntries.push({ t: new Date().toISOString(), u: currentUser.displayName || currentUser.email, d: changes.join(' · ') });
      }
    }
    await setDoc(doc(quotesCol(), id), {
      id, ...data,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      ...(editingQuoteId
        ? (logEntries.length ? { _log: arrayUnion(...logEntries) } : {})
        : {
            createdAt: serverTimestamp(), createdBy: currentUser.uid, _log: [],
            ...(_pendingVersionParentId ? { parentId: _pendingVersionParentId, version: _pendingVersionNum } : {}),
          })
    }, { merge: true });
    _pendingVersionParentId = null; _pendingVersionNum = null;
    logActivity(editingQuoteId ? 'quote_edit' : 'quote_new', `${data.numero} · ${data.empresa}`).catch(() => {});
    await ensureClientForCompany(data.empresa, data.contactos);
    quoteModal.classList.add('hidden');
    showToast('Cotización guardada');
  } catch (e) {
    console.error(e); showToast('Error guardando: ' + e.message);
  }
});

document.getElementById('quoteDelete').addEventListener('click', async () => {
  if (!editingQuoteId) return;
  if (!confirm('¿Eliminar esta cotización?')) return;
  try {
    const qDel = quotes.find(x => x.id === editingQuoteId);
    await deleteDoc(doc(quotesCol(), editingQuoteId));
    if (qDel) logActivity('quote_delete', `${qDel.numero} · ${qDel.empresa}`).catch(() => {});
    quoteModal.classList.add('hidden');
    showToast('Cotización eliminada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
});

async function ensureClientForCompany(empresa, contactos) {
  if (!empresa) return;
  if (clients.some(c => c.empresa.toLowerCase() === empresa.toLowerCase())) return;
  const emails = (contactos || '').split(';').map(s => s.trim()).filter(Boolean);
  const id = uid();
  await setDoc(doc(clientsCol(), id), {
    id, empresa,
    nombre: '', email: emails[0] || '',
    telefono: '', cargo: '', notas: '',
    createdAt: serverTimestamp(), createdBy: currentUser.uid,
  });
}

// ---------- Detalle Cotización ----------
const detailModal = document.getElementById('quoteDetail');
let detailQuoteId = null;

function openQuoteDetail(id) {
  const q = quotes.find(x => x.id === id);
  if (!q) return;
  detailQuoteId = id;
  const family = getVersionFamily(q);
  const emails = (q.contactos || '').split(';').map(s => s.trim()).filter(Boolean);
  const estadoClass = (q.estado || 'Borrador').split(' ')[0];
  const sm = getSeguimientoStatus(q);

  const ESTADOS = ['Borrador','Enviada','En revisión','Adjudicada','Perdida'];
  const client = clients.find(c => c.empresa.toLowerCase() === q.empresa.toLowerCase());
  const clientPhone = client?.telefono?.replace(/\D/g,'') || '';
  const waText = encodeURIComponent(
    `Hola, te contacto respecto a la cotización *${q.numero}* — *${q.empresa}*\n` +
    `${q.descripcion ? q.descripcion + '\n' : ''}` +
    `Valor: ${formatCLP(q.valor)}\nEstado: ${q.estado || 'Borrador'}`
  );
  const waUrl = clientPhone
    ? `https://wa.me/56${clientPhone.replace(/^56/,'')}?text=${waText}`
    : `https://wa.me/?text=${waText}`;

  document.getElementById('detailBody').innerHTML = `
    <h3>${escapeHtml(q.numero)}</h3>
    <div class="det-company">${escapeHtml(q.empresa)}</div>
    ${(q.tipoServicio || q.industria) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${q.tipoServicio ? `<span class="tag-tipo">${escapeHtml(q.tipoServicio)}</span>` : ''}
      ${q.industria ? `<span class="tag-industria">${escapeHtml(q.industria)}</span>` : ''}
    </div>` : ''}

    <div class="estado-chips" id="estadoChips">
      ${ESTADOS.map(e => `<button class="estado-chip${q.estado === e ? ' active' : ''}" data-estado="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}
    </div>

    <div class="detail-row"><span class="lbl">Fecha</span><span class="val">${formatDate(q.fecha)}</span></div>
    <div class="detail-row"><span class="lbl">Valor</span><span class="val"><strong>${formatCLP(q.valor)}</strong></span></div>
    <div class="detail-row"><span class="lbl">Descripción</span><span class="val">${escapeHtml(q.descripcion || '—')}</span></div>

    ${q.items && q.items.length ? `<div class="detail-row">
      <span class="lbl">Servicios</span>
      <div class="val items-table">
        ${q.items.map(item => `
          <div class="items-table-row">
            <span class="items-desc">${escapeHtml(item.descripcion||'—')}</span>
            <span class="items-meta">${item.cantidad||1} × ${formatCLP(item.valorUnit)} = ${formatCLP((item.cantidad||1)*(Number(item.valorUnit)||0))}</span>
          </div>`).join('')}
        <div class="items-table-total">Total: ${formatCLP(q.valor)}</div>
      </div>
    </div>` : ''}

    ${q.tipoServicio === 'Academia' && (q.cursoNombre || q.cursoFecha || q.cursoModalidad) ? `
    <div class="detail-row"><span class="lbl">Curso</span><span class="val">${escapeHtml(q.cursoNombre||'—')}</span></div>
    ${q.cursoFecha ? `<div class="detail-row"><span class="lbl">Fecha curso</span><span class="val">${formatDate(q.cursoFecha)}</span></div>` : ''}
    ${q.cursoModalidad ? `<div class="detail-row"><span class="lbl">Modalidad</span><span class="val">${escapeHtml(q.cursoModalidad)}</span></div>` : ''}
    ${q.cursoCupos ? `<div class="detail-row"><span class="lbl">Cupos</span><span class="val">${q.cursoInscritos||0} / ${q.cursoCupos} inscritos</span></div>` : ''}
    ` : ''}

    <div class="seg-detail-box">
      <div class="seg-detail-header">
        <span class="lbl">Seguimiento</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${sm ? `<button class="btn-seg-link" id="detailCalBtn" title="Agregar al calendario">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:3px"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"/></svg>Cal</button>` : ''}
          <button class="btn-seg-link" id="segUpdateBtn">${sm ? '↻ Actualizar' : '＋ Programar'}</button>
        </div>
      </div>
      ${sm
        ? `<div class="sm-row" style="margin:0">
             <span class="sm-dot ${sm.key}${sm.key === 'red' ? ' pulse' : ''}"></span>
             <span class="sm-label ${sm.key}">${sm.label}</span>
             <span class="sm-date">${formatDate(q.seguimiento)}</span>
           </div>`
        : `<span class="seg-no-date">Sin fecha programada</span>`
      }
    </div>

    <div class="detail-row"><span class="lbl">Contactos</span><span class="val">${
      emails.length
        ? emails.map(e => `<div><a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`).join('')
        : '—'
    }</span></div>
    ${q.notas ? `<div class="detail-row"><span class="lbl">Notas</span><div class="val">${
      parseNotes(q.notas).map(n => {
        const m = parseNoteMeta(n);
        const meta = [m.ts && escapeHtml(m.ts), m.author && `<b>${escapeHtml(m.author)}</b>`, m.tag && escapeHtml(m.tag)].filter(Boolean).join(' · ');
        return `<div style="margin-bottom:8px">${meta ? `<div style="font-size:11px;color:var(--muted);margin-bottom:1px">${meta}</div>` : ''}<div>${escapeHtml(m.text).replace(/\n/g,'<br>')}</div></div>`;
      }).join('')
    }</div></div>` : ''}

    ${q._log && q._log.length ? `
    <div class="detail-row history-row">
      <span class="lbl">Historial</span>
      <div class="val">
        ${[...q._log].reverse().slice(0,10).map(e => `
          <div class="history-entry">
            <span class="history-user">${escapeHtml(e.u||'')}</span>
            <span class="history-desc">${escapeHtml(e.d||'')}</span>
            <span class="history-ts">${new Date(e.t).toLocaleDateString('es-CL', {day:'2-digit', month:'short', year:'2-digit'})}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${family.length > 1 ? `
    <div class="detail-row">
      <span class="lbl">Versiones (${family.length})</span>
      <div class="val versions-list">
        ${family.map(v => `
          <div class="version-item${v.id === q.id ? ' ver-current' : ' ver-other'}" data-ver-id="${escapeHtml(v.id)}">
            <span class="ver-badge">v${v.version||1}</span>
            <span class="ver-numero">${escapeHtml(v.numero)}</span>
            <span class="tag estado-${escapeHtml((v.estado||'Borrador').split(' ')[0])}" style="font-size:11px;padding:2px 6px">${escapeHtml(v.estado||'Borrador')}</span>
            ${v.valor != null ? `<span style="font-size:11px;color:var(--muted);margin-left:auto">${formatCLPShort(v.valor)}</span>` : ''}
            ${v.id === q.id ? `<span style="font-size:11px;color:var(--accent);font-weight:600;margin-left:4px">← actual</span>` : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>`}
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <div class="detail-actions">
      ${emails.length ? `<a class="btn" href="mailto:${escapeHtml(emails.join(','))}?subject=${encodeURIComponent('Cotización ' + q.numero + ' - ' + q.empresa)}">✉ Enviar correo</a>` : ''}
      <a class="btn btn-outline" href="${waUrl}" target="_blank" rel="noopener" style="background:rgba(37,211,102,.1);border-color:rgba(37,211,102,.3);color:#25D366">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <button class="btn btn-outline" id="detailPDF" style="background:rgba(249,115,22,.1);border-color:rgba(249,115,22,.35);color:var(--accent)">📄 PDF</button>
      <button class="btn btn-outline" id="detailExportHist">⬇ Historial</button>
      <button class="btn btn-outline" id="detailShare">Compartir</button>
      <button class="btn btn-outline" id="detailDuplicate">Duplicar</button>
      <button class="btn btn-outline" id="detailNewVersion">Nueva versión</button>
      <button class="btn btn-outline" id="detailSaveTemplate">Guardar plantilla</button>
      <button class="btn btn-outline" id="detailDictate">🎤 Dictar avance</button>
    </div>
  `;
  detailModal.classList.remove('hidden');

  // Estado chips — instant save
  document.getElementById('estadoChips')?.querySelectorAll('.estado-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const newEstado = chip.dataset.estado;
      if (newEstado === q.estado) return;
      try {
        await setDoc(doc(quotesCol(), id), { estado: newEstado, updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
        logActivity('quote_estado', `${q.numero}: ${newEstado}`).catch(() => {});
        showToast(`Estado: ${newEstado}`);
      } catch (e) { showToast('Error: ' + e.message); }
    });
  });

  // Seguimiento update button
  document.getElementById('segUpdateBtn')?.addEventListener('click', () => openSeguimientoSheet(id));

  const pdfBtn = document.getElementById('detailPDF');
  if (pdfBtn) pdfBtn.addEventListener('click', async () => {
    const orig = pdfBtn.innerHTML;
    pdfBtn.disabled = true; pdfBtn.innerHTML = '⏳ Generando…';
    try {
      const { buildQuotePdf } = await import('./lib/quote-pdf.js');
      const { blob, filename } = await buildQuotePdf(q, {
        ufValue: _ufValue,
        emitter: currentUser?.displayName || currentUser?.email || '',
        logoUrl: '/icon-512.png',
      });
      const file = new File([blob], filename, { type: 'application/pdf' });
      // En móvil: hoja de compartir (WhatsApp/correo). En desktop: descarga.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Cotización ${q.numero}`, text: `Cotización ${q.numero} · ${q.empresa}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast('PDF descargado');
      }
      logActivity('quote_pdf', `${q.numero} · ${q.empresa}`).catch(() => {});
    } catch (e) {
      if (e?.name !== 'AbortError') { console.error('PDF', e); showToast('No se pudo generar el PDF: ' + (e?.message || e)); }
    } finally {
      pdfBtn.disabled = false; pdfBtn.innerHTML = orig;
    }
  });

  document.getElementById('detailExportHist')?.addEventListener('click', () => {
    const lines = [`HISTORIAL · ${q.numero} · ${q.empresa}`, `Exportado: ${new Date().toLocaleString('es-CL')}`, ''];
    if (q._log && q._log.length) {
      lines.push('── CAMBIOS ──');
      [...q._log].reverse().forEach(e => lines.push(`• ${new Date(e.t).toLocaleString('es-CL')} · ${e.u || '—'} · ${e.d || ''}`));
      lines.push('');
    }
    if (q.notas) {
      lines.push('── NOTAS ──');
      parseNotes(q.notas).forEach(n => {
        const m = parseNoteMeta(n);
        lines.push(`• ${[m.ts, m.author, m.tag].filter(Boolean).join(' · ')}: ${m.text.replace(/\n/g, ' ')}`);
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `historial_${(q.numero || 'cot').replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('Historial exportado');
  });

  const shareBtn = document.getElementById('detailShare');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const sm = getSeguimientoStatus(q);
    const lines = [
      `📋 *COTIZACIÓN ${q.numero}*`,
      `🏢 *${q.empresa}*`,
      q.descripcion ? `📝 ${q.descripcion}` : null,
      `💰 Valor: *${formatCLP(q.valor)}*`,
      `📊 Estado: ${q.estado || 'Borrador'}`,
      `📅 Fecha: ${formatDate(q.fecha)}`,
      q.seguimiento ? `📌 Seguimiento: ${formatDate(q.seguimiento)}` : null,
      q.contactos ? `✉ Contactos: ${q.contactos}` : null,
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      try { await navigator.share({ title: `Cotización ${q.numero}`, text: lines }); return; }
      catch {}
    }
    try { await navigator.clipboard.writeText(lines); showToast('Copiado al portapapeles'); }
    catch { showToast('No se pudo copiar'); }
  });

  document.getElementById('detailDuplicate')?.addEventListener('click', () => {
    detailModal.classList.add('hidden');
    openQuoteForm(null, {
      empresa: q.empresa,
      descripcion: q.descripcion,
      valor: q.valor,
      contactos: q.contactos,
      estado: 'Borrador',
      fecha: new Date().toISOString().slice(0,10),
      numero: '',
      seguimiento: '',
      notas: '',
      tipoServicio: q.tipoServicio || '',
      industria: q.industria || '',
      items: q.items ? q.items.map(i => ({...i, id: uid()})) : [],
    });
  });

  document.getElementById('detailSaveTemplate')?.addEventListener('click', () => saveAsTemplate(q));

  document.getElementById('detailDictate')?.addEventListener('click', () => {
    _dictateTarget = { type: 'quote', id };
    openDictateSheet('Dictar avance · ' + q.numero);
  });

  document.getElementById('detailCalBtn')?.addEventListener('click', () => downloadICS(q));

  document.getElementById('detailNewVersion')?.addEventListener('click', () => {
    detailModal.classList.add('hidden');
    const parentId = q.parentId || q.id;
    const nextVer = (q.version || 1) + 1;
    openQuoteForm(null, {
      empresa: q.empresa, descripcion: q.descripcion,
      valor: q.valor, contactos: q.contactos,
      estado: 'Borrador', fecha: new Date().toISOString().slice(0, 10),
      numero: nextVersionNumero(q.numero),
      seguimiento: '', notas: '',
      tipoServicio: q.tipoServicio || '', industria: q.industria || '',
      items: q.items ? q.items.map(i => ({ ...i, id: uid() })) : [],
      _parentId: parentId, _version: nextVer,
    });
  });

  document.querySelectorAll('[data-ver-id]').forEach(el => {
    el.addEventListener('click', () => {
      const vid = el.dataset.verId;
      if (vid && vid !== q.id) openQuoteDetail(vid);
    });
  });
}

document.getElementById('detailClose').addEventListener('click', () => detailModal.classList.add('hidden'));
document.getElementById('detailEdit').addEventListener('click', () => {
  detailModal.classList.add('hidden');
  openQuoteForm(detailQuoteId);
});

// ---------- Modal Cliente ----------
const clientModal = document.getElementById('clientModal');
const clientForm = document.getElementById('clientForm');
let editingClientId = null;
let clientNotasArr = [];
let clientResultadosArr = [];
let _editingIndustriaClient = '';

// ── Anotaciones con trazabilidad (autor + origen/categoría) ──
const NOTE_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function currentUserName() {
  const u = currentUser;
  return ((u && (u.displayName || u.email)) || 'Anónimo').split(' ')[0];
}
// Sello de nota: [fecha · autor · etiqueta]  (etiqueta = origen o categoría)
function noteStamp(meta = {}) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())} ${NOTE_MONTHS[now.getMonth()]} ${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const parts = [date, currentUserName()];
  if (meta.tag) parts.push(meta.tag);
  return `[${parts.join(' · ')}]`;
}
// Extrae metadatos de una línea de nota (retrocompatible con sellos viejos sin autor)
function parseNoteMeta(line) {
  const m = String(line).match(/^\[([^\]]+)\]\s?([\s\S]*)$/);
  if (!m) return { ts: '', author: '', tag: '', text: String(line) };
  const parts = m[1].split('·').map(s => s.trim());
  return { ts: parts[0] || '', author: parts[1] || '', tag: parts[2] || '', text: m[2] };
}

function parseNotes(notasStr) {
  if (!notasStr || !notasStr.trim()) return [];
  const tsRe = /^\[\d{2} \w+ \d{4} \d{2}:\d{2}/;
  const lines = notasStr.split('\n');
  if (!lines.some(l => tsRe.test(l))) return [notasStr.trim()];
  const notes = [];
  let cur = null;
  for (const line of lines) {
    if (tsRe.test(line)) { if (cur !== null) notes.push(cur.trim()); cur = line; }
    else if (cur !== null) cur += '\n' + line;
  }
  if (cur !== null && cur.trim()) notes.push(cur.trim());
  return notes;
}

function renderClientNotes() {
  const el = document.getElementById('clientNotesList');
  if (!el) return;
  if (!clientNotasArr.length) {
    el.innerHTML = '<div class="notes-empty">Sin notas aún</div>';
    return;
  }
  el.innerHTML = clientNotasArr.map((note, i) => {
    const meta = parseNoteMeta(note);
    const text = meta.text || note;
    const metaParts = [];
    if (meta.ts) metaParts.push(escapeHtml(meta.ts));
    if (meta.author) metaParts.push(`<b>${escapeHtml(meta.author)}</b>`);
    if (meta.tag) metaParts.push(escapeHtml(meta.tag));
    return `<div class="note-item">
      <div class="note-meta">
        <span class="note-ts">${metaParts.join(' · ')}</span>
        <div class="note-actions">
          <button type="button" class="icon-btn note-edit-btn" data-idx="${i}" aria-label="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
          </button>
          <button type="button" class="icon-btn note-del-btn" data-idx="${i}" aria-label="Eliminar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.021-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
          </button>
        </div>
      </div>
      <div class="note-text" id="nt-text-${i}">${escapeHtml(text).replace(/\n/g,'<br>')}</div>
      <div class="note-edit-area hidden" id="nt-edit-${i}">
        <textarea rows="2">${escapeHtml(text)}</textarea>
        <div class="note-edit-btns">
          <button type="button" class="btn btn-sm btn-ghost note-cancel-btn" data-idx="${i}">Cancelar</button>
          <button type="button" class="btn btn-sm note-ok-btn" data-idx="${i}">Guardar</button>
        </div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.note-edit-btn').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.idx;
    document.getElementById(`nt-text-${i}`).classList.add('hidden');
    document.getElementById(`nt-edit-${i}`).classList.remove('hidden');
    document.querySelector(`#nt-edit-${i} textarea`).focus();
  }));
  el.querySelectorAll('.note-cancel-btn').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.idx;
    document.getElementById(`nt-text-${i}`).classList.remove('hidden');
    document.getElementById(`nt-edit-${i}`).classList.add('hidden');
  }));
  el.querySelectorAll('.note-ok-btn').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.idx);
    const newText = document.querySelector(`#nt-edit-${i} textarea`).value.trim();
    if (!newText) return;
    const m = clientNotasArr[i].match(/^\[[^\]]+\]\s?/);
    clientNotasArr[i] = m ? `${m[0]}${newText}` : newText;
    renderClientNotes();
  }));
  el.querySelectorAll('.note-del-btn').forEach(b => b.addEventListener('click', () => {
    clientNotasArr.splice(parseInt(b.dataset.idx), 1);
    renderClientNotes();
  }));
}

function openClientForm(id) {
  editingClientId = id || null;
  clientForm.reset();
  clientNotasArr = [];
  clientResultadosArr = [];
  clientExtraContactos = [];
  _editingIndustriaClient = '';
  document.getElementById('clientTitle').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientDelete').hidden = !id;
  if (id) {
    const c = clients.find(x => x.id === id);
    if (c) {
      clientForm.empresa.value = c.empresa || '';
      clientForm.nombre.value = c.nombre || '';
      clientForm.email.value = c.email || '';
      clientForm.telefono.value = c.telefono || '';
      clientForm.cargo.value = c.cargo || '';
      clientNotasArr = parseNotes(c.notas || '');
      clientResultadosArr = parseNotes(c.resultados || '');
      clientExtraContactos = Array.isArray(c.extraContactos) ? c.extraContactos.map(x => ({ ...x })) : [];
      _editingIndustriaClient = c.industria || '';
    }
  }
  renderClientNotes();
  renderClientResultados();
  renderExtraContactos();
  updateIndustriaChips('client');
  clientModal.classList.remove('hidden');
}

document.getElementById('clientClose').addEventListener('click', () => clientModal.classList.add('hidden'));

function renderExtraContactos() {
  const el = document.getElementById('extraContactosList');
  if (!el) return;
  if (!clientExtraContactos.length) { el.innerHTML = ''; return; }
  el.innerHTML = clientExtraContactos.map((c, i) => `
    <div class="extra-contact-item">
      <div class="extra-contact-row">
        <input class="ec-input" placeholder="Nombre" value="${escapeHtml(c.nombre||'')}" data-ec-idx="${i}" data-ec-field="nombre">
        <input class="ec-input" placeholder="Email" value="${escapeHtml(c.email||'')}" data-ec-idx="${i}" data-ec-field="email">
      </div>
      <div class="extra-contact-row">
        <input class="ec-input" placeholder="Cargo" value="${escapeHtml(c.cargo||'')}" data-ec-idx="${i}" data-ec-field="cargo">
        <input class="ec-input" placeholder="Teléfono" value="${escapeHtml(c.telefono||'')}" data-ec-idx="${i}" data-ec-field="telefono">
      </div>
      <button type="button" class="icon-btn ec-del-btn" data-ec-idx="${i}" aria-label="Eliminar contacto" style="margin-top:4px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.021-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
      </button>
    </div>
  `).join('');

  el.querySelectorAll('.ec-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.ecIdx);
      const field = inp.dataset.ecField;
      clientExtraContactos[idx][field] = inp.value;
    });
  });
  el.querySelectorAll('.ec-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      clientExtraContactos.splice(parseInt(btn.dataset.ecIdx), 1);
      renderExtraContactos();
    });
  });
}

document.getElementById('addExtraContacto')?.addEventListener('click', () => {
  clientExtraContactos.push({ nombre: '', email: '', cargo: '', telefono: '' });
  renderExtraContactos();
});

document.getElementById('clientNoteAdd').addEventListener('click', () => {
  const input = document.getElementById('clientNoteInput');
  const text = input.value.trim();
  if (!text) return;
  clientNotasArr.push(`${noteStamp({ tag: '✍️ manual' })} ${text}`);
  input.value = '';
  renderClientNotes();
});

document.getElementById('clientSave').addEventListener('click', async () => {
  const data = {
    empresa: clientForm.empresa.value.trim(),
    nombre: clientForm.nombre.value.trim(),
    email: clientForm.email.value.trim(),
    telefono: clientForm.telefono.value.trim(),
    cargo: clientForm.cargo.value.trim(),
    notas: clientNotasArr.join('\n'),
    resultados: clientResultadosArr.join('\n'),
    extraContactos: clientExtraContactos,
    industria: _editingIndustriaClient,
  };
  if (!data.empresa) { showToast('La empresa es obligatoria'); return; }
  try {
    const id = editingClientId || uid();
    await setDoc(doc(clientsCol(), id), {
      id, ...data,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      ...(editingClientId ? {} : { createdAt: serverTimestamp(), createdBy: currentUser.uid })
    }, { merge: true });
    logActivity(editingClientId ? 'client_edit' : 'client_new', data.empresa).catch(() => {});
    clientModal.classList.add('hidden');
    showToast('Cliente guardado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
});

document.getElementById('clientDelete').addEventListener('click', async () => {
  if (!editingClientId) return;
  if (!confirm('¿Eliminar este cliente?')) return;
  const cDel = clients.find(x => x.id === editingClientId);
  await deleteDoc(doc(clientsCol(), editingClientId));
  if (cDel) logActivity('client_delete', cDel.empresa).catch(() => {});
  clientModal.classList.add('hidden');
  showToast('Cliente eliminado');
});

// ---------- Buscadores ----------
document.getElementById('search-quotes').addEventListener('input', () => {
  if (_quotesView === 'pipeline') { renderPipeline(); return; }
  if (_quotesView === 'proyectos') { renderProyectos(); return; }
  renderQuotes();
});
document.getElementById('search-clients').addEventListener('input', () => { clientsPage = 0; renderClients(); });

// ---------- Filtros event listeners ----------
document.getElementById('quotesFilterToggle')?.addEventListener('click', () => {
  document.getElementById('quotesFilterBar').classList.toggle('hidden');
});

// Estado (multi-select)
document.getElementById('filterEstadoChips')?.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.sfchip');
  if (!chip) return;
  const e = chip.dataset.estado;
  const idx = quotesFilters.estados.indexOf(e);
  if (idx >= 0) { quotesFilters.estados.splice(idx, 1); chip.classList.remove('active'); }
  else { quotesFilters.estados.push(e); chip.classList.add('active'); }
  updateFilterBadge();
  renderQuotes();
});

// Grupos single-select (industria / tipo / seguimiento / orden)
function _bindQuoteChips(containerId, attr, key) {
  document.getElementById(containerId)?.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.sfchip');
    if (!chip) return;
    quotesFilters[key] = chip.dataset[attr];
    document.querySelectorAll('#' + containerId + ' .sfchip').forEach(c => c.classList.toggle('active', c === chip));
    updateFilterBadge();
    renderQuotes();
  });
}
_bindQuoteChips('qfIndustriaFilter', 'ind',  'industria');
_bindQuoteChips('qfTipoFilter',      'tipo', 'tipo');
_bindQuoteChips('qfSegFilter',       'seg',  'seg');
_bindQuoteChips('qfSortFilter',      'sort', 'sort');

document.getElementById('filterClearBtn')?.addEventListener('click', () => {
  quotesFilters = { estados: [], industria: 'all', tipo: 'all', seg: 'all', sort: 'fecha_desc' };
  document.querySelectorAll('#filterEstadoChips .sfchip').forEach(c => c.classList.remove('active'));
  const setActive = (id, attr, val) => document.querySelectorAll('#' + id + ' .sfchip').forEach(c => c.classList.toggle('active', c.dataset[attr] === val));
  setActive('qfTipoFilter', 'tipo', 'all');
  setActive('qfSegFilter', 'seg', 'all');
  setActive('qfSortFilter', 'sort', 'fecha_desc');
  renderQuoteIndustriaChips();
  updateFilterBadge();
  renderQuotes();
});

// ---------- Templates ----------
function openTemplatePicker(onSelect) {
  const listEl = document.getElementById('templateList');
  const sheet = document.getElementById('templateSheet');
  if (!listEl || !sheet) return;
  if (!templates.length) {
    listEl.innerHTML = '<div class="empty">Sin plantillas guardadas</div>';
  } else {
    listEl.innerHTML = templates.map(t => `
      <div class="card template-card" data-tpl-id="${escapeHtml(t.id)}">
        <div class="card-title">${escapeHtml(t.nombre)}</div>
        ${t.descripcion ? `<div class="card-sub">${escapeHtml(t.descripcion.slice(0,80))}</div>` : ''}
        ${t.valor ? `<div class="card-meta">${formatCLP(t.valor)}</div>` : ''}
      </div>
    `).join('');
    listEl.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        const tpl = templates.find(t => t.id === card.dataset.tplId);
        if (tpl) onSelect(tpl);
        sheet.classList.add('hidden');
      });
    });
  }
  sheet.classList.remove('hidden');
}

async function saveAsTemplate(q) {
  const nombre = prompt('Nombre de la plantilla:', q.descripcion?.slice(0,30) || q.numero || '');
  if (!nombre) return;
  const id = uid();
  await setDoc(doc(templatesCol(), id), {
    id, nombre: nombre.trim(),
    descripcion: q.descripcion || '',
    valor: q.valor ?? '',
    estado: 'Borrador',
    contactos: q.contactos || '',
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid,
  });
  showToast('Plantilla guardada');
}

document.getElementById('useTemplateBtn')?.addEventListener('click', () => {
  openTemplatePicker(tpl => {
    quoteForm.descripcion.value = tpl.descripcion || '';
    quoteForm.valor.value = tpl.valor || '';
    quoteForm.estado.value = tpl.estado || 'Borrador';
    quoteForm.contactos.value = tpl.contactos || '';
  });
});

document.getElementById('templateSheetClose')?.addEventListener('click', () => {
  document.getElementById('templateSheet').classList.add('hidden');
});

// ---------- Settings ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ quotes, clients }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sonqollay_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const headers = ['Empresa','N° Cotización','Fecha','Descripción','Valor','Contacto','Estado','Seguimiento','Notas'];
  const rows = quotes.map(q => [q.empresa, q.numero, q.fecha, q.descripcion, q.valor ?? '', q.contactos, q.estado, q.seguimiento ?? '', q.notas ?? '']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `cotizaciones_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
});
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.quotes) || !Array.isArray(data.clients)) {
      throw new Error('El archivo no tiene un formato de respaldo válido');
    }
    if (!confirm(`Importar ${data.quotes.length} cotizaciones y ${data.clients.length} contactos?\nSe agregarán a los existentes.`)) return;

    // Firestore max 500 ops/batch — split into chunks of 490
    const CHUNK = 490;
    const allOps = [
      ...data.quotes.map(q => ({ col: quotesCol, doc: q })),
      ...data.clients.map(c => ({ col: clientsCol, doc: c })),
    ];
    showToast('Importando…');
    for (let i = 0; i < allOps.length; i += CHUNK) {
      const batch = writeBatch(dbf);
      allOps.slice(i, i + CHUNK).forEach(({ col, doc: item }) => {
        const id = item.id || uid();
        batch.set(doc(col(), id), { ...item, id, importedAt: serverTimestamp() }, { merge: true });
      });
      await batch.commit();
    }
    showToast(`Importados: ${data.quotes.length} cotiz. y ${data.clients.length} contactos`);
  } catch (err) {
    showToast('Error: ' + err.message);
  }
  e.target.value = '';
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Esto BORRARÁ todas las cotizaciones y clientes de la empresa y volverá a los datos iniciales. ¿Continuar?')) return;
  try {
    const batch = writeBatch(dbf);
    const [qs, cs] = await Promise.all([getDocs(quotesCol()), getDocs(clientsCol())]);
    qs.forEach(d => batch.delete(d.ref));
    cs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await maybeSeed();
    showToast('Datos restablecidos');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
});

// ---------- Seguimiento Sheet ----------
let _segQuoteId = null;

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _syncSegChips(dateVal) {
  document.querySelectorAll('#segChips .seg-chip').forEach(chip => {
    if (chip.dataset.days === 'none') chip.classList.toggle('active', !dateVal);
    else chip.classList.toggle('active', addDays(parseInt(chip.dataset.days)) === dateVal);
  });
}

function openSeguimientoSheet(id) {
  const q = quotes.find(x => x.id === id);
  if (!q) return;
  _segQuoteId = id;

  document.getElementById('segSheetTitle').textContent = `Registrar contacto · ${q.numero} · ${q.empresa}`;

  const sm = getSeguimientoStatus(q);
  const currEl = document.getElementById('segSheetCurrent');
  currEl.innerHTML = sm
    ? `<div class="sm-row" style="margin:0">
         <span class="sm-dot ${sm.key}${sm.key === 'red' ? ' pulse' : ''}"></span>
         <span class="sm-label ${sm.key}">${sm.label}</span>
         <span class="sm-date">${formatDate(q.seguimiento)}</span>
       </div>`
    : '';

  const ESTADOS = ['Borrador','Enviada','En revisión','Adjudicada','Perdida'];
  const estadoEl = document.getElementById('segEstadoChips');
  estadoEl.innerHTML = ESTADOS.map(e =>
    `<button class="seg-estado-chip${q.estado === e ? ' active' : ''}" data-estado="${escapeHtml(e)}">${escapeHtml(e)}</button>`
  ).join('');
  estadoEl.querySelectorAll('.seg-estado-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      estadoEl.querySelectorAll('.seg-estado-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  const defaultDate = q.seguimiento || addDays(7);
  document.getElementById('segDateInput').value = defaultDate;
  document.getElementById('segNoteInput').value = '';
  _syncSegChips(defaultDate);
  document.getElementById('seguimientoSheet').classList.remove('hidden');
}

document.getElementById('segChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.seg-chip');
  if (!chip) return;
  if (chip.dataset.days === 'none') {
    document.getElementById('segDateInput').value = '';
    _syncSegChips('');
  } else {
    const newDate = addDays(parseInt(chip.dataset.days));
    document.getElementById('segDateInput').value = newDate;
    _syncSegChips(newDate);
  }
});

document.getElementById('segDateInput').addEventListener('input', (e) => {
  _syncSegChips(e.target.value);
});

document.getElementById('segCancelBtn').addEventListener('click', () => {
  document.getElementById('seguimientoSheet').classList.add('hidden');
});

document.getElementById('segSheetCalBtn')?.addEventListener('click', () => {
  const dateVal = document.getElementById('segDateInput').value;
  const q = quotes.find(x => x.id === _segQuoteId);
  if (!q || !dateVal) { showToast('Selecciona una fecha de seguimiento'); return; }
  downloadICS({ ...q, seguimiento: dateVal });
});

document.getElementById('segCatChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.seg-cat-chip');
  if (!chip) return;
  document.querySelectorAll('#segCatChips .seg-cat-chip').forEach(c => c.classList.toggle('active', c === chip));
});

document.getElementById('segSaveBtn').addEventListener('click', async () => {
  const note = document.getElementById('segNoteInput').value.trim();
  const newDate = document.getElementById('segDateInput').value;
  const newEstado = document.getElementById('segEstadoChips')?.querySelector('.seg-estado-chip.active')?.dataset.estado;
  const categoria = document.getElementById('segCatChips')?.querySelector('.seg-cat-chip.active')?.dataset.cat || 'Seguimiento';
  if (!_segQuoteId) return;
  const q = quotes.find(x => x.id === _segQuoteId);
  if (!q) return;

  const estadoCambio = newEstado && newEstado !== q.estado;
  if (!note && !newDate && !estadoCambio) { showToast('Sin cambios'); return; }

  const updates = { updatedAt: serverTimestamp(), updatedBy: currentUser.uid };
  if (newDate) updates.seguimiento = newDate;
  if (newDate === '') updates.seguimiento = '';
  if (estadoCambio) updates.estado = newEstado;
  if (note) {
    const existing = q.notas || '';
    const entry = `${noteStamp({ tag: categoria })} ${note}`;
    updates.notas = existing ? `${existing}\n${entry}` : entry;
  }
  // Historial inmutable (_log): registra la nota y los cambios de esta interacción
  const logs = [];
  if (note) logs.push(`📝 ${categoria}: ${note.slice(0, 80)}`);
  if (estadoCambio) logs.push(`Estado: ${q.estado || '—'} → ${newEstado}`);
  if (newDate) logs.push(`Seguimiento → ${formatDate(newDate)}`);
  else if (newDate === '' && q.seguimiento) logs.push('Seguimiento quitado');
  if (logs.length) updates._log = arrayUnion({ t: new Date().toISOString(), u: currentUserName(), d: logs.join(' · ') });
  try {
    await setDoc(doc(quotesCol(), _segQuoteId), updates, { merge: true });
    const actions = [note && `nota (${categoria})`, estadoCambio && `→ ${newEstado}`, newDate && `seg. ${formatDate(newDate)}`].filter(Boolean);
    logActivity('quote_contacto', `${q.numero}: ${actions.join(', ')}`).catch(() => {});
    document.getElementById('seguimientoSheet').classList.add('hidden');
    showToast('Guardado');
    if (detailQuoteId === _segQuoteId) openQuoteDetail(_segQuoteId);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
});

// ---------- Voice Dictation ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let _dictateLang = 'es-CL';

function _applyVoiceCmds(text) {
  return text
    .replace(/\bpunto\b/gi, '.').replace(/\bcoma\b/gi, ',')
    .replace(/\bnueva\s+l[ií]nea\b/gi, '\n').replace(/\bdos\s+puntos\b/gi, ':')
    .replace(/\bsigno\s+de\s+interrogaci[oó]n\b/gi, '?').replace(/\bsigno\s+de\s+exclamaci[oó]n\b/gi, '!')
    .replace(/\bperiod\b/gi, '.').replace(/\bcomma\b/gi, ',')
    .replace(/\bnew\s+line\b/gi, '\n').replace(/\bcolon\b/gi, ':')
    .replace(/\bquestion\s+mark\b/gi, '?').replace(/\bexclamation\s+mark\b/gi, '!');
}

function attachMicToTextarea(ta) {
  if (!SpeechRec) return;
  if (ta.parentNode.classList.contains('dictate-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'dictate-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  wrap.appendChild(ta);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dictate-btn'; btn.setAttribute('aria-label', 'Dictar');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>`;
  wrap.appendChild(btn);
  let rec = null, shouldRun = false, baseValue = '', sessionFinal = '';

  function startInline() {
    rec = new SpeechRec();
    rec.lang = _dictateLang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let final = '', interim = '';
      for (const r of e.results) {
        if (r.isFinal) final += _applyVoiceCmds(r[0].transcript) + ' ';
        else interim += r[0].transcript;
      }
      sessionFinal = final.trim();
      const sep = baseValue && sessionFinal ? '\n' : '';
      ta.value = baseValue + sep + sessionFinal + (sessionFinal && interim ? ' ' : '') + interim;
    };
    rec.onend = () => {
      if (shouldRun) { setTimeout(() => { if (shouldRun) startInline(); }, 200); return; }
      btn.classList.remove('listening');
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' && shouldRun) { setTimeout(() => { if (shouldRun) startInline(); }, 300); return; }
      shouldRun = false; btn.classList.remove('listening');
      if (ev.error !== 'aborted') showToast('Error de micrófono');
    };
    rec.start(); btn.classList.add('listening');
  }

  btn.addEventListener('click', () => {
    if (shouldRun) { shouldRun = false; if (rec) rec.stop(); return; }
    shouldRun = true; baseValue = ta.value; sessionFinal = ''; startInline();
  });
}

function initDictation() {
  document.querySelectorAll('textarea[data-dictate]').forEach(attachMicToTextarea);
}

// ---------- Dictation Sheet ----------
let _dictateTarget = null;
let _dictateRec = null;
let _dictateListening = false;
let _dictateAutoRestart = false;
let _dictateChunks = [];
let _dictateResultIdx = 0;
let _dictateAudioCtx = null;
let _dictateAnalyser = null;
let _dictateAnimFrame = null;
let _dictateMicStream = null;

async function _startVolumeMeter() {
  try {
    _dictateMicStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    _dictateAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _dictateAnalyser = _dictateAudioCtx.createAnalyser();
    _dictateAnalyser.fftSize = 64;
    _dictateAudioCtx.createMediaStreamSource(_dictateMicStream).connect(_dictateAnalyser);
    const canvas = document.getElementById('dictateVolCanvas');
    const ctx = canvas.getContext('2d');
    const bins = _dictateAnalyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    const BARS = 20, gap = 2, bw = (canvas.width - gap * (BARS - 1)) / BARS;
    (function draw() {
      _dictateAnimFrame = requestAnimationFrame(draw);
      _dictateAnalyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < BARS; i++) {
        const val = data[Math.floor(i * bins / BARS)] / 255;
        const h = Math.max(3, val * canvas.height);
        ctx.fillStyle = val > 0.5 ? '#38bdf8' : 'rgba(56,189,248,0.35)';
        ctx.fillRect(i * (bw + gap), (canvas.height - h) / 2, bw, h);
      }
    })();
  } catch {}
}

function _stopVolumeMeter() {
  if (_dictateAnimFrame) { cancelAnimationFrame(_dictateAnimFrame); _dictateAnimFrame = null; }
  if (_dictateMicStream) { _dictateMicStream.getTracks().forEach(t => t.stop()); _dictateMicStream = null; }
  if (_dictateAudioCtx) { _dictateAudioCtx.close().catch(() => {}); _dictateAudioCtx = null; }
  _dictateAnalyser = null;
  const canvas = document.getElementById('dictateVolCanvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function _rebuildDictatePreview() {
  const el = document.getElementById('dictatePreview');
  if (!el) return;
  if (!_dictateChunks.length) {
    el.innerHTML = '<span class="dictate-placeholder">Presiona el micrófono para comenzar…</span>';
  } else {
    el.innerHTML = _dictateChunks.map(c => c.html).join('');
  }
}

function openDictateSheet(title) {
  if (!SpeechRec) { showToast('Tu navegador no soporta dictado por voz'); return; }
  document.getElementById('dictateSheetTitle').textContent = title || 'Dictar avance';
  document.getElementById('dictateInterim').textContent = '';
  document.getElementById('dictateStatusText').textContent = 'Listo';
  document.getElementById('dictateSaveBtn').disabled = true;
  document.getElementById('dictateMicBtn').classList.remove('listening');
  _dictateChunks = []; _dictateResultIdx = 0; _dictateListening = false; _dictateAutoRestart = false;
  if (_dictateRec) { try { _dictateRec.abort(); } catch {} _dictateRec = null; }
  _rebuildDictatePreview();
  document.getElementById('dictateSheet').classList.remove('hidden');
}

function _startDictateRec() {
  _dictateResultIdx = 0;
  _dictateRec = new SpeechRec();
  _dictateRec.lang = _dictateLang; _dictateRec.continuous = true; _dictateRec.interimResults = true;

  _dictateRec.onresult = (e) => {
    for (let i = _dictateResultIdx; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) continue;
      _dictateResultIdx = i + 1;
      const raw = r[0].transcript.trim();
      const conf = r[0].confidence;
      if (/^(borrar|delete|erase)$/i.test(raw)) {
        _dictateChunks.pop(); _rebuildDictatePreview();
        document.getElementById('dictateSaveBtn').disabled = _dictateChunks.length === 0;
        continue;
      }
      if (/^(guardar|save)$/i.test(raw)) {
        _dictateAutoRestart = false; setTimeout(saveDictateNote, 80); return;
      }
      const processed = _applyVoiceCmds(raw) + ' ';
      const html = conf > 0 && conf < 0.7
        ? `<span class="dictate-lowconf" title="Confianza ${Math.round(conf * 100)}%">${escapeHtml(processed)}</span>`
        : escapeHtml(processed);
      _dictateChunks.push({ text: processed, html });
      _rebuildDictatePreview();
      document.getElementById('dictateSaveBtn').disabled = false;
    }
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      if (!e.results[i].isFinal) interim += e.results[i][0].transcript;
    }
    const interimEl = document.getElementById('dictateInterim');
    if (interimEl) interimEl.textContent = interim;
  };

  _dictateRec.onend = () => {
    if (_dictateAutoRestart) { setTimeout(() => { if (_dictateAutoRestart) _startDictateRec(); }, 150); return; }
    _dictateListening = false;
    document.getElementById('dictateMicBtn')?.classList.remove('listening');
    document.getElementById('dictateStatusText').textContent = _dictateChunks.length ? 'Listo — edita o guarda' : 'Listo';
    _stopVolumeMeter();
  };

  _dictateRec.onerror = (ev) => {
    if (ev.error === 'no-speech' && _dictateAutoRestart) { setTimeout(() => { if (_dictateAutoRestart) _startDictateRec(); }, 300); return; }
    _dictateAutoRestart = false; _dictateListening = false;
    document.getElementById('dictateMicBtn')?.classList.remove('listening');
    document.getElementById('dictateStatusText').textContent = 'Error';
    if (ev.error !== 'aborted') showToast('Error de micrófono');
    _stopVolumeMeter();
  };

  _dictateRec.start(); _dictateListening = true;
}

async function saveDictateNote() {
  const preview = document.getElementById('dictatePreview');
  const text = (preview
    ? preview.textContent.replace(/Presiona el micrófono para comenzar…/g, '')
    : _dictateChunks.map(c => c.text).join('')
  ).trim();
  if (!text || !_dictateTarget) return;
  const entry = `${noteStamp({ tag: '🎤 dictado' })} ${text}`;
  const { type, id } = _dictateTarget;
  try {
    const colRef = type === 'quote' ? quotesCol() : clientsCol();
    const ref = doc(colRef, id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data().notas || '') : '';
    const writeData = {
      notas: existing ? existing + '\n' + entry : entry,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
    };
    if (type === 'quote') {
      writeData._log = arrayUnion({ t: new Date().toISOString(), u: currentUserName(), d: `🎤 Nota: ${text.slice(0, 80)}` });
    }
    await setDoc(ref, writeData, { merge: true });
    logActivity(type === 'quote' ? 'quote_note' : 'client_note', `${id}: ${text.slice(0, 80)}`).catch(() => {});
    if (_dictateRec) { try { _dictateRec.abort(); } catch {} }
    _stopVolumeMeter();
    document.getElementById('dictateSheet').classList.add('hidden');
    showToast('Nota guardada');
    if (type === 'quote' && detailQuoteId === id) openQuoteDetail(id);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

document.getElementById('dictateMicBtn').addEventListener('click', () => {
  if (_dictateListening) {
    _dictateAutoRestart = false;
    if (_dictateRec) _dictateRec.stop();
    _dictateListening = false;
    document.getElementById('dictateMicBtn').classList.remove('listening');
    document.getElementById('dictateStatusText').textContent = 'Pausado';
    _stopVolumeMeter();
  } else {
    _dictateAutoRestart = true;
    _startDictateRec();
    _startVolumeMeter();
    document.getElementById('dictateMicBtn').classList.add('listening');
    document.getElementById('dictateStatusText').textContent = 'Escuchando…';
  }
});

document.getElementById('dictateCancelBtn').addEventListener('click', () => {
  _dictateAutoRestart = false;
  if (_dictateRec) { try { _dictateRec.abort(); } catch {} _dictateRec = null; }
  _dictateListening = false;
  _stopVolumeMeter();
  document.getElementById('dictateSheet').classList.add('hidden');
});

document.getElementById('dictateSaveBtn').addEventListener('click', saveDictateNote);

document.querySelectorAll('.dlang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _dictateLang = btn.dataset.lang;
    document.querySelectorAll('.dlang-btn').forEach(b => b.classList.toggle('active', b === btn));
    const hint = document.querySelector('.dictate-hint');
    if (hint) hint.textContent = _dictateLang === 'es-CL'
      ? 'Comandos: "punto" "coma" "nueva línea" "borrar" "guardar"'
      : 'Commands: "period" "comma" "new line" "delete" "save"';
  });
});

initDictation();

// ---------- Admin navigation ----------
document.getElementById('adminNavBtn')?.addEventListener('click', () => showView('admin'));
document.getElementById('adminBackBtn')?.addEventListener('click', () => showView('settings'));

// ---------- Screen time: pause/resume on visibility change ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _flushScreenTime();
    _writeSession().catch(() => {});
  } else {
    _viewStart = Date.now();
    _scheduleFlush();
  }
});

// ---------- Tipo de servicio chip helpers ----------
function updateTipoChips() {
  document.querySelectorAll('#tipoChips .tipo-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.tipo === _editingTipo);
  });
  const academiaFields = document.getElementById('academiaFields');
  if (academiaFields) academiaFields.classList.toggle('hidden', _editingTipo !== 'Academia');
}

document.getElementById('tipoChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.tipo-chip[data-tipo]');
  if (!chip) return;
  _editingTipo = _editingTipo === chip.dataset.tipo ? '' : chip.dataset.tipo;
  updateTipoChips();
});

// ---------- Industria chip helpers ----------
function updateIndustriaChips(which) {
  const val = which === 'quote' ? _editingIndustriaQuote : _editingIndustriaClient;
  const id = which === 'quote' ? 'industriaChipsQuote' : 'industriaChipsClient';
  document.querySelectorAll(`#${id} .tipo-chip`).forEach(chip => {
    chip.classList.toggle('active', chip.dataset.ind === val);
  });
}

document.getElementById('industriaChipsQuote')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.tipo-chip[data-ind]');
  if (!chip) return;
  _editingIndustriaQuote = _editingIndustriaQuote === chip.dataset.ind ? '' : chip.dataset.ind;
  updateIndustriaChips('quote');
});

document.getElementById('industriaChipsClient')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.tipo-chip[data-ind]');
  if (!chip) return;
  _editingIndustriaClient = _editingIndustriaClient === chip.dataset.ind ? '' : chip.dataset.ind;
  updateIndustriaChips('client');
});

// ---------- Quote Items ----------
function renderQuoteItems() {
  const el = document.getElementById('quoteItemsList');
  if (!el) return;
  if (!_quoteItems.length) { el.innerHTML = ''; updateItemsTotal(); return; }
  el.innerHTML = _quoteItems.map((item, i) => `
    <div class="quote-item-row">
      <input class="qi-input qi-desc" placeholder="Descripción del servicio" value="${escapeHtml(item.descripcion||'')}" data-qi="${i}" data-qif="descripcion">
      <div class="qi-nums">
        <input class="qi-input qi-cant" placeholder="Cant." type="number" min="1" value="${item.cantidad||1}" data-qi="${i}" data-qif="cantidad">
        <input class="qi-input qi-val" placeholder="Valor unit." type="text" inputmode="numeric" value="${item.valorUnit!=null&&item.valorUnit!==''?item.valorUnit:''}" data-qi="${i}" data-qif="valorUnit">
        <button type="button" class="icon-btn qi-del" data-qi="${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>`).join('');

  el.querySelectorAll('.qi-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.qi);
      const f = inp.dataset.qif;
      if (f === 'cantidad') _quoteItems[i].cantidad = parseInt(inp.value)||1;
      else if (f === 'valorUnit') _quoteItems[i].valorUnit = parseValor(inp.value);
      else _quoteItems[i][f] = inp.value;
      updateItemsTotal();
    });
  });
  el.querySelectorAll('.qi-del').forEach(btn => {
    btn.addEventListener('click', () => { _quoteItems.splice(parseInt(btn.dataset.qi), 1); renderQuoteItems(); });
  });
  updateItemsTotal();
}

function updateItemsTotal() {
  const total = _quoteItems.reduce((s, item) => s + ((Number(item.valorUnit)||0) * (Number(item.cantidad)||1)), 0);
  const totalEl = document.getElementById('itemsTotal');
  if (totalEl) totalEl.textContent = formatCLP(total);
  if (_quoteItems.length > 0) {
    quoteForm.valor.value = total > 0 ? total : '';
  }
}

document.getElementById('addItemBtn')?.addEventListener('click', () => {
  _quoteItems.push({ id: uid(), descripcion: '', cantidad: 1, valorUnit: '' });
  renderQuoteItems();
});

// ---------- Resultados de cliente ----------
function renderClientResultados() {
  const el = document.getElementById('clientResultadosList');
  if (!el) return;
  if (!clientResultadosArr.length) {
    el.innerHTML = '<div class="notes-empty">Sin resultados aún</div>';
    return;
  }
  const tsRe = /^(\[\d{2} \w+ \d{4} \d{2}:\d{2}\]) ([\s\S]+)$/;
  el.innerHTML = clientResultadosArr.map((note, i) => {
    const m = note.match(tsRe);
    const ts = m ? m[1] : '';
    const text = m ? m[2] : note;
    return `<div class="note-item">
      <div class="note-meta">
        <span class="note-ts">${escapeHtml(ts)}</span>
        <div class="note-actions">
          <button type="button" class="icon-btn note-edit-btn" data-idx="${i}" aria-label="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
          </button>
          <button type="button" class="icon-btn note-del-btn" data-idx="${i}" aria-label="Eliminar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.021-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
          </button>
        </div>
      </div>
      <div class="note-text" id="cr-text-${i}">${escapeHtml(text).replace(/\n/g,'<br>')}</div>
      <div class="note-edit-area hidden" id="cr-edit-${i}">
        <textarea rows="2">${escapeHtml(text)}</textarea>
        <div class="note-edit-btns">
          <button type="button" class="btn btn-sm btn-ghost note-cancel-btn" data-idx="${i}">Cancelar</button>
          <button type="button" class="btn btn-sm note-ok-btn" data-idx="${i}">Guardar</button>
        </div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.note-edit-btn').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.idx;
    document.getElementById(`cr-text-${i}`).classList.add('hidden');
    document.getElementById(`cr-edit-${i}`).classList.remove('hidden');
    document.querySelector(`#cr-edit-${i} textarea`).focus();
  }));
  el.querySelectorAll('.note-cancel-btn').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.idx;
    document.getElementById(`cr-text-${i}`).classList.remove('hidden');
    document.getElementById(`cr-edit-${i}`).classList.add('hidden');
  }));
  el.querySelectorAll('.note-ok-btn').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.idx);
    const newText = document.querySelector(`#cr-edit-${i} textarea`).value.trim();
    if (!newText) return;
    const m = clientResultadosArr[i].match(/^(\[\d{2} \w+ \d{4} \d{2}:\d{2}\]) /);
    clientResultadosArr[i] = m ? `${m[0]}${newText}` : newText;
    renderClientResultados();
  }));
  el.querySelectorAll('.note-del-btn').forEach(b => b.addEventListener('click', () => {
    clientResultadosArr.splice(parseInt(b.dataset.idx), 1);
    renderClientResultados();
  }));
}

document.getElementById('clientResultadoAdd')?.addEventListener('click', () => {
  const input = document.getElementById('clientResultadoInput');
  const text = input.value.trim();
  if (!text) return;
  const now = new Date();
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const pad = n => String(n).padStart(2, '0');
  const ts = `[${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}]`;
  clientResultadosArr.push(`${ts} ${text}`);
  input.value = '';
  renderClientResultados();
});

// ---------- Proyectos en ejecución ----------
function renderProyectos() {
  const el = document.getElementById('proyectos-view');
  if (!el) return;
  const proyectos = quotes.filter(q => (q.estado||'').toLowerCase() === 'adjudicada')
    .sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  if (!proyectos.length) {
    el.innerHTML = '<div class="empty">Sin proyectos en ejecución.<br>Los proyectos aparecen cuando una cotización pasa a "Adjudicada".</div>';
    return;
  }
  el.innerHTML = proyectos.map(q => {
    const avance = q.proyectoAvance || 0;
    const hitos = q.hitos || [];
    const hitosCompletos = hitos.filter(h => h.done).length;
    return `<div class="card proyecto-card" data-proyecto-id="${q.id}">
      <div class="card-row">
        <div class="card-title">${escapeHtml(q.numero)} · ${escapeHtml(q.empresa)}</div>
        ${q.tipoServicio ? `<span class="tag-tipo">${escapeHtml(q.tipoServicio)}</span>` : ''}
      </div>
      <div class="card-sub">${escapeHtml(q.descripcion||'—')}</div>
      <div class="proyecto-progress">
        <div class="proyecto-progress-bar" style="width:${avance}%"></div>
      </div>
      <div class="card-row" style="margin-top:4px">
        <span class="card-meta">${avance}% completado</span>
        ${hitos.length ? `<span class="card-meta">${hitosCompletos}/${hitos.length} hitos</span>` : ''}
        ${q.proyectoFin ? `<span class="card-meta">Cierre: ${formatDate(q.proyectoFin)}</span>` : ''}
      </div>
      ${hitos.length ? `<div class="hitos-list">${hitos.map(h => `
        <div class="hito-item${h.done ? ' done' : ''}">
          <span class="hito-dot"></span>
          <span class="hito-titulo">${escapeHtml(h.titulo)}</span>
          ${h.fecha ? `<span class="hito-fecha">${formatDate(h.fecha)}</span>` : ''}
        </div>`).join('')}</div>` : ''}
      <button class="btn btn-outline btn-sm" style="margin-top:8px" data-gestionar-id="${q.id}">Gestionar proyecto</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.proyecto-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-gestionar-id]')) return;
      openQuoteDetail(card.dataset.proyectoId);
    });
  });
  el.querySelectorAll('[data-gestionar-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProyectoSheet(btn.dataset.gestionarId);
    });
  });
}

function openProyectoSheet(id) {
  const q = quotes.find(x => x.id === id);
  if (!q) return;
  _proyectoSheetId = id;
  _hitosTemp = (q.hitos || []).map(h => ({...h}));
  document.getElementById('proyectoSheetTitle').textContent = `${q.numero} · ${q.empresa}`;
  document.getElementById('proyectoFin').value = q.proyectoFin || '';
  const avance = q.proyectoAvance || 0;
  document.getElementById('proyectoAvance').value = avance;
  document.getElementById('proyectoAvanceVal').textContent = avance + '%';
  document.getElementById('hitoInput').value = '';
  document.getElementById('hitoFecha').value = '';
  renderHitosList();
  document.getElementById('proyectoSheet').classList.remove('hidden');
}

function renderHitosList() {
  const el = document.getElementById('hitosList');
  if (!el) return;
  if (!_hitosTemp.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px 0">Sin hitos aún</div>'; return; }
  el.innerHTML = _hitosTemp.map((h, i) => `
    <div class="hito-edit-item">
      <button type="button" class="hito-check-btn${h.done ? ' done' : ''}" data-hi="${i}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${h.done ? '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>' : '<circle cx="12" cy="12" r="9"/>'}</svg>
      </button>
      <span class="hito-titulo${h.done ? ' done' : ''}">${escapeHtml(h.titulo)}</span>
      ${h.fecha ? `<span class="hito-fecha">${formatDate(h.fecha)}</span>` : ''}
      <button type="button" class="icon-btn hito-del-btn" data-hi="${i}" style="margin-left:auto">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>`).join('');

  el.querySelectorAll('.hito-check-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _hitosTemp[parseInt(btn.dataset.hi)].done = !_hitosTemp[parseInt(btn.dataset.hi)].done;
      renderHitosList();
    });
  });
  el.querySelectorAll('.hito-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _hitosTemp.splice(parseInt(btn.dataset.hi), 1);
      renderHitosList();
    });
  });
}

document.getElementById('proyectoAvance')?.addEventListener('input', e => {
  document.getElementById('proyectoAvanceVal').textContent = e.target.value + '%';
});
document.getElementById('hitoAddBtn')?.addEventListener('click', () => {
  const titulo = document.getElementById('hitoInput').value.trim();
  if (!titulo) return;
  _hitosTemp.push({ id: uid(), titulo, fecha: document.getElementById('hitoFecha').value || '', done: false });
  document.getElementById('hitoInput').value = '';
  document.getElementById('hitoFecha').value = '';
  renderHitosList();
});
document.getElementById('proyectoSheetCancel')?.addEventListener('click', () => {
  document.getElementById('proyectoSheet').classList.add('hidden');
});
document.getElementById('proyectoSheetSave')?.addEventListener('click', async () => {
  if (!_proyectoSheetId) return;
  const avance = parseInt(document.getElementById('proyectoAvance').value);
  const fin = document.getElementById('proyectoFin').value;
  await setDoc(doc(quotesCol(), _proyectoSheetId), {
    proyectoAvance: avance,
    proyectoFin: fin,
    hitos: _hitosTemp,
    updatedAt: serverTimestamp(), updatedBy: currentUser.uid
  }, { merge: true });
  document.getElementById('proyectoSheet').classList.add('hidden');
  showToast('Proyecto actualizado');
});

// ---------- Pipeline view ----------
// Probabilidad de cierre por estado (para el pronóstico ponderado)
const ESTADO_PROB = { 'Borrador': 0.10, 'Enviada': 0.40, 'En revisión': 0.60, 'Adjudicada': 1.0, 'Perdida': 0 };

function kanbanCardHtml(q) {
  const sm = getSeguimientoStatus(q);
  return `<div class="kanban-card" draggable="true" data-quote-id="${escapeHtml(q.id)}" data-estado="${escapeHtml(q.estado || 'Borrador')}">
    <div class="kc-title">${escapeHtml(q.numero || '—')}</div>
    <div class="kc-emp">${escapeHtml(q.empresa || '')}</div>
    ${q.valor != null && q.valor !== '' ? `<div class="kc-val">${formatCLP(q.valor)}</div>` : ''}
    ${sm ? `<div class="kc-seg ${sm.key}">${escapeHtml(sm.label)}</div>` : ''}
  </div>`;
}

async function moveQuoteEstado(id, newEstado) {
  const q = quotes.find(x => x.id === id);
  if (!q || (q.estado || 'Borrador') === newEstado) return;
  try {
    await setDoc(doc(quotesCol(), id), { estado: newEstado, updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
    logActivity('quote_estado', `${q.numero}: ${newEstado}`).catch(() => {});
    showToast(`${q.numero} → ${newEstado}`);
  } catch (e) { showToast('Error: ' + e.message); }
}

// Kanban arrastrable por estado + pronóstico ponderado.
function renderPipeline() {
  const el = document.getElementById('pipeline-view');
  if (!el) return;
  const COLS = [
    { estado: 'Borrador',    cls: 'muted'   },
    { estado: 'Enviada',     cls: 'accent'  },
    { estado: 'En revisión', cls: 'warn'    },
    { estado: 'Adjudicada',  cls: 'success' },
    { estado: 'Perdida',     cls: 'danger'  },
  ];
  const searchVal = (document.getElementById('search-quotes').value || '').toLowerCase().trim();
  let visible = quotes.slice();
  if (searchVal) visible = visible.filter(q =>
    (q.empresa||'').toLowerCase().includes(searchVal) ||
    (q.numero||'').toLowerCase().includes(searchVal) ||
    (q.descripcion||'').toLowerCase().includes(searchVal)
  );
  visible = applyQuotesFilters(visible);

  // Pronóstico: ponderado (deals abiertos), pipeline abierto y adjudicado
  let weighted = 0, openTotal = 0, won = 0;
  visible.forEach(q => {
    const v = Number(q.valor) || 0;
    const est = q.estado || 'Borrador';
    if (est === 'Adjudicada') { won += v; return; }
    if (est === 'Perdida') return;
    openTotal += v;
    weighted += v * (ESTADO_PROB[est] ?? 0);
  });

  const forecastHtml = `<div class="kanban-forecast">
    <div class="kf-item"><span class="kf-label">Pronóstico ponderado</span><span class="kf-val accent">${formatCLP(weighted)}</span></div>
    <div class="kf-item"><span class="kf-label">Pipeline abierto</span><span class="kf-val">${formatCLP(openTotal)}</span></div>
    <div class="kf-item"><span class="kf-label">Adjudicado</span><span class="kf-val success">${formatCLP(won)}</span></div>
  </div>
  <div class="kanban-hint">Arrastra las tarjetas entre columnas para cambiar el estado · ponderación: Borrador 10% · Enviada 40% · En revisión 60%.</div>`;

  const boardHtml = `<div class="kanban-board">${COLS.map(col => {
    const group = visible.filter(q => (q.estado || 'Borrador') === col.estado);
    const total = group.reduce((s, q) => s + (Number(q.valor) || 0), 0);
    return `<div class="kanban-col" data-drop-estado="${escapeHtml(col.estado)}">
      <div class="kanban-col-head ${col.cls}">
        <span class="kc-name">${escapeHtml(col.estado)}</span>
        <span class="kc-count">${group.length}</span>
        ${total ? `<span class="kc-total">${formatCLP(total)}</span>` : ''}
      </div>
      <div class="kanban-col-body">
        ${group.length ? group.map(kanbanCardHtml).join('') : '<div class="pg-empty">—</div>'}
      </div>
    </div>`;
  }).join('')}</div>`;

  el.innerHTML = forecastHtml + boardHtml;

  // Click → detalle
  el.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', () => openQuoteDetail(card.dataset.quoteId));
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.quoteId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  // Columnas = zonas de drop
  el.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) moveQuoteEstado(id, col.dataset.dropEstado);
    });
  });
}

document.getElementById('quotesViewToggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vtoggle]');
  if (!btn) return;
  _quotesView = btn.dataset.vtoggle;
  document.querySelectorAll('#quotesViewToggle [data-vtoggle]').forEach(b =>
    b.classList.toggle('active', b.dataset.vtoggle === _quotesView));
  document.getElementById('quotes-list').classList.toggle('hidden', _quotesView !== 'list');
  document.getElementById('pipeline-view').classList.toggle('hidden', _quotesView !== 'pipeline');
  document.getElementById('proyectos-view').classList.toggle('hidden', _quotesView !== 'proyectos');
  if (_quotesView === 'pipeline') renderPipeline();
  else if (_quotesView === 'proyectos') renderProyectos();
  else renderQuotes();
});

// ---------- Acordeones home ----------
(function initAccordions() {
  const ACCS = [
    { btn: 'acc-btn-sinresp',   body: 'acc-body-sinresp',   key: 'acc_sinresp',   def: false },
    { btn: 'acc-btn-followups', body: 'acc-body-followups', key: 'acc_followups', def: false },
    { btn: 'acc-btn-recent',    body: 'acc-body-recent',    key: 'acc_recent',    def: false },
  ];

  function setAcc(btn, body, open) {
    body.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  ACCS.forEach(({ btn: btnId, body: bodyId, key, def }) => {
    const btn  = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;

    const open = localStorage.getItem(key) !== null
      ? localStorage.getItem(key) === '1'
      : def;
    setAcc(btn, body, open);

    btn.addEventListener('click', () => {
      const next = !body.classList.contains('open');
      setAcc(btn, body, next);
      localStorage.setItem(key, next ? '1' : '0');
    });
  });
})();

// ---------- PWA service worker ----------
// ---------- Dictado IA — relleno automático de cotización ----------

async function parseDictacionConIA(transcript) {
  const fn = httpsCallable(fbFunctions, 'parseDictation');
  const today = new Date().toISOString().slice(0, 10);
  const res = await fn({ transcript, today });
  return res.data;
}

function fillQuoteFromDictation(data) {
  if (!data || typeof data !== 'object') return;
  if (data.empresa)         quoteForm.empresa.value      = data.empresa;
  if (data.numero)          quoteForm.numero.value        = data.numero;
  if (data.fecha)           quoteForm.fecha.value         = data.fecha;
  if (data.descripcion)     quoteForm.descripcion.value   = data.descripcion;
  if (data.valor != null)   quoteForm.valor.value         = data.valor;
  if (data.contactos)       quoteForm.contactos.value     = data.contactos;
  if (data.seguimiento)     quoteForm.seguimiento.value   = data.seguimiento;
  if (data.notas)           quoteForm.notas.value         = data.notas;
  if (data.estado)          quoteForm.estado.value        = data.estado;
  if (data.tipo) {
    _editingTipo = data.tipo;
    updateTipoChips();
  }
  if (data.industria) {
    _editingIndustriaQuote = data.industria;
    updateIndustriaChips('quote');
  }
  if (data.tipo === 'Academia') {
    if (data.cursoNombre    && quoteForm.cursoNombre)    quoteForm.cursoNombre.value    = data.cursoNombre;
    if (data.cursoFecha     && quoteForm.cursoFecha)     quoteForm.cursoFecha.value     = data.cursoFecha;
    if (data.cursoModalidad && quoteForm.cursoModalidad) quoteForm.cursoModalidad.value = data.cursoModalidad;
    if (data.cursoCupos    != null && quoteForm.cursoCupos)    quoteForm.cursoCupos.value    = data.cursoCupos;
    if (data.cursoInscritos != null && quoteForm.cursoInscritos) quoteForm.cursoInscritos.value = data.cursoInscritos;
  }
}

function _resetAIDictateBtn(btn) {
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg> Dictar requerimiento con IA`;
  btn.style.borderColor = '';
  btn.style.color = '';
}

function initAIDictado() {
  const btn          = document.getElementById('quoteAIDictateBtn');
  const statusEl     = document.getElementById('quoteAIDictateStatus');
  const transcriptEl = document.getElementById('quoteAIDictateTranscript');
  if (!btn) return;

  if (!SpeechRec) {
    btn.disabled = true;
    btn.textContent = 'Dictado no disponible en este navegador';
    return;
  }

  let recognition = null;
  let isListening = false;
  let finalText   = '';

  btn.addEventListener('click', () => {
    if (isListening) { recognition?.stop(); return; }

    finalText = '';
    transcriptEl.textContent = '';
    transcriptEl.style.display = 'none';

    recognition = new SpeechRec();
    recognition.lang = 'es-CL';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isListening = true;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener`;
      btn.style.borderColor = 'var(--danger,#e53e3e)';
      btn.style.color       = 'var(--danger,#e53e3e)';
      statusEl.textContent  = '🎙 Escuchando… habla ahora';
    };

    recognition.onresult = (e) => {
      let interim = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      transcriptEl.textContent = finalText + interim;
      if (transcriptEl.textContent) transcriptEl.style.display = 'block';
    };

    recognition.onerror = (ev) => {
      if (ev.error === 'no-speech') return;
      isListening = false;
      _resetAIDictateBtn(btn);
      statusEl.textContent = 'Error de micrófono: ' + ev.error;
    };

    recognition.onend = async () => {
      isListening = false;
      _resetAIDictateBtn(btn);
      const text = finalText.trim();
      if (!text) { statusEl.textContent = 'No se detectó voz. Intenta de nuevo.'; return; }
      statusEl.textContent = '⏳ Procesando con IA…';
      btn.disabled = true;
      try {
        const data = await parseDictacionConIA(text);
        fillQuoteFromDictation(data);
        statusEl.textContent = '✓ Formulario completado · revisa y guarda';
      } catch (err) {
        console.error('parseDictacion error', err);
        statusEl.textContent = 'Error al procesar con IA. Intenta de nuevo.';
        showToast('Error al procesar dictado con IA');
      } finally {
        btn.disabled = false;
      }
    };

    recognition.start();
  });
}

initAIDictado();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Detectar nueva versión instalándose
      const hadController = !!navigator.serviceWorker.controller;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && hadController) {
            document.getElementById('updateBanner')?.classList.remove('hidden');
          }
        });
      });
    }).catch(() => {});

    // El SW también avisa vía postMessage al activarse
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'SW_UPDATED') {
        document.getElementById('updateBanner')?.classList.remove('hidden');
      }
    });
  });
}

document.getElementById('updateReload')?.addEventListener('click', () => window.location.reload());
