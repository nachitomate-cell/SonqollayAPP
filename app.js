// SonqollayAPP - Firestore + FCM + Google Auth
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, onSnapshot, setDoc, deleteDoc,
  serverTimestamp, query, orderBy, limit, writeBatch, getDocs,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  getMessaging, getToken, onMessage, isSupported
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js';
import {
  getAnalytics, isSupported as analyticsSupported
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';
import { firebaseConfig, VAPID_KEY } from './firebase-config.js';

// ---------- Init Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const dbf = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

enableIndexedDbPersistence(dbf).catch(err => {
  if (err.code === 'failed-precondition' || err.code === 'unimplemented') {
    console.warn('Persistencia offline no disponible:', err.code);
  }
});

analyticsSupported().then(ok => { if (ok) getAnalytics(app); }).catch(() => {});

// ---------- Datos iniciales (sembrado global en primera conexión) ----------
const seedQuotes = [
  { empresa: 'Arcadis', numero: 'P014_v01', fecha: '2026-03-16', descripcion: 'Celdas flotación División Andina - Codelco', valor: 93230280, contactos: 'juan.sarquis@arcadis.com; ricardo.bravo@arcadis.com', estado: 'Enviada' },
  { empresa: 'Arcadis', numero: 'P015_v01', fecha: '2026-04-10', descripcion: 'Tranque Ovejería Etapa V (Codelco VP)', valor: 461530100, contactos: 'carolina.cofre@arcadis.com', estado: 'Enviada' },
  { empresa: 'Arcadis', numero: 'P016_v01', fecha: '2026-05-08', descripcion: 'Capacitación', valor: 8200000, contactos: '', estado: 'Enviada' },
  { empresa: 'Keypro', numero: 'P002', fecha: '2026-05-05', descripcion: 'Consultoría', valor: null, contactos: '', estado: 'Borrador' },
  { empresa: 'Keypro', numero: 'P003', fecha: '2026-04-06', descripcion: 'Capacitación', valor: null, contactos: '', estado: 'Borrador' },
  { empresa: 'Keypro', numero: 'P004_v02', fecha: '2026-05-19', descripcion: 'Tranque Ovejería Etapa V (Codelco VP)', valor: 444453283, contactos: 'marien.teran@keyproingenieria.com', estado: 'Enviada' },
  { empresa: 'Worley', numero: 'P002_01', fecha: '2026-03-20', descripcion: 'Capacitación', valor: 14000000, contactos: '', estado: 'Enviada' },
  { empresa: 'JRI', numero: 'P005_v02', fecha: '2026-04-10', descripcion: 'PMChS Obras de Acceso Nivel 2', valor: 8800000, contactos: 'dmellado@jri.cl', estado: 'Enviada' },
  { empresa: 'WSP', numero: 'P001_v01', fecha: '2026-05-11', descripcion: 'Ing. Detalle y Terreno TOVE 5', valor: null, contactos: '', estado: 'Borrador' },
  { empresa: 'Salfa', numero: 'P001_v01', fecha: '2026-05-11', descripcion: 'Mina Chuquicamata Subterránea PMCHS', valor: 99000000, contactos: 'mcabezasg@salfamontajes.com; gacastroy@salfamontajes.com', estado: 'Enviada' },
  { empresa: 'Techint', numero: 'P001_v01', fecha: '2026-05-21', descripcion: 'Apoyo propuestas BHP', valor: 8000000, contactos: 'teapju@techint.com; juanlovrics@techint.com', estado: 'Enviada' },
  { empresa: 'R&Q', numero: 'P003_v01', fecha: '2026-05-20', descripcion: 'APOYO PROCESO IMPLEMENTACIÓN NORMA ISO 19650', valor: 19680000, contactos: '', estado: 'Enviada' },
];

// ---------- Helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const formatCLP = (v) => (v == null || v === '' || isNaN(v)) ? '—' : '$ ' + Number(v).toLocaleString('es-CL');
const parseValor = (s) => {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
};
const formatDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y ? `${d}-${m}-${y}` : iso;
};
const daysUntil = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(); t.setHours(0,0,0,0);
  const x = new Date(iso); x.setHours(0,0,0,0);
  return Math.round((x - t) / 86400000);
};
function daysSinceUpdated(q) {
  if (q.updatedAt?.toDate) return Math.round((Date.now() - q.updatedAt.toDate().getTime()) / 86400000);
  if (q.fecha) return Math.round((Date.now() - new Date(q.fecha).getTime()) / 86400000);
  return 0;
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function getSeguimientoStatus(q) {
  if (!q.seguimiento) return null;
  const estado = (q.estado || '').toLowerCase();
  if (estado === 'adjudicada' || estado === 'perdida') return null;
  const d = daysUntil(q.seguimiento);
  if (d === 0)  return { key: 'red',    label: 'Vence hoy' };
  if (d < 0)    return { key: 'red',    label: d === -1 ? 'Venció ayer' : `Venció hace ${-d}d` };
  if (d <= 3)   return { key: 'yellow', label: `Vence en ${d}d` };
  if (d <= 30)  return { key: 'green',  label: `En ${d}d` };
  return               { key: 'muted',  label: formatDate(q.seguimiento) };
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}

function hideSplash() {
  const el = document.getElementById('splashScreen');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hiding');
  setTimeout(() => el.classList.add('hidden'), 350);
}

function skeletonCards(n = 3) {
  const widths = [[68, 52, 38], [62, 59, 38], [74, 45, 38], [56, 66, 38], [70, 50, 38]];
  return Array.from({ length: n }, (_, i) => {
    const [w1, w2] = widths[i % widths.length];
    return `<div class="skeleton-card">
      <div class="skeleton-line" style="width:${w1}%"></div>
      <div class="skeleton-line" style="width:${w2}%;animation-delay:.15s"></div>
      <div class="skeleton-line" style="width:38%;animation-delay:.3s"></div>
    </div>`;
  }).join('');
}

// ─── Time helpers ───
function fmtDuration(sec) {
  if (!sec || sec < 60) return '< 1m';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function timeAgo(date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60)  return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60)  return `hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `hace ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30)  return `hace ${d}d`;
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

// ─── Activity logger ───
async function logActivity(action, detail) {
  if (!currentUser) return;
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
    isAdmin = snap.exists() && snap.data().isAdmin === true;
  } catch (_) { isAdmin = false; }
  document.getElementById('adminNavSection')?.classList.toggle('hidden', !isAdmin);
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
  }, () => {});
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

  const users = Object.values(map).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
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
    const actionCount = _adminActivity.filter(a => a.uid === u.uid && !['login','logout'].includes(a.action)).length;
    const init = (u.displayName || u.email || '?').trim()[0].toUpperCase();
    return `<div class="admin-user-card">
      <div class="auc-header">
        ${u.photoURL ? `<img class="auc-avatar" src="${escapeHtml(u.photoURL)}" alt="" />`
                     : `<div class="auc-avatar auc-avatar-init">${escapeHtml(init)}</div>`}
        <div class="auc-info">
          <span class="auc-name">${escapeHtml(u.displayName || u.email)}</span>
          <span class="auc-email">${escapeHtml(u.email)}</span>
        </div>
        <div class="auc-stats">
          <span class="auc-stat-big">${fmtDuration(u.totalTime)}</span>
          <span class="auc-stat-sm">${u.sessions} sesión${u.sessions !== 1 ? 'es' : ''}</span>
          ${u.lastSeen ? `<span class="auc-stat-sm muted">${timeAgo(u.lastSeen)}</span>` : ''}
        </div>
      </div>
      <div class="auc-st">${bars}</div>
      ${actionCount ? `<div class="auc-foot">${actionCount} acciones registradas</div>` : ''}
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
  const items = _adminActivity.slice(0, 80);
  if (!items.length) { el.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:13px">Sin actividad registrada aún</div>'; return; }
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

// ---------- Estado en memoria ----------
let currentUser = null;
let quotes = [];
let clients = [];
let unsubQuotes = null;
let unsubClients = null;
let quotesLoaded = false;
let clientsLoaded = false;
let _quotesView = 'list';

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
let _adminSessions = [];
let _adminActivity = [];

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

// ---------- Auth ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await endActivitySession();
    unsubscribeAdmin();
    if (unsubQuotes) { unsubQuotes(); unsubQuotes = null; }
    if (unsubClients) { unsubClients(); unsubClients = null; }
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
  await saveUserProfile(user);
  renderUserInfo(user);
  await checkAdminStatus();
  await maybeSeed();
  renderAll();
  subscribe();
  startActivitySession().catch(() => {});
  setupFcm().catch(e => console.warn('FCM setup', e));
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
  const snap = await getDocs(quotesCol());
  if (!snap.empty) return;
  const batch = writeBatch(dbf);
  for (const q of seedQuotes) {
    const id = uid();
    batch.set(doc(quotesCol(), id), {
      id, seguimiento: '', notas: '', createdAt: serverTimestamp(),
      createdBy: currentUser.uid, ...q
    });
  }
  const empresas = [...new Set(seedQuotes.map(q => q.empresa))];
  for (const empresa of empresas) {
    const id = uid();
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
}

function subscribe() {
  if (unsubQuotes) unsubQuotes();
  if (unsubClients) unsubClients();
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
}

// ---------- FCM ----------
async function setupFcm() {
  if (!(await isSupported())) return;
  if (!('Notification' in window)) return;
  const messaging = getMessaging(app);

  onMessage(messaging, (payload) => {
    const title = payload?.notification?.title || 'SonqollayAPP';
    const body = payload?.notification?.body || '';
    showToast(`${title}${body ? ' · ' + body : ''}`);
  });

  const btn = document.getElementById('enablePushBtn');
  if (!btn) return;
  const pushLabel = document.getElementById('pushBtnLabel');
  if (Notification.permission === 'granted' && pushLabel) pushLabel.textContent = 'Notificaciones activadas';

  btn.addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { type: 'module' });
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { showToast('Permiso denegado'); return; }
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (!token) { showToast('No se obtuvo token FCM'); return; }
      await setDoc(doc(tokensCol(), token), {
        token, ua: navigator.userAgent, createdAt: serverTimestamp(),
      });
      if (pushLabel) pushLabel.textContent = 'Notificaciones activadas';
      showToast('Notificaciones activadas');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message);
    }
  });
}

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
  const el = document.getElementById('hoy-urgente-section');
  if (!el || !quotesLoaded) return;

  const overdue = quotes.filter(q => {
    if (!q.seguimiento) return false;
    const e = (q.estado || '').toLowerCase();
    if (e === 'adjudicada' || e === 'perdida') return false;
    return daysUntil(q.seguimiento) <= 0;
  }).sort((a, b) => a.seguimiento.localeCompare(b.seguimiento));

  const sinRespuesta = quotes.filter(q => {
    const e = (q.estado || '').toLowerCase();
    if (e !== 'enviada' && e !== 'en revisión') return false;
    return daysSinceUpdated(q) >= 14;
  }).sort((a, b) => daysSinceUpdated(b) - daysSinceUpdated(a));

  let html = '';
  if (overdue.length) {
    html += `<div class="hoy-section-header urgent">
      <span class="hoy-dot urgent"></span>Requieren seguimiento
    </div>
    <div class="list">${overdue.map(q => cardQuoteHtml(q, { registrar: true })).join('')}</div>`;
  }
  if (sinRespuesta.length) {
    html += `<div class="hoy-section-header warn" style="margin-top:${overdue.length?16:0}px">
      <span class="hoy-dot warn"></span>Sin respuesta +14 días
    </div>
    <div class="list">${sinRespuesta.map(q => cardQuoteHtml(q, { registrar: true })).join('')}</div>`;
  }
  el.innerHTML = html;
  if (html) bindQuoteCards(el);
}

// ---------- Render ----------
function renderAll() {
  renderDashboard();
  renderQuotes();
  renderClients();
  renderCompaniesDatalist();
}

function renderDashboard() {
  renderGreeting();
  renderHoyUrgente();
  document.getElementById('kpi-quotes').textContent = quotes.length;
  document.getElementById('kpi-clients').textContent = clients.length;
  const total = quotes.reduce((s, q) => s + (Number(q.valor) || 0), 0);
  document.getElementById('kpi-total').textContent = formatCLP(total);

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
  if (!quotesLoaded) {
    fuEl.innerHTML = skeletonCards(2);
  } else if (!followUps.length) {
    fuEl.innerHTML = '<div class="empty">Sin seguimientos programados</div>';
  } else {
    fuEl.innerHTML = followUps.map(q => cardQuoteHtml(q)).join('');
    bindQuoteCards(fuEl);
  }

  const recEl = document.getElementById('recent-quotes');
  if (!quotesLoaded) {
    recEl.innerHTML = skeletonCards(3);
  } else {
    const recent = [...quotes]
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      .slice(0, 5);
    recEl.innerHTML = recent.length
      ? recent.map(q => cardQuoteHtml(q)).join('')
      : '<div class="empty">Aún no hay cotizaciones</div>';
    bindQuoteCards(recEl);
  }
}

function cardQuoteHtml(q, opts = {}) {
  const estadoClass = (q.estado || 'Borrador').split(' ')[0];
  const sm = getSeguimientoStatus(q);
  return `
    <div class="card" data-quote-id="${q.id}" data-estado="${escapeHtml(q.estado || 'Borrador')}">
      <div class="card-row">
        <div class="card-title">${escapeHtml(q.numero)} · ${escapeHtml(q.empresa)}</div>
        <span class="tag estado-${escapeHtml(estadoClass)}">${escapeHtml(q.estado || 'Borrador')}</span>
      </div>
      <div class="card-sub">${escapeHtml(q.descripcion || '—')}</div>
      <div class="card-row">
        <span class="card-meta">${formatDate(q.fecha)}</span>
        <span class="card-meta"><strong style="color:var(--text)">${formatCLP(q.valor)}</strong></span>
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

function renderQuotes() {
  if (_quotesView === 'pipeline') { renderPipeline(); return; }
  if (!quotesLoaded) { document.getElementById('quotes-list').innerHTML = skeletonCards(5); return; }
  const q = (document.getElementById('search-quotes').value || '').toLowerCase().trim();
  let list = [...quotes].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  if (q) {
    list = list.filter(x =>
      (x.empresa||'').toLowerCase().includes(q) ||
      (x.numero||'').toLowerCase().includes(q) ||
      (x.descripcion||'').toLowerCase().includes(q) ||
      (x.contactos||'').toLowerCase().includes(q)
    );
  }
  const el = document.getElementById('quotes-list');
  el.innerHTML = list.length
    ? list.map(x => cardQuoteHtml(x)).join('')
    : '<div class="empty">Sin resultados</div>';
  bindQuoteCards(el);
}

function renderClients() {
  if (!clientsLoaded) { document.getElementById('clients-list').innerHTML = skeletonCards(4); return; }
  const q = (document.getElementById('search-clients').value || '').toLowerCase().trim();
  let list = [...clients].sort((a, b) => a.empresa.localeCompare(b.empresa));
  if (q) {
    list = list.filter(x =>
      (x.empresa||'').toLowerCase().includes(q) ||
      (x.nombre||'').toLowerCase().includes(q) ||
      (x.email||'').toLowerCase().includes(q)
    );
  }
  const el = document.getElementById('clients-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin clientes</div>'; return; }
  el.innerHTML = list.map(c => {
    const count = quotes.filter(qq => qq.empresa === c.empresa).length;
    return `
      <div class="card" data-client-id="${c.id}">
        <div class="card-row">
          <div class="card-title">${escapeHtml(c.empresa)}</div>
          <span class="tag">${count} cot.</span>
        </div>
        <div class="card-sub">${escapeHtml(c.nombre || c.email || '—')}</div>
        ${c.email ? `<div class="card-meta">${escapeHtml(c.email)}</div>` : ''}
      </div>`;
  }).join('');
  el.querySelectorAll('[data-client-id]').forEach(node => {
    node.addEventListener('click', () => openClientForm(node.dataset.clientId));
  });
}

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
}
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

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

function openQuoteForm(id) {
  editingQuoteId = id || null;
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
      quoteForm.contactos.value = q.contactos || '';
      quoteForm.estado.value = q.estado || 'Borrador';
      quoteForm.seguimiento.value = q.seguimiento || '';
      quoteForm.notas.value = q.notas || '';
    }
  } else {
    quoteForm.fecha.value = new Date().toISOString().slice(0,10);
    quoteForm.estado.value = 'Borrador';
  }
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
    contactos: quoteForm.contactos.value.trim(),
    estado: quoteForm.estado.value,
    seguimiento: quoteForm.seguimiento.value || '',
    notas: quoteForm.notas.value.trim(),
  };
  if (!data.empresa || !data.numero || !data.fecha) {
    showToast('Empresa, N° y fecha son obligatorios');
    return;
  }
  try {
    const id = editingQuoteId || uid();
    await setDoc(doc(quotesCol(), id), {
      id, ...data,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      ...(editingQuoteId ? {} : { createdAt: serverTimestamp(), createdBy: currentUser.uid })
    }, { merge: true });
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
  const emails = (q.contactos || '').split(';').map(s => s.trim()).filter(Boolean);
  const estadoClass = (q.estado || 'Borrador').split(' ')[0];
  const sm = getSeguimientoStatus(q);

  const ESTADOS = ['Borrador','Enviada','En revisión','Adjudicada','Perdida'];
  document.getElementById('detailBody').innerHTML = `
    <h3>${escapeHtml(q.numero)}</h3>
    <div class="det-company">${escapeHtml(q.empresa)}</div>

    <div class="estado-chips" id="estadoChips">
      ${ESTADOS.map(e => `<button class="estado-chip${q.estado === e ? ' active' : ''}" data-estado="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}
    </div>

    <div class="detail-row"><span class="lbl">Fecha</span><span class="val">${formatDate(q.fecha)}</span></div>
    <div class="detail-row"><span class="lbl">Valor</span><span class="val"><strong>${formatCLP(q.valor)}</strong></span></div>
    <div class="detail-row"><span class="lbl">Descripción</span><span class="val">${escapeHtml(q.descripcion || '—')}</span></div>

    <div class="seg-detail-box">
      <div class="seg-detail-header">
        <span class="lbl">Seguimiento</span>
        <button class="btn-seg-link" id="segUpdateBtn">${sm ? '↻ Actualizar' : '＋ Programar'}</button>
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
    ${q.notas ? `<div class="detail-row"><span class="lbl">Notas</span><span class="val">${escapeHtml(q.notas).replace(/\n/g,'<br>')}</span></div>` : ''}

    <div class="detail-actions">
      ${emails.length ? `<a class="btn" href="mailto:${escapeHtml(emails.join(','))}?subject=${encodeURIComponent('Cotización ' + q.numero + ' - ' + q.empresa)}">✉ Enviar correo</a>` : ''}
      <button class="btn btn-outline" id="detailShare">Compartir</button>
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

  const shareBtn = document.getElementById('detailShare');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const text = `${q.numero} · ${q.empresa}\n${q.descripcion || ''}\nFecha: ${formatDate(q.fecha)}\nValor: ${formatCLP(q.valor)}\nEstado: ${q.estado || ''}`;
    if (navigator.share) { try { await navigator.share({ title: q.numero, text }); } catch {} }
    else { try { await navigator.clipboard.writeText(text); showToast('Copiado'); } catch { showToast('No se pudo compartir'); } }
  });

  document.getElementById('detailDictate')?.addEventListener('click', () => {
    _dictateTarget = { type: 'quote', id };
    openDictateSheet('Dictar avance · ' + q.numero);
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

function openClientForm(id) {
  editingClientId = id || null;
  clientForm.reset();
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
      clientForm.notas.value = c.notas || '';
    }
  }
  clientModal.classList.remove('hidden');
}

document.getElementById('clientClose').addEventListener('click', () => clientModal.classList.add('hidden'));

document.getElementById('clientSave').addEventListener('click', async () => {
  const data = {
    empresa: clientForm.empresa.value.trim(),
    nombre: clientForm.nombre.value.trim(),
    email: clientForm.email.value.trim(),
    telefono: clientForm.telefono.value.trim(),
    cargo: clientForm.cargo.value.trim(),
    notas: clientForm.notas.value.trim(),
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
  renderQuotes();
});
document.getElementById('search-clients').addEventListener('input', renderClients);

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

document.getElementById('segSaveBtn').addEventListener('click', async () => {
  const note = document.getElementById('segNoteInput').value.trim();
  const newDate = document.getElementById('segDateInput').value;
  const newEstado = document.getElementById('segEstadoChips')?.querySelector('.seg-estado-chip.active')?.dataset.estado;
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
    const now = new Date();
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const pad = n => String(n).padStart(2, '0');
    const stamp = `[${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}]`;
    const existing = q.notas || '';
    updates.notas = existing ? `${existing}\n${stamp} ${note}` : `${stamp} ${note}`;
  }
  try {
    await setDoc(doc(quotesCol(), _segQuoteId), updates, { merge: true });
    const actions = [note && 'nota', estadoCambio && `→ ${newEstado}`, newDate && `seg. ${formatDate(newDate)}`].filter(Boolean);
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

function attachMicToTextarea(ta) {
  if (!SpeechRec) return;
  if (ta.parentNode.classList.contains('dictate-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'dictate-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  wrap.appendChild(ta);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dictate-btn';
  btn.setAttribute('aria-label', 'Dictar');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>`;
  wrap.appendChild(btn);

  let rec = null;
  let listening = false;
  let baseValue = '';

  btn.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    rec = new SpeechRec();
    rec.lang = 'es-CL';
    rec.continuous = true;
    rec.interimResults = true;
    baseValue = ta.value;

    rec.onresult = (e) => {
      let final = '', interim = '';
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      final = final.trim();
      const sep = baseValue && final ? '\n' : '';
      ta.value = baseValue + sep + final + (final && interim ? ' ' : '') + interim;
    };

    rec.onend = () => {
      listening = false;
      btn.classList.remove('listening');
    };

    rec.onerror = () => {
      listening = false;
      btn.classList.remove('listening');
      showToast('Error de micrófono');
    };

    rec.start();
    listening = true;
    btn.classList.add('listening');
  });
}

function initDictation() {
  document.querySelectorAll('textarea[data-dictate]').forEach(attachMicToTextarea);
}

let _dictateTarget = null;
let _dictateRec = null;
let _dictateListening = false;
let _dictateTranscript = '';
let _dictateInterim = '';

function openDictateSheet(title) {
  if (!SpeechRec) { showToast('Tu navegador no soporta dictado por voz'); return; }
  document.getElementById('dictateSheetTitle').textContent = title || 'Dictar avance';
  document.getElementById('dictatePreview').innerHTML = 'Presiona el micrófono para comenzar…';
  document.getElementById('dictateStatusText').textContent = 'Listo';
  document.getElementById('dictateSaveBtn').disabled = true;
  document.getElementById('dictateMicBtn').classList.remove('listening');
  _dictateTranscript = '';
  _dictateInterim = '';
  _dictateListening = false;
  if (_dictateRec) { try { _dictateRec.abort(); } catch {} _dictateRec = null; }
  document.getElementById('dictateSheet').classList.remove('hidden');
}

function _startDictateRec() {
  _dictateRec = new SpeechRec();
  _dictateRec.lang = 'es-CL';
  _dictateRec.continuous = true;
  _dictateRec.interimResults = true;

  _dictateRec.onresult = (e) => {
    let final = '', interim = '';
    for (const r of e.results) {
      if (r.isFinal) final += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    _dictateTranscript = final.trim();
    _dictateInterim = interim.trim();
    const preview = document.getElementById('dictatePreview');
    if (preview) {
      preview.innerHTML = `<span>${escapeHtml(_dictateTranscript)}</span>${_dictateInterim ? ` <span class="dictate-interim">${escapeHtml(_dictateInterim)}</span>` : ''}`;
    }
    const saveBtn = document.getElementById('dictateSaveBtn');
    if (saveBtn) saveBtn.disabled = !_dictateTranscript && !_dictateInterim;
  };

  _dictateRec.onend = () => {
    _dictateListening = false;
    document.getElementById('dictateMicBtn')?.classList.remove('listening');
    document.getElementById('dictateStatusText').textContent = _dictateTranscript ? 'Dictado listo — guarda o continúa' : 'Listo';
  };

  _dictateRec.onerror = () => {
    _dictateListening = false;
    document.getElementById('dictateMicBtn')?.classList.remove('listening');
    showToast('Error de micrófono');
  };

  _dictateRec.start();
  _dictateListening = true;
}

async function saveDictateNote() {
  const text = (_dictateTranscript + (_dictateInterim ? ' ' + _dictateInterim : '')).trim();
  if (!text || !_dictateTarget) return;
  const now = new Date();
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const pad = n => String(n).padStart(2, '0');
  const stamp = `[${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}]`;
  const entry = `${stamp} ${text}`;
  const { type, id } = _dictateTarget;
  try {
    const colRef = type === 'quote' ? quotesCol() : clientsCol();
    const ref = doc(colRef, id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data().notas || '') : '';
    await setDoc(ref, {
      notas: existing ? existing + '\n' + entry : entry,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
    }, { merge: true });
    logActivity(type === 'quote' ? 'quote_note' : 'client_note', `${id}: ${text.slice(0, 80)}`).catch(() => {});
    document.getElementById('dictateSheet').classList.add('hidden');
    showToast('Nota guardada');
    if (type === 'quote' && detailQuoteId === id) openQuoteDetail(id);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

document.getElementById('dictateMicBtn').addEventListener('click', () => {
  if (_dictateListening) {
    if (_dictateRec) _dictateRec.stop();
    _dictateListening = false;
    document.getElementById('dictateMicBtn').classList.remove('listening');
    document.getElementById('dictateStatusText').textContent = 'Pausado';
  } else {
    _startDictateRec();
    document.getElementById('dictateMicBtn').classList.add('listening');
    document.getElementById('dictateStatusText').textContent = 'Escuchando…';
  }
});

document.getElementById('dictateCancelBtn').addEventListener('click', () => {
  if (_dictateRec) { try { _dictateRec.abort(); } catch {} _dictateRec = null; }
  _dictateListening = false;
  document.getElementById('dictateSheet').classList.add('hidden');
});

document.getElementById('dictateSaveBtn').addEventListener('click', saveDictateNote);

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

// ---------- Pipeline view ----------
function renderPipeline() {
  const el = document.getElementById('pipeline-view');
  if (!el) return;
  const PIPELINE = [
    { estado: 'En revisión', dot: 'warn',    open: true  },
    { estado: 'Enviada',     dot: 'accent',   open: true  },
    { estado: 'Borrador',    dot: 'muted',    open: false },
    { estado: 'Adjudicada',  dot: 'success',  open: false },
    { estado: 'Perdida',     dot: 'danger',   open: false },
  ];
  const searchVal = (document.getElementById('search-quotes').value || '').toLowerCase().trim();
  el.innerHTML = PIPELINE.map(({ estado, dot, open }) => {
    let group = quotes.filter(q => (q.estado || 'Borrador') === estado);
    if (searchVal) group = group.filter(q =>
      (q.empresa||'').toLowerCase().includes(searchVal) ||
      (q.numero||'').toLowerCase().includes(searchVal) ||
      (q.descripcion||'').toLowerCase().includes(searchVal)
    );
    const total = group.reduce((s, q) => s + (Number(q.valor) || 0), 0);
    return `<div class="pipeline-group${open ? ' open' : ''}" data-pg="${escapeHtml(estado)}">
      <div class="pipeline-group-header">
        <span class="pg-dot ${dot}"></span>
        <span class="pg-name">${escapeHtml(estado)}</span>
        <span class="pg-count">${group.length}</span>
        ${total ? `<span class="pg-total">${formatCLP(total)}</span>` : ''}
        <svg class="pg-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
      </div>
      <div class="pipeline-group-body">
        ${group.length ? group.map(q => cardQuoteHtml(q)).join('') : '<div class="pg-empty">Sin cotizaciones</div>'}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.pipeline-group-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.pipeline-group').classList.toggle('open'));
  });
  bindQuoteCards(el);
}

document.getElementById('quotesViewToggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vtoggle]');
  if (!btn) return;
  _quotesView = btn.dataset.vtoggle;
  document.querySelectorAll('#quotesViewToggle .vtoggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.vtoggle === _quotesView));
  document.getElementById('quotes-list').classList.toggle('hidden', _quotesView === 'pipeline');
  document.getElementById('pipeline-view').classList.toggle('hidden', _quotesView === 'list');
  if (_quotesView === 'pipeline') renderPipeline();
  else renderQuotes();
});

// ---------- PWA service worker ----------
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
