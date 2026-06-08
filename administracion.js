import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, addDoc, deleteDoc, setDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// ── Init ──
const fbApp = initializeApp(firebaseConfig, 'admin-panel');
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);
const gProvider = new GoogleAuthProvider();

// ── State ──
let sessions   = [];
let activity   = [];
let broadcasts = [];
let quotes     = [];
let clients    = [];
let adminNotes = [];
let notifTemplates = []; // pool de plantillas de notificación push guardadas
let userRoles    = {}; // uid → boolean (isAdmin)
let userApproved = {}; // uid → boolean (approved, acceso a datos)
const OWNER_EMAIL = 'ignaciiio.mate@gmail.com';
let unsubSessions  = null;
let unsubActivity  = null;
let unsubBroadcast = null;
let unsubQuotes    = null;
let unsubClients   = null;
let unsubNotes     = null;
let unsubNotifTpl  = null;
let currentSection = 'overview';

// Activity filter + pagination state
const actFilters = { search: '', action: 'all', user: '', dateFrom: '', dateTo: '' };
let actPage = 0;
const PAGE_SIZE = 25;

// ── Helpers ──
const el  = id => document.getElementById(id);
const esc = s  => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// IDs sin colisiones: crypto.randomUUID() en contexto seguro; fallback por compatibilidad.
const adminUid = () => (self.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Toast mínimo para no fallar en silencio cuando una suscripción se rompe.
let _adminToastTimer;
function adminToast(msg, isErr = false) {
  let t = el('adminToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'adminToast';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'padding:10px 16px;border-radius:8px;color:#fff;font-size:13px;z-index:99999;' +
      'max-width:90vw;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.35);transition:opacity .3s';
    document.body.appendChild(t);
  }
  t.style.background = isErr ? '#b91c1c' : '#1f2937';
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(_adminToastTimer);
  _adminToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4500);
}

// Manejador de errores de onSnapshot: no dejar secciones vacías sin explicación.
function snapErr(label) {
  return (err) => {
    console.error(`[${label}]`, err);
    if (err && err.code === 'permission-denied') { showNoAdmin(); return; }
    adminToast(`No se pudo cargar ${label}: ${err?.message || err}`, true);
  };
}

const formatCLPShort = (v) => {
  if (!v && v !== 0) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `$ ${(n/1_000_000_000).toLocaleString('es-CL', {maximumFractionDigits:2})} MM`;
  if (n >= 1_000_000)     return `$ ${(n/1_000_000).toLocaleString('es-CL', {maximumFractionDigits:1})} M`;
  return '$ ' + n.toLocaleString('es-CL');
};

function fmtDuration(sec) {
  if (!sec || sec < 60) return '< 1m';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function timeAgo(date) {
  if (!date) return '—';
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60)  return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60)  return `hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `hace ${h}h`;
  const d = Math.round(h / 24);
  return d < 30 ? `hace ${d}d` : date.toLocaleDateString('es-CL');
}

function fmtDatetime(date) {
  if (!date) return '—';
  return date.toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' })
    + ' ' + date.toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit' });
}

function fmtDateShort(str) {
  if (!str) return '—';
  // str may be 'YYYY-MM-DD'
  const parts = str.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return str;
}

// ── Users ──
function buildUserMap() {
  const map = {};
  sessions.forEach(s => {
    if (!map[s.uid]) map[s.uid] = {
      uid: s.uid, displayName: s.displayName, email: s.email, photoURL: s.photoURL,
      sessions: 0, totalTime: 0, lastSeen: null, online: false,
    };
    const u = map[s.uid];
    u.sessions++;
    u.totalTime += s.duration || 0;
    if (s.endTime === null) u.online = true;
    const t = s.startTime?.toDate?.();
    if (t && (!u.lastSeen || t > u.lastSeen)) u.lastSeen = t;
  });
  return Object.values(map).sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
}

function avatarHtml(u, size = 34) {
  const init = (u.displayName || u.email || '?').trim()[0].toUpperCase();
  return u.photoURL
    ? `<div class="u-avatar" style="width:${size}px;height:${size}px"><img src="${esc(u.photoURL)}" alt="" /></div>`
    : `<div class="u-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px">${esc(init)}</div>`;
}

function approveBtnHtml(uid, approved) {
  const base = 'cursor:pointer;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;white-space:nowrap';
  return approved
    ? `<button class="approve-btn" data-approve-uid="${esc(uid)}" data-approve-val="0" style="${base};background:rgba(52,211,153,.18);color:var(--success)">✓ Aprobado</button>`
    : `<button class="approve-btn" data-approve-uid="${esc(uid)}" data-approve-val="1" style="${base};background:var(--accent);color:#fff">Aprobar</button>`;
}

function userRowHtml(u) {
  const badge = u.online
    ? '<span class="badge online">● En línea</span>'
    : '<span class="badge offline">Desconectado</span>';
  const isAdm = userRoles[u.uid] === true;
  // Los admins tienen acceso siempre; los demás se gestionan con el botón Aprobar.
  const roleMini = (val, label) => `<button data-role-uid="${esc(u.uid)}" data-role-val="${val}" style="cursor:pointer;border:none;background:transparent;color:var(--muted);font-size:10px;text-decoration:underline;padding:2px 0;display:block;margin-top:3px">${label}</button>`;
  const rolCell = isAdm
    ? `<span class="rol-badge rol-admin">Admin</span>${roleMini('0', 'quitar admin')}`
    : `${approveBtnHtml(u.uid, userApproved[u.uid] === true)}${roleMini('1', 'hacer admin')}`;
  return `<div class="user-row">
    <div class="user-ident">${avatarHtml(u)}<div><div class="u-name">${esc(u.displayName||'—')}</div></div></div>
    <div class="u-cell">${rolCell}</div>
    <div class="u-cell u-email">${esc(u.email||'—')}</div>
    <div class="u-cell">${u.sessions}</div>
    <div class="u-cell">${fmtDuration(u.totalTime)}</div>
    <div class="u-cell muted">${timeAgo(u.lastSeen)}</div>
    <div class="u-cell">${badge}</div>
  </div>`;
}

// ── Overview render ──
function renderAll() {
  const users = buildUserMap();
  const avgTime = users.length
    ? Math.round(users.reduce((s, u) => s + u.totalTime, 0) / users.length) : 0;
  const actionCount = activity.filter(a => !['login','logout'].includes(a.action)).length;

  el('statUsers').textContent    = users.length;
  el('statSessions').textContent = sessions.length;
  el('statAvgTime').textContent  = fmtDuration(avgTime);
  el('statActions').textContent  = actionCount;

  const countLabel = `${users.length} usuario${users.length !== 1 ? 's' : ''}`;
  el('overviewUserCount').textContent = countLabel;
  el('usersCount').textContent        = countLabel;

  const rowsHtml = users.length
    ? users.map(userRowHtml).join('')
    : '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Sin sesiones registradas aún</div>';

  el('overviewUserList').innerHTML = rowsHtml;
  el('fullUserList').innerHTML     = rowsHtml;

  updateUserFilterSelect(users);
  renderActivity();
  renderComercial();
  populateNotifTargets(users);
}

// ── Tablero comercial (BI) ──
const COM_PROB = { 'Borrador': 0.10, 'Enviada': 0.40, 'En revisión': 0.60 };

function _uidNameMap() {
  const m = {};
  sessions.forEach(s => { if (s.uid && s.displayName) m[s.uid] = s.displayName; });
  activity.forEach(a => { if (a.uid && a.displayName) m[a.uid] = a.displayName; });
  return m;
}

const _biCard = (title, inner) =>
  `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:14px">
     <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">${title}</div>${inner}</div>`;

function _biBars(items, color) {
  if (!items.length) return '<div style="color:var(--muted);font-size:13px">Sin datos</div>';
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map(i => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="width:88px;flex-shrink:0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.label)}</div>
    <div style="flex:1;background:var(--card-2);border-radius:6px;height:18px;overflow:hidden"><div style="height:100%;border-radius:6px;width:${Math.max(2, Math.round(i.value / max * 100))}%;background:${i.color || color || 'var(--accent)'}"></div></div>
    <div style="width:96px;flex-shrink:0;text-align:right;font-size:11px;color:var(--text);font-weight:600">${esc(i.sub)}</div>
  </div>`).join('');
}

function renderComercial() {
  const kpisEl = el('comKpis');
  const chartsEl = el('comCharts');
  if (!kpisEl || !chartsEl) return;

  const qs = quotes || [];
  const sum = (arr) => arr.reduce((s, q) => s + (Number(q.valor) || 0), 0);
  const adjudicadas = qs.filter(q => q.estado === 'Adjudicada');
  const perdidas    = qs.filter(q => q.estado === 'Perdida');
  const abiertas    = qs.filter(q => !['Adjudicada', 'Perdida'].includes(q.estado || 'Borrador'));
  const cerradas    = adjudicadas.length + perdidas.length;
  const winRate     = cerradas ? Math.round(adjudicadas.length / cerradas * 100) : 0;
  const montoAdj = sum(adjudicadas), montoPerd = sum(perdidas), montoAbierto = sum(abiertas);
  const forecast = abiertas.reduce((s, q) => s + (Number(q.valor) || 0) * (COM_PROB[q.estado || 'Borrador'] ?? 0), 0);

  const kpi = (label, val, color) => `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px">
    <div style="font-size:10.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.03em">${label}</div>
    <div style="font-size:20px;font-weight:800;margin-top:4px;color:${color || 'var(--text)'}">${val}</div></div>`;
  kpisEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
    ${kpi('Pronóstico ponderado', formatCLPShort(forecast), 'var(--accent)')}
    ${kpi('Adjudicado', formatCLPShort(montoAdj), 'var(--success)')}
    ${kpi('Pipeline abierto', formatCLPShort(montoAbierto))}
    ${kpi('Win-rate', winRate + '%')}
    ${kpi('Cotizaciones', String(qs.length))}
  </div>`;

  // Por mes (últimos 6)
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('es-CL', { month: 'short' }) });
  }
  const monthData = months.map(m => {
    const g = qs.filter(q => (q.fecha || '').slice(0, 7) === m.key);
    return { label: m.label, value: g.length, sub: `${g.length} · ${formatCLPShort(sum(g))}` };
  });

  // Adjudicado vs Perdido
  const winLoss = [
    { label: 'Adjudicado', value: montoAdj,  sub: `${adjudicadas.length} · ${formatCLPShort(montoAdj)}`,  color: 'var(--success)' },
    { label: 'Perdido',    value: montoPerd, sub: `${perdidas.length} · ${formatCLPShort(montoPerd)}`, color: 'var(--danger)' },
  ];

  // Por industria / por tipo (por monto)
  const agg = (field, fallback) => {
    const m = {};
    qs.forEach(q => { const k = q[field] || fallback; m[k] = (m[k] || 0) + (Number(q.valor) || 0); });
    return Object.entries(m).map(([label, value]) => ({ label, value, sub: formatCLPShort(value) })).sort((a, b) => b.value - a.value);
  };
  const indData  = agg('industria', 'Sin industria');
  const tipoData = agg('tipoServicio', 'Sin tipo');

  // Ranking por persona (createdBy)
  const nameMap = _uidNameMap();
  const byUser = {};
  qs.forEach(q => {
    const uid = q.createdBy || 'desconocido';
    if (!byUser[uid]) byUser[uid] = { uid, creadas: 0, adjudicadas: 0, monto: 0 };
    byUser[uid].creadas++;
    if (q.estado === 'Adjudicada') { byUser[uid].adjudicadas++; byUser[uid].monto += Number(q.valor) || 0; }
  });
  const ranking = Object.values(byUser).sort((a, b) => b.monto - a.monto || b.adjudicadas - a.adjudicadas || b.creadas - a.creadas);
  const rankRows = ranking.slice(0, 10).map((r, i) => `<tr style="border-top:1px solid var(--border)">
    <td style="padding:7px 4px;color:var(--muted)">${i + 1}</td>
    <td style="padding:7px 4px;font-weight:600">${esc(nameMap[r.uid] || (r.uid === 'desconocido' ? 'Sin autor' : r.uid.slice(0, 6)))}</td>
    <td style="padding:7px 4px;text-align:center">${r.creadas}</td>
    <td style="padding:7px 4px;text-align:center;color:var(--success);font-weight:600">${r.adjudicadas}</td>
    <td style="padding:7px 4px;text-align:right;font-weight:600">${formatCLPShort(r.monto)}</td>
  </tr>`).join('');
  const rankTable = `<table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em">
      <th style="padding:4px;text-align:left">#</th><th style="padding:4px;text-align:left">Persona</th>
      <th style="padding:4px;text-align:center">Creadas</th><th style="padding:4px;text-align:center">Adjud.</th>
      <th style="padding:4px;text-align:right">Monto adj.</th>
    </tr></thead><tbody>${rankRows || '<tr><td colspan="5" style="padding:10px;color:var(--muted)">Sin datos</td></tr>'}</tbody></table>`;

  chartsEl.innerHTML =
    _biCard('Cotizaciones por mes', _biBars(monthData)) +
    _biCard('Adjudicado vs Perdido', _biBars(winLoss)) +
    _biCard('Por industria', _biBars(indData)) +
    _biCard('Por tipo de servicio', _biBars(tipoData)) +
    _biCard('Ranking del equipo (por monto adjudicado)', rankTable);
}

// ── Aprobación de acceso ──
async function toggleApproved(uid, value) {
  try {
    await setDoc(doc(db, 'users', uid), { approved: value }, { merge: true });
    userApproved[uid] = value;
    renderAll();
    adminToast(value ? 'Acceso aprobado' : 'Acceso revocado');
  } catch (e) {
    console.error('toggleApproved', e);
    adminToast('No se pudo cambiar el acceso: ' + (e?.message || e), true);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-approve-uid]');
  if (!btn) return;
  toggleApproved(btn.dataset.approveUid, btn.dataset.approveVal === '1');
});

async function toggleAdmin(uid, value) {
  if (!confirm(value
    ? '¿Dar permisos de ADMINISTRADOR a este usuario? Podrá ver y gestionar todo el panel.'
    : '¿Quitar los permisos de administrador?')) return;
  try {
    await setDoc(doc(db, 'users', uid), { isAdmin: value }, { merge: true });
    userRoles[uid] = value;
    if (value) userApproved[uid] = true; // un admin siempre tiene acceso
    renderAll();
    adminToast(value ? 'Ahora es administrador' : 'Permisos de administrador removidos');
  } catch (e) {
    console.error('toggleAdmin', e);
    adminToast('No se pudo cambiar el rol: ' + (e?.message || e), true);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role-uid]');
  if (!btn) return;
  toggleAdmin(btn.dataset.roleUid, btn.dataset.roleVal === '1');
});

// ── Activity ──
const ACT_CFG = {
  login:          { text: 'inició sesión',              color: 'var(--success)', bg: 'rgba(52,211,153,.15)'  },
  logout:         { text: 'cerró sesión',               color: 'var(--muted)',   bg: 'rgba(107,140,173,.12)' },
  quote_new:      { text: 'creó cotización',            color: 'var(--accent)',  bg: 'rgba(249,115,22,.15)'  },
  quote_edit:     { text: 'editó cotización',           color: 'var(--warn)',    bg: 'rgba(251,191,36,.12)'  },
  quote_delete:   { text: 'eliminó cotización',         color: 'var(--danger)',  bg: 'rgba(248,113,113,.12)' },
  quote_estado:   { text: 'cambió estado cotización',   color: 'var(--indigo)',  bg: 'rgba(129,140,248,.12)' },
  quote_contacto: { text: 'registró seguimiento',       color: 'var(--success)', bg: 'rgba(52,211,153,.12)'  },
  quote_note:     { text: 'anotó en cotización',        color: 'var(--accent-2)', bg: 'rgba(148,163,184,.12)' },
  client_new:     { text: 'creó cliente',               color: 'var(--accent)',  bg: 'rgba(249,115,22,.15)'  },
  client_edit:    { text: 'editó cliente',              color: 'var(--warn)',    bg: 'rgba(251,191,36,.12)'  },
  client_delete:  { text: 'eliminó cliente',            color: 'var(--danger)',  bg: 'rgba(248,113,113,.12)' },
  client_note:    { text: 'anotó en cliente',           color: 'var(--accent-2)', bg: 'rgba(148,163,184,.12)' },
};

function applyActivityFilters() {
  const { search, action, user, dateFrom, dateTo } = actFilters;
  const q  = search.toLowerCase().trim();
  const df = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const dt = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;

  return activity.filter(a => {
    if (action !== 'all' && a.action !== action) return false;
    if (user && a.uid !== user) return false;
    if (q) {
      const name  = (a.displayName || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      const det   = (a.detail || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q) && !det.includes(q)) return false;
    }
    if (df || dt) {
      const t = a.timestamp?.toDate?.();
      if (!t) return false;
      if (df && t < df) return false;
      if (dt && t > dt) return false;
    }
    return true;
  });
}

function actAvatarHtml(a) {
  const init = (a.displayName || a.email || '?').trim()[0].toUpperCase();
  return a.photoURL
    ? `<div class="act-avatar-sm"><img src="${esc(a.photoURL)}" alt="" /></div>`
    : `<div class="act-avatar-sm">${esc(init)}</div>`;
}

function renderActivity() {
  const listEl = el('activityList');
  const pagEl  = el('activityPagination');
  if (!listEl) return;

  const filtered = applyActivityFilters();
  const total    = filtered.length;
  const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (actPage >= pages) actPage = pages - 1;

  el('activityCount').textContent = `${total} evento${total !== 1 ? 's' : ''}${total < activity.length ? ` (de ${activity.length})` : ''}`;

  if (!total) {
    listEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">Sin resultados para los filtros aplicados.</div>';
    if (pagEl) pagEl.style.display = 'none';
    return;
  }

  const slice = filtered.slice(actPage * PAGE_SIZE, (actPage + 1) * PAGE_SIZE);
  listEl.innerHTML = slice.map(a => {
    const cfg  = ACT_CFG[a.action] || { text: a.action, color: 'var(--muted)', bg: 'rgba(107,140,173,.1)' };
    const ts   = a.timestamp?.toDate?.();
    const when = ts ? fmtDatetime(ts) : '—';
    const ago  = ts ? timeAgo(ts) : '';
    return `<div class="act-row">
      ${actAvatarHtml(a)}
      <div class="act-main">
        <div class="act-main-line"><strong>${esc(a.displayName || a.email)}</strong> ${cfg.text}</div>
        ${a.detail ? `<div class="act-detail-line">${esc(a.detail)}</div>` : ''}
      </div>
      <span class="act-badge" style="color:${cfg.color};background:${cfg.bg}">${cfg.text}</span>
      <div class="act-time-cell" title="${esc(when)}">${esc(ago || when)}</div>
    </div>`;
  }).join('');

  // Pagination
  if (pages <= 1) {
    if (pagEl) pagEl.style.display = 'none';
    return;
  }
  if (pagEl) {
    pagEl.style.display = '';
    const start = actPage * PAGE_SIZE + 1;
    const end   = Math.min((actPage + 1) * PAGE_SIZE, total);
    pagEl.innerHTML = `
      <span class="pag-info">${start}–${end} de ${total} eventos</span>
      <div class="pag-controls">
        <button class="pag-btn" id="pagFirst" ${actPage===0?'disabled':''}>«</button>
        <button class="pag-btn" id="pagPrev"  ${actPage===0?'disabled':''}>‹ Anterior</button>
        ${buildPageBtns(actPage, pages)}
        <button class="pag-btn" id="pagNext" ${actPage>=pages-1?'disabled':''}>Siguiente ›</button>
        <button class="pag-btn" id="pagLast" ${actPage>=pages-1?'disabled':''}>»</button>
      </div>`;
    pagEl.querySelector('#pagFirst')?.addEventListener('click', () => goPage(0));
    pagEl.querySelector('#pagPrev')?.addEventListener('click',  () => goPage(actPage - 1));
    pagEl.querySelector('#pagNext')?.addEventListener('click',  () => goPage(actPage + 1));
    pagEl.querySelector('#pagLast')?.addEventListener('click',  () => goPage(pages - 1));
    pagEl.querySelectorAll('.pag-btn[data-p]').forEach(b =>
      b.addEventListener('click', () => goPage(+b.dataset.p)));
  }
}

function buildPageBtns(current, total) {
  const show = new Set();
  show.add(0); show.add(total - 1);
  for (let i = current - 1; i <= current + 1; i++) if (i >= 0 && i < total) show.add(i);
  const pages = [...show].sort((a, b) => a - b);
  let html = '';
  let prev = -1;
  for (const p of pages) {
    if (prev !== -1 && p - prev > 1) html += '<span class="pag-dots">…</span>';
    html += `<button class="pag-btn${p === current ? ' active' : ''}" data-p="${p}">${p + 1}</button>`;
    prev = p;
  }
  return html;
}

function goPage(p) {
  actPage = p;
  renderActivity();
  el('activityList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── User filter select ──
function updateUserFilterSelect(users) {
  const map = {};
  activity.forEach(a => { if (a.uid && !map[a.uid]) map[a.uid] = a.displayName || a.email || a.uid; });
  users.forEach(u => { if (!map[u.uid]) map[u.uid] = u.displayName || u.email || u.uid; });
  const entries = Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]));
  const optHtml = '<option value="">Todos los usuarios</option>'
    + entries.map(([uid, name]) => `<option value="${esc(uid)}">${esc(name)}</option>`).join('');
  ['actUserFilter','mActUserFilter'].forEach(id => {
    const sel = el(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = optHtml;
    sel.value = cur;
  });
}

// ── Broadcasts ──
function renderBroadcasts() {
  const listEl = el('broadcastList');
  if (!listEl) return;
  el('broadcastCount').textContent = `${broadcasts.length} envío${broadcasts.length !== 1 ? 's' : ''}`;
  if (!broadcasts.length) {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Sin envíos aún</div>';
    return;
  }
  listEl.innerHTML = broadcasts.map(b => {
    const when = b.createdAt?.toDate ? timeAgo(b.createdAt.toDate()) : '—';
    const schedTxt = b.scheduledFor?.toDate ? b.scheduledFor.toDate().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const sentLine = b.status === 'scheduled'
      ? `<span class="bi-pending">🕒 Programada para ${schedTxt}</span>`
      : b.sent != null
        ? `<span class="bi-sent">✓ Enviado a ${b.sent} dispositivo${b.sent !== 1 ? 's' : ''}</span>`
        : `<span class="bi-pending">En cola…</span>`;
    const tgtLine = (b.target && b.target !== 'all') ? '<span>· segmentada</span>' : '';
    return `<div class="broadcast-item" data-id="${esc(b.id)}">
      <div class="bi-dot"></div>
      <div class="bi-body">
        <div class="bi-title">${esc(b.title)}</div>
        ${b.body ? `<div class="bi-text">${esc(b.body)}</div>` : ''}
        <div class="bi-meta">${sentLine}${tgtLine}<span>${when}</span><span>por ${esc(b.sentBy||'—')}</span></div>
      </div>
      <button class="bi-delete" data-id="${esc(b.id)}" title="Eliminar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.bi-delete').forEach(btn =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      btn.disabled = true;
      try { await deleteDoc(doc(db, 'adminBroadcasts', id)); }
      catch (_) { btn.disabled = false; }
    })
  );
}

// ── Notes / Recordatorios ──
const NOTE_URGENCIA_SORT = { urgente: 0, normal: 1, bajo: 2 };

function sortedNotes() {
  return [...adminNotes].sort((a, b) => {
    const pa = NOTE_URGENCIA_SORT[a.urgencia] ?? 1;
    const pb = NOTE_URGENCIA_SORT[b.urgencia] ?? 1;
    if (pa !== pb) return pa - pb;
    return (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0);
  });
}

function renderNotes() {
  const listEl = el('notesList');
  const countEl = el('notesCount');
  if (countEl) countEl.textContent = `${adminNotes.length} nota${adminNotes.length !== 1 ? 's' : ''}`;
  if (!listEl) return;

  const sorted = sortedNotes();
  if (!sorted.length) {
    listEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">Sin recordatorios aún. Agrega tu primera nota arriba.</div>';
    return;
  }

  const lineClass   = { urgente: 'rec-line-urgente', normal: 'rec-line-normal',   bajo: 'rec-line-bajo'    };
  const urgClass    = { urgente: 'rec-urg-urgente',  normal: 'rec-urg-normal',    bajo: 'rec-urg-bajo'     };
  const urgLabel    = { urgente: '🔴 Urgente',        normal: '🟡 Normal',          bajo: '🔵 Bajo'           };

  listEl.innerHTML = sorted.map(n => {
    const lc = lineClass[n.urgencia] || 'rec-line-bajo';
    const uc = urgClass[n.urgencia]  || 'rec-urg-bajo';
    const ul = urgLabel[n.urgencia]  || n.urgencia;
    const when = n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : '—';
    return `<div class="rec-card">
      <div class="rec-card-left ${lc}"></div>
      <div class="rec-card-body">
        <div class="rec-card-text">${esc(n.text)}</div>
        <div class="rec-card-meta">
          <span class="rec-urgencia ${uc}">${ul}</span>
          <span style="font-size:11px;color:var(--muted)">${esc(when)}</span>
          ${n.createdBy ? `<span style="font-size:11px;color:var(--muted)">por ${esc(n.createdBy)}</span>` : ''}
        </div>
      </div>
      <button class="rec-delete-btn" data-id="${esc(n.id)}" title="Eliminar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.rec-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este recordatorio?')) return;
      btn.disabled = true;
      try { await deleteDoc(doc(db, 'adminNotes', btn.dataset.id)); }
      catch (_) { btn.disabled = false; }
    });
  });
}

function renderNotesOverview() {
  const el2 = el('overviewNotes');
  if (!el2) return;
  const sorted = sortedNotes();
  if (!sorted.length) {
    el2.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Sin recordatorios aún</div>';
    return;
  }
  const ovClass = { urgente: 'rec-ov-urgente', normal: 'rec-ov-normal', bajo: 'rec-ov-bajo' };
  el2.innerHTML = sorted.map(n => {
    const oc = ovClass[n.urgencia] || 'rec-ov-bajo';
    return `<div class="rec-overview-item ${oc}">
      <div class="rec-overview-text">${esc(n.text)}</div>
    </div>`;
  }).join('');
}

el('addNoteBtn')?.addEventListener('click', async () => {
  const text = el('newNoteText')?.value.trim();
  if (!text) { el('newNoteText')?.focus(); return; }
  const urgencia = document.querySelector('input[name="noteUrgencia"]:checked')?.value || 'normal';
  const btn = el('addNoteBtn');
  btn.disabled = true;
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'adminNotes'), {
      text, urgencia,
      createdAt: serverTimestamp(),
      createdBy: user?.displayName || user?.email || 'Admin',
    });
    el('newNoteText').value = '';
    const defRadio = document.querySelector('input[name="noteUrgencia"][value="normal"]');
    if (defRadio) defRadio.checked = true;
  } catch (err) { console.error('Error adding note:', err); }
  finally { btn.disabled = false; }
});

el('goRecordatoriosBtn')?.addEventListener('click', () => showSection('recordatorios'));

// ── Quotes ──
function estadoBadgeClass(estado) {
  const map = {
    'Borrador':    'estado-borrador',
    'Enviada':     'estado-enviada',
    'En revisión': 'estado-revision',
    'Adjudicada':  'estado-adjudicada',
    'Perdida':     'estado-perdida',
  };
  return map[estado] || 'estado-borrador';
}

let quotesSearchQuery = '';

function renderQuotes() {
  renderComercial();
  const listEl = el('quotesList');
  if (!listEl) return;

  const q = quotesSearchQuery.toLowerCase().trim();
  const filtered = q
    ? quotes.filter(qt =>
        (qt.empresa || '').toLowerCase().includes(q) ||
        (qt.numero  || '').toLowerCase().includes(q) ||
        (qt.descripcion || '').toLowerCase().includes(q)
      )
    : quotes;

  el('quotesCount').textContent = `${filtered.length} cotización${filtered.length !== 1 ? 'es' : ''}`;

  if (!filtered.length) {
    listEl.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">${q ? 'Sin resultados para la búsqueda.' : 'Sin cotizaciones aún. Haz clic en "Nueva cotización" para crear una.'}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(qt => {
    const cls = estadoBadgeClass(qt.estado);
    const desc = qt.descripcion ? (qt.descripcion.length > 50 ? qt.descripcion.slice(0, 50) + '…' : qt.descripcion) : '—';
    return `<div class="quote-row" data-id="${esc(qt.id)}">
      <div><span class="estado-badge ${cls}">${esc(qt.estado || 'Borrador')}</span></div>
      <div class="u-cell">${esc(qt.numero || '—')}</div>
      <div class="u-cell" style="font-weight:600">${esc(qt.empresa || '—')}</div>
      <div class="u-cell muted">${esc(fmtDateShort(qt.fecha))}</div>
      <div class="u-cell">${esc(formatCLPShort(qt.valor))}</div>
      <div class="u-cell muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(desc)}</div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.quote-row').forEach(row =>
    row.addEventListener('click', () => {
      const qt = quotes.find(q => q.id === row.dataset.id);
      if (qt) openQuoteModal(qt);
    })
  );
}

// ── Clients ──
let clientsSearchQuery = '';
let clientPage = 0;
const CLIENT_PAGE_SIZE = 20;

function buildPageBtnsClients(totalPages) {
  const pgEl = el('clientsPagination');
  if (!pgEl) return;
  if (totalPages <= 1) { pgEl.innerHTML = ''; pgEl.style.display = 'none'; return; }
  pgEl.style.display = '';
  const start = clientPage * CLIENT_PAGE_SIZE;
  const end   = Math.min(start + CLIENT_PAGE_SIZE, totalPages * CLIENT_PAGE_SIZE);
  pgEl.innerHTML = `
    <div class="pag-info">Página ${clientPage + 1} de ${totalPages}</div>
    <div class="pag-controls">
      <button class="pag-btn" id="cpFirst" ${clientPage===0?'disabled':''}>«</button>
      <button class="pag-btn" id="cpPrev"  ${clientPage===0?'disabled':''}>‹</button>
      ${buildPageBtns(clientPage, totalPages)}
      <button class="pag-btn" id="cpNext" ${clientPage>=totalPages-1?'disabled':''}>›</button>
      <button class="pag-btn" id="cpLast" ${clientPage>=totalPages-1?'disabled':''}>»</button>
    </div>`;
  pgEl.querySelector('#cpFirst')?.addEventListener('click', () => { clientPage = 0; renderClients(); });
  pgEl.querySelector('#cpPrev')?.addEventListener('click',  () => { clientPage--; renderClients(); });
  pgEl.querySelector('#cpNext')?.addEventListener('click',  () => { clientPage++; renderClients(); });
  pgEl.querySelector('#cpLast')?.addEventListener('click',  () => { clientPage = totalPages - 1; renderClients(); });
  pgEl.querySelectorAll('.pag-btn[data-p]').forEach(b => b.addEventListener('click', () => {
    clientPage = Number(b.dataset.p); renderClients();
  }));
}

function renderClients() {
  const listEl = el('clientsList');
  if (!listEl) return;

  const q = clientsSearchQuery.toLowerCase().trim();
  const filtered = q
    ? clients.filter(c =>
        (c.empresa || '').toLowerCase().includes(q) ||
        (c.nombre  || '').toLowerCase().includes(q) ||
        (c.email   || '').toLowerCase().includes(q)
      )
    : clients;

  el('clientsCount').textContent = `${filtered.length} cliente${filtered.length !== 1 ? 's' : ''}`;

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENT_PAGE_SIZE));
  if (clientPage >= totalPages) clientPage = 0;
  const start = clientPage * CLIENT_PAGE_SIZE;
  const page  = filtered.slice(start, start + CLIENT_PAGE_SIZE);

  if (!filtered.length) {
    listEl.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">${q ? 'Sin resultados para la búsqueda.' : 'Sin clientes aún. Haz clic en "Nuevo cliente" para crear uno.'}</div>`;
    buildPageBtnsClients(0);
    return;
  }

  listEl.innerHTML = page.map(c => `<div class="client-row" data-id="${esc(c.id)}">
    <div class="u-cell" style="font-weight:600">${esc(c.empresa || '—')}</div>
    <div class="u-cell">${esc(c.nombre || '—')}</div>
    <div class="u-cell muted">${esc(c.email || '—')}</div>
    <div class="u-cell muted">${esc(c.telefono || '—')}</div>
    <div class="u-cell muted">${esc(c.cargo || '—')}</div>
  </div>`).join('');

  listEl.querySelectorAll('.client-row').forEach(row =>
    row.addEventListener('click', () => {
      const c = clients.find(c => c.id === row.dataset.id);
      if (c) openClientModal(c);
    })
  );
  buildPageBtnsClients(totalPages);
}

// ── Quote Modal ──
let quoteEditId = null;

function openQuoteModal(qt = null) {
  quoteEditId = qt ? qt.id : null;
  el('quoteModalTitle').textContent = qt ? 'Editar cotización' : 'Nueva cotización';
  el('qEmpresa').value    = qt?.empresa     || '';
  el('qNumero').value     = qt?.numero      || '';
  el('qFecha').value      = qt?.fecha       || '';
  el('qValor').value      = qt?.valor != null ? qt.valor : '';
  el('qDescripcion').value= qt?.descripcion || '';
  el('qContactos').value  = Array.isArray(qt?.contactos) ? qt.contactos.join('; ') : (qt?.contactos || '');
  el('qEstado').value     = qt?.estado      || 'Borrador';
  el('qSeguimiento').value= qt?.seguimiento || '';
  el('qNotas').value      = qt?.notas       || '';
  el('quoteDeleteBtn').style.display = qt ? '' : 'none';
  quoteEditLog = Array.isArray(qt?._log) ? qt._log : [];
  el('quoteHistoryBtn').style.display = quoteEditLog.length ? '' : 'none';
  el('quoteModal').style.display = '';
}

let quoteEditLog = [];
el('quoteHistoryBtn')?.addEventListener('click', () => {
  el('synapModalTitle').textContent = 'Historial de cambios';
  el('synapModalBody').innerHTML = quoteEditLog.length
    ? `<div style="display:flex;flex-direction:column;gap:10px">${quoteEditLog.slice().reverse().map(e => `
        <div style="border-left:2px solid var(--accent);padding:2px 0 2px 10px">
          <div style="font-size:12px;color:var(--muted)">${esc(fmtDatetime(new Date(e.t)))} · ${esc(e.u || '—')}</div>
          <div style="font-size:13px;color:var(--text);margin-top:2px">${esc(e.d || '')}</div>
        </div>`).join('')}</div>`
    : '<div style="color:var(--muted)">Sin cambios registrados.</div>';
  el('synapModal').style.display = '';
});

function closeQuoteModal() {
  el('quoteModal').style.display = 'none';
  quoteEditId = null;
}

el('quoteModalClose')?.addEventListener('click', closeQuoteModal);
el('quoteModalCancel')?.addEventListener('click', closeQuoteModal);

el('quoteModal')?.addEventListener('click', e => {
  if (e.target === el('quoteModal')) closeQuoteModal();
});

el('quoteModalCard')?.addEventListener('click', e => e.stopPropagation());

el('quoteModalSave')?.addEventListener('click', async () => {
  const empresa     = el('qEmpresa').value.trim();
  const numero      = el('qNumero').value.trim();
  const fecha       = el('qFecha').value;
  const valorRaw    = el('qValor').value.trim();
  const descripcion = el('qDescripcion').value.trim();
  const contactosRaw= el('qContactos').value.trim();
  const estado      = el('qEstado').value;
  const seguimiento = el('qSeguimiento').value;
  const notas       = el('qNotas').value.trim();

  const valor = valorRaw !== '' ? Number(valorRaw) : null;
  const contactos = contactosRaw
    ? contactosRaw.split(';').map(s => s.trim()).filter(Boolean)
    : [];

  const btn = el('quoteModalSave');
  btn.disabled = true;

  try {
    const data = {
      empresa, numero, fecha, descripcion,
      valor: valor !== null ? valor : null,
      contactos, estado,
      seguimiento: seguimiento || null,
      notas,
      updatedAt: serverTimestamp(),
    };

    if (quoteEditId) {
      await setDoc(doc(db, 'quotes', quoteEditId), data, { merge: true });
    } else {
      const newId = adminUid();
      await setDoc(doc(db, 'quotes', newId), {
        ...data,
        id: newId,
        createdAt: serverTimestamp(),
      });
    }
    closeQuoteModal();
  } catch (err) {
    console.error('Error saving quote:', err);
  } finally {
    btn.disabled = false;
  }
});

el('quoteDeleteBtn')?.addEventListener('click', async () => {
  if (!quoteEditId) return;
  if (!confirm('¿Eliminar esta cotización? Esta acción no se puede deshacer.')) return;
  try {
    await deleteDoc(doc(db, 'quotes', quoteEditId));
    closeQuoteModal();
  } catch (err) {
    console.error('Error deleting quote:', err);
  }
});

el('newQuoteBtn')?.addEventListener('click', () => openQuoteModal(null));

el('quotesSearch')?.addEventListener('input', e => {
  quotesSearchQuery = e.target.value;
  renderQuotes();
});

// ── Client Modal ──
let clientEditId = null;

function openClientModal(c = null) {
  clientEditId = c ? c.id : null;
  el('clientModalTitle').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  el('cEmpresa').value  = c?.empresa  || '';
  el('cNombre').value   = c?.nombre   || '';
  el('cEmail').value    = c?.email    || '';
  el('cTelefono').value = c?.telefono || '';
  el('cCargo').value    = c?.cargo    || '';
  el('cNotas').value    = c?.notas    || '';
  el('clientDeleteBtn').style.display = c ? '' : 'none';
  el('clientModal').style.display = '';
}

function closeClientModal() {
  el('clientModal').style.display = 'none';
  clientEditId = null;
}

el('clientModalClose')?.addEventListener('click', closeClientModal);
el('clientModalCancel')?.addEventListener('click', closeClientModal);

el('clientModal')?.addEventListener('click', e => {
  if (e.target === el('clientModal')) closeClientModal();
});

el('clientModalCard')?.addEventListener('click', e => e.stopPropagation());

el('clientModalSave')?.addEventListener('click', async () => {
  const empresa  = el('cEmpresa').value.trim();
  if (!empresa) {
    el('cEmpresa').focus();
    el('cEmpresa').style.borderColor = 'var(--danger)';
    setTimeout(() => { el('cEmpresa').style.borderColor = ''; }, 2000);
    return;
  }
  const nombre   = el('cNombre').value.trim();
  const email    = el('cEmail').value.trim();
  const telefono = el('cTelefono').value.trim();
  const cargo    = el('cCargo').value.trim();
  const notas    = el('cNotas').value.trim();

  const btn = el('clientModalSave');
  btn.disabled = true;

  try {
    const data = {
      empresa, nombre, email, telefono, cargo, notas,
      updatedAt: serverTimestamp(),
    };

    if (clientEditId) {
      await setDoc(doc(db, 'clients', clientEditId), data, { merge: true });
    } else {
      const newId = adminUid();
      await setDoc(doc(db, 'clients', newId), {
        ...data,
        id: newId,
        createdAt: serverTimestamp(),
      });
    }
    closeClientModal();
  } catch (err) {
    console.error('Error saving client:', err);
  } finally {
    btn.disabled = false;
  }
});

el('clientDeleteBtn')?.addEventListener('click', async () => {
  if (!clientEditId) return;
  if (!confirm('¿Eliminar este cliente? Esta acción no se puede deshacer.')) return;
  try {
    await deleteDoc(doc(db, 'clients', clientEditId));
    closeClientModal();
  } catch (err) {
    console.error('Error deleting client:', err);
  }
});

el('newClientBtn')?.addEventListener('click', () => openClientModal(null));

el('clientsSearch')?.addEventListener('input', e => {
  clientsSearchQuery = e.target.value;
  clientPage = 0;
  renderClients();
});

// ── Synaptech Analysis ──
function openSynapModal(type) {
  el('synapModal').style.display = '';
}
el('synapModal')?.addEventListener('click', e => { if (e.target === el('synapModal')) el('synapModal').style.display = 'none'; });
el('synapModalCard')?.addEventListener('click', e => e.stopPropagation());
el('synapModalClose')?.addEventListener('click', () => { el('synapModal').style.display = 'none'; });

function fmtCLPAnalysis(v) {
  if (!v && v !== 0) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `$ ${(n/1_000_000_000).toFixed(2).replace('.',',')} MM`;
  if (n >= 1_000_000)     return `$ ${(n/1_000_000).toFixed(1).replace('.',',')} M`;
  return '$ ' + n.toLocaleString('es-CL');
}

el('synapQuotesBtn')?.addEventListener('click', () => {
  const now = Date.now();
  const total = quotes.length;
  if (!total) { alert('No hay cotizaciones para analizar.'); return; }

  const withValue = quotes.filter(q => q.valor != null && q.valor > 0);
  const totalVal  = withValue.reduce((s, q) => s + Number(q.valor), 0);
  const avgVal    = withValue.length ? totalVal / withValue.length : 0;
  const maxQ      = withValue.reduce((m, q) => Number(q.valor) > Number(m.valor || 0) ? q : m, withValue[0] || {});

  const byEstado = {};
  quotes.forEach(q => { const e = q.estado || 'Borrador'; byEstado[e] = (byEstado[e] || 0) + 1; });
  const byEmpresa = {};
  quotes.forEach(q => { if (q.empresa) byEmpresa[q.empresa] = (byEmpresa[q.empresa] || 0) + 1; });
  const topEmpresas = Object.entries(byEmpresa).sort((a,b) => b[1]-a[1]).slice(0, 5);

  const byEmpresaVal = {};
  withValue.forEach(q => { byEmpresaVal[q.empresa || '—'] = (byEmpresaVal[q.empresa || '—'] || 0) + Number(q.valor); });
  const topEmpresasVal = Object.entries(byEmpresaVal).sort((a,b) => b[1]-a[1]).slice(0, 5);

  const sinContacto = quotes.filter(q => !q.contactos || (Array.isArray(q.contactos) ? !q.contactos.length : !q.contactos.trim())).length;
  const sinFecha    = quotes.filter(q => !q.fecha).length;
  const sinSeg      = quotes.filter(q => !q.seguimiento && !['Adjudicada','Perdida'].includes(q.estado)).length;

  const adjudicadas = byEstado['Adjudicada'] || 0;
  const enviadas    = byEstado['Enviada'] || 0;
  const winRate     = enviadas + adjudicadas ? Math.round(adjudicadas / (enviadas + adjudicadas) * 100) : 0;

  const today = new Date(); today.setHours(0,0,0,0);
  const vencidas = quotes.filter(q => {
    if (!q.seguimiento || ['Adjudicada','Perdida'].includes(q.estado)) return false;
    return new Date(q.seguimiento) < today;
  }).length;

  el('synapModalTitle').textContent = 'Análisis de Cotizaciones';
  el('synapModalSub').textContent = `${total} cotizaciones · Generado ${new Date().toLocaleString('es-CL')}`;

  el('synapModalBody').innerHTML = `
    <div class="synap-kpi-row">
      <div class="synap-kpi"><div class="synap-kpi-val">${total}</div><div class="synap-kpi-lbl">Total cotizaciones</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${fmtCLPAnalysis(totalVal)}</div><div class="synap-kpi-lbl">Valor total pipeline</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${fmtCLPAnalysis(avgVal)}</div><div class="synap-kpi-lbl">Ticket promedio</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${winRate}%</div><div class="synap-kpi-lbl">Tasa de adjudicación</div></div>
    </div>

    <div class="synap-grid">
      <div class="synap-section">
        <div class="synap-section-title">Distribución por estado</div>
        ${Object.entries(byEstado).sort((a,b)=>b[1]-a[1]).map(([e,n]) => {
          const pct = Math.round(n/total*100);
          return `<div class="synap-row">
            <div style="flex:1;min-width:0"><div class="synap-row-label">${e}</div><div class="synap-bar-wrap"><div class="synap-bar" style="width:${pct}%"></div></div></div>
            <div style="text-align:right;margin-left:12px"><div class="synap-row-val">${n}</div><div style="font-size:11px;color:var(--muted)">${pct}%</div></div>
          </div>`;
        }).join('')}
      </div>

      <div>
        <div class="synap-section">
          <div class="synap-section-title">Top por valor cotizado</div>
          ${topEmpresasVal.map(([emp, val]) => `<div class="synap-row"><span class="synap-row-label" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(emp)}</span><span class="synap-row-val" style="margin-left:8px;white-space:nowrap">${fmtCLPAnalysis(val)}</span></div>`).join('')}
        </div>
        <div class="synap-section">
          <div class="synap-section-title">Top por cantidad de cotizaciones</div>
          ${topEmpresas.map(([emp, n]) => `<div class="synap-row"><span class="synap-row-label" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(emp)}</span><span class="synap-row-val" style="margin-left:8px;white-space:nowrap">${n} cot.</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="synap-section">
      <div class="synap-section-title">Cotización de mayor valor</div>
      ${maxQ.empresa ? `<div class="synap-row"><span class="synap-row-label">${esc(maxQ.empresa)} · ${esc(maxQ.numero || '—')}</span><span class="synap-row-val">${fmtCLPAnalysis(maxQ.valor)}</span></div>
      <div style="font-size:12px;color:var(--muted);padding:4px 0">${esc(maxQ.descripcion || '')}</div>` : '<div style="color:var(--muted);font-size:13px">Sin datos de valor</div>'}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      ${sinSeg > 0 ? `<div class="synap-alert"><div class="synap-alert-label">⚠ Seguimientos pendientes</div>${sinSeg} cotización${sinSeg !== 1 ? 'es' : ''} activa${sinSeg !== 1 ? 's' : ''} sin fecha de seguimiento definida.</div>` : ''}
      ${vencidas > 0 ? `<div class="synap-alert"><div class="synap-alert-label">⚠ Seguimientos vencidos</div>${vencidas} cotización${vencidas !== 1 ? 'es' : ''} con fecha de seguimiento ya pasada.</div>` : ''}
      ${sinContacto > 0 ? `<div class="synap-insight"><div class="synap-insight-label">ℹ Datos incompletos</div>${sinContacto} cotización${sinContacto !== 1 ? 'es' : ''} sin contacto registrado.</div>` : ''}
      ${winRate >= 50 ? `<div class="synap-insight"><div class="synap-insight-label">✓ Buen desempeño</div>Tasa de adjudicación de ${winRate}% sobre cotizaciones enviadas.</div>` : ''}
    </div>

    ${(()=>{
      const recs = [];
      if (vencidas > 0) recs.push({ p:1, icon:'🔴', txt: `Atender ${vencidas} seguimiento${vencidas!==1?'s':''} vencido${vencidas!==1?'s':''} — contactar a esos clientes hoy es la acción de mayor impacto inmediato.` });
      const proximos = quotes.filter(q=>{ if(!q.seguimiento||['Adjudicada','Perdida'].includes(q.estado))return false; const d=Math.round((new Date(q.seguimiento)-today)/86400000); return d>=0&&d<=3;});
      if (proximos.length) recs.push({ p:2, icon:'🟡', txt: `Preparar ${proximos.length} seguimiento${proximos.length!==1?'s':''} que vence${proximos.length===1?'':'n'} en los próximos 3 días.` });
      if (sinSeg > 0) recs.push({ p:3, icon:'📅', txt: `Definir fecha de seguimiento en ${sinSeg} cotización${sinSeg!==1?'es':''} activa${sinSeg!==1?'s':''} sin planificación.` });
      const borradores = byEstado['Borrador']||0;
      if (borradores > 0) recs.push({ p:4, icon:'📝', txt: `Completar y enviar ${borradores} cotización${borradores!==1?'es':''} en borrador.` });
      if (sinContacto > 0) recs.push({ p:5, icon:'📋', txt: `Agregar contacto en ${sinContacto} cotización${sinContacto!==1?'es':''} — mejora la trazabilidad.` });
      if (topEmpresasVal.length) recs.push({ p:6, icon:'⭐', txt: `Priorizar relación con ${esc(topEmpresasVal[0][0])} (${fmtCLPAnalysis(topEmpresasVal[0][1])} en pipeline) — es tu cliente de mayor valor.` });
      if (!recs.length) return '';
      return `<div class="synap-section">
        <div class="synap-section-title" style="color:var(--accent)">★ Qué hacer ahora</div>
        ${recs.map((r,i)=>`<div class="synap-rec" style="animation-delay:${i*0.07}s">
          <div class="synap-rec-num">${i+1}</div>
          <div class="synap-rec-icon">${r.icon}</div>
          <div class="synap-rec-txt">${r.txt}</div>
        </div>`).join('')}
      </div>`;
    })()}
  `;
  el('synapModal').style.display = '';
});

el('synapClientsBtn')?.addEventListener('click', () => {
  const total = clients.length;
  if (!total) { alert('No hay clientes para analizar.'); return; }

  const campos = ['empresa','nombre','email','telefono','cargo'];
  const scores = clients.map(c => {
    const filled = campos.filter(f => c[f] && String(c[f]).trim()).length;
    return { ...c, score: filled };
  });
  const completos  = scores.filter(s => s.score === 5).length;
  const incompletos = scores.filter(s => s.score < 3).length;
  const avgScore   = Math.round(scores.reduce((s,c)=>s+c.score,0) / total * 10) / 10;

  const sinEmail   = clients.filter(c => !c.email || !c.email.trim()).length;
  const sinTel     = clients.filter(c => !c.telefono || !c.telefono.trim()).length;
  const sinCargo   = clients.filter(c => !c.cargo || !c.cargo.trim()).length;
  const sinNombre  = clients.filter(c => !c.nombre || !c.nombre.trim()).length;

  const clientesCot = {};
  quotes.forEach(q => { if (q.empresa) clientesCot[q.empresa] = (clientesCot[q.empresa] || 0) + 1; });
  const conCotizaciones = clients.filter(c => c.empresa && clientesCot[c.empresa]).length;
  const sinCotizaciones = total - conCotizaciones;

  const topActivos = Object.entries(clientesCot).sort((a,b) => b[1]-a[1]).slice(0, 5);

  el('synapModalTitle').textContent = 'Análisis de Clientes';
  el('synapModalSub').textContent = `${total} clientes · Generado ${new Date().toLocaleString('es-CL')}`;

  el('synapModalBody').innerHTML = `
    <div class="synap-kpi-row">
      <div class="synap-kpi"><div class="synap-kpi-val">${total}</div><div class="synap-kpi-lbl">Total clientes</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${completos}</div><div class="synap-kpi-lbl">Perfiles completos</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${Math.round(completos/total*100)}%</div><div class="synap-kpi-lbl">Completitud</div></div>
      <div class="synap-kpi"><div class="synap-kpi-val">${conCotizaciones}</div><div class="synap-kpi-lbl">Con cotizaciones</div></div>
    </div>

    <div class="synap-grid">
      <div class="synap-section">
        <div class="synap-section-title">Calidad de datos por campo</div>
        ${[
          ['Empresa', clients.filter(c=>c.empresa).length],
          ['Nombre contacto', total - sinNombre],
          ['Email', total - sinEmail],
          ['Teléfono', total - sinTel],
          ['Cargo', total - sinCargo],
        ].map(([lbl, n]) => {
          const pct = Math.round(n/total*100);
          return `<div class="synap-row">
            <div style="flex:1;min-width:0"><div class="synap-row-label">${lbl}</div><div class="synap-bar-wrap"><div class="synap-bar" style="width:${pct}%;background:${pct>=80?'var(--success)':pct>=50?'var(--warn)':'var(--danger)'}"></div></div></div>
            <div style="text-align:right;margin-left:12px"><div class="synap-row-val">${n}/${total}</div><div style="font-size:11px;color:var(--muted)">${pct}%</div></div>
          </div>`;
        }).join('')}
      </div>

      <div class="synap-section">
        <div class="synap-section-title">Clientes más activos (por cotizaciones)</div>
        ${topActivos.length ? topActivos.map(([emp, n]) => `<div class="synap-row"><span class="synap-row-label" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(emp)}</span><span class="synap-row-val" style="margin-left:8px;white-space:nowrap">${n} cotización${n!==1?'es':''}</span></div>`).join('') : '<div style="color:var(--muted);font-size:13px;padding:8px 0">Sin datos cruzados disponibles</div>'}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      ${incompletos > 0 ? `<div class="synap-alert"><div class="synap-alert-label">⚠ Perfiles incompletos</div>${incompletos} cliente${incompletos!==1?'s tienen':' tiene'} menos de 3 campos completados.</div>` : ''}
      ${sinCotizaciones > 0 ? `<div class="synap-insight"><div class="synap-insight-label">ℹ Clientes sin actividad</div>${sinCotizaciones} cliente${sinCotizaciones!==1?'s no tienen':' no tiene'} cotizaciones asociadas.</div>` : ''}
      ${completos === total ? `<div class="synap-insight"><div class="synap-insight-label">✓ Base de datos impecable</div>El 100% de los clientes tiene todos los campos completos.</div>` : ''}
    </div>

    ${(()=>{
      const recs = [];
      const incSorted = scores.filter(s=>s.score<5).sort((a,b)=>b.score-a.score);
      if (incompletos>0) recs.push({ icon:'📋', txt: `Completar ${incompletos} perfil${incompletos!==1?'es de cliente':' de cliente'} con menos de 3 campos — priorizar los que tienen cotizaciones activas.` });
      if (sinEmail>0) recs.push({ icon:'✉️', txt: `Agregar email en ${sinEmail} cliente${sinEmail!==1?'s':''}. Sin email no es posible el contacto digital ni las notificaciones.` });
      if (sinCotizaciones>0) recs.push({ icon:'📊', txt: `Iniciar cotizaciones para ${sinCotizaciones} cliente${sinCotizaciones!==1?'s':''} sin actividad. Son prospectos que podrían generar ingresos.` });
      if (sinTel>0) recs.push({ icon:'📞', txt: `Completar teléfono en ${sinTel} cliente${sinTel!==1?'s':''} para facilitar el contacto directo.` });
      if (topActivos.length) recs.push({ icon:'⭐', txt: `Mantener relación activa con ${esc(topActivos[0][0])} — es el cliente con más cotizaciones históricas (${topActivos[0][1]}).` });
      if (!recs.length) return '';
      return `<div class="synap-section">
        <div class="synap-section-title" style="color:var(--accent)">★ Qué hacer ahora</div>
        ${recs.map((r,i)=>`<div class="synap-rec" style="animation-delay:${i*0.07}s">
          <div class="synap-rec-num">${i+1}</div>
          <div class="synap-rec-icon">${r.icon}</div>
          <div class="synap-rec-txt">${r.txt}</div>
        </div>`).join('')}
      </div>`;
    })()}
  `;
  el('synapModal').style.display = '';
});

// ── Synaptech: notificación óptima ──
el('synapNotifBtn')?.addEventListener('click', () => {
  const today = new Date(); today.setHours(0,0,0,0);

  // Analizar datos para generar sugerencia de notificación
  const vencidas = quotes.filter(q => {
    if (!q.seguimiento || ['Adjudicada','Perdida'].includes(q.estado)) return false;
    return new Date(q.seguimiento) < today;
  });
  const proximas3d = quotes.filter(q => {
    if (!q.seguimiento || ['Adjudicada','Perdida'].includes(q.estado)) return false;
    const d = Math.round((new Date(q.seguimiento) - today) / 86400000);
    return d >= 0 && d <= 3;
  });
  const sinSeg = quotes.filter(q => !q.seguimiento && !['Adjudicada','Perdida'].includes(q.estado));
  const borradores = quotes.filter(q => (q.estado||'') === 'Borrador');
  const totalVal = quotes.filter(q=>q.valor).reduce((s,q)=>s+Number(q.valor),0);
  const sinEmail = clients.filter(c=>!c.email||!c.email.trim());

  // Generar sugerencias ordenadas por urgencia
  const suggestions = [];

  if (vencidas.length) {
    const emps = [...new Set(vencidas.map(q=>q.empresa).filter(Boolean))].slice(0,2).join(', ');
    suggestions.push({
      score: 100,
      titulo: `Seguimiento urgente: ${vencidas.length} cotización${vencidas.length!==1?'es':''} vencida${vencidas.length!==1?'s':''}`,
      mensaje: `Tienes ${vencidas.length} cotización${vencidas.length!==1?'es':''} con seguimiento vencido${emps?` (${emps})`:''}.  Revisa el estado y toma acción hoy.`,
      razon: `Máxima urgencia: existen seguimientos ya vencidos que requieren acción inmediata.`
    });
  }
  if (proximas3d.length) {
    suggestions.push({
      score: 80,
      titulo: `Seguimiento próximo: ${proximas3d.length} cotización${proximas3d.length!==1?'es':''} vence${proximas3d.length===1?'':'n'} en 3 días`,
      mensaje: `Recuerda hacer seguimiento a ${proximas3d.length} cotización${proximas3d.length!==1?'es':''} que vence${proximas3d.length===1?'':'n'} en los próximos días.`,
      razon: `Alta prioridad: seguimientos próximos que pueden perderse sin acción.`
    });
  }
  if (sinSeg.length >= 3) {
    suggestions.push({
      score: 60,
      titulo: `Planifica tu pipeline: ${sinSeg.length} cotizaciones sin seguimiento`,
      mensaje: `Hay ${sinSeg.length} cotizaciones activas sin fecha de seguimiento. Planificar hoy evita que se enfríen las oportunidades.`,
      razon: `Riesgo medio: cotizaciones activas sin seguimiento pueden perderse.`
    });
  }
  if (borradores.length >= 2) {
    suggestions.push({
      score: 50,
      titulo: `Tienes ${borradores.length} cotizaciones en borrador`,
      mensaje: `Completa y envía tus borradores. Cada día sin envío reduce la probabilidad de adjudicación.`,
      razon: `Oportunidad: borradores que podrían convertirse en ingresos.`
    });
  }
  if (totalVal > 0) {
    const fv = fmtCLPAnalysis(totalVal);
    suggestions.push({
      score: 30,
      titulo: 'Resumen del pipeline comercial',
      mensaje: `Tu pipeline activo suma ${fv}. Mantén el seguimiento constante para maximizar las adjudicaciones.`,
      razon: `Motivacional: recordatorio del valor del pipeline para mantener el enfoque.`
    });
  }
  suggestions.push({
    score: 20,
    titulo: 'Recuerda registrar tu actividad',
    mensaje: 'Mantén actualizadas las cotizaciones y clientes en Sonqollay para tener siempre una visión clara del negocio.',
    razon: `Recordatorio general de uso y buenas prácticas.`
  });

  const best = suggestions[0];

  el('synapModalTitle').textContent = 'Notificación óptima sugerida';
  el('synapModalSub').textContent = `Basado en ${quotes.length} cotizaciones y ${clients.length} clientes · ${new Date().toLocaleString('es-CL')}`;

  el('synapModalBody').innerHTML = `
    <div class="synap-section">
      <div class="synap-section-title" style="color:var(--accent)">★ Recomendación principal</div>
      <div class="synap-notif-preview">
        <div class="synap-notif-header">
          <img src="icon-192.png" alt="" style="width:28px;height:28px;border-radius:8px;object-fit:contain" />
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--muted)">SonqollayAPP</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.3">${esc(best.titulo)}</div>
          </div>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-top:10px;line-height:1.55">${esc(best.mensaje)}</div>
        <div style="font-size:11px;color:var(--indigo);margin-top:10px;font-style:italic">Razón: ${esc(best.razon)}</div>
      </div>
      <button class="new-btn" id="synapUseNotif" style="margin-top:12px;width:100%;justify-content:center">
        Usar esta notificación
      </button>
    </div>

    ${suggestions.length > 1 ? `<div class="synap-section">
      <div class="synap-section-title">Otras sugerencias</div>
      ${suggestions.slice(1).map((s,i)=>`<div class="synap-rec synap-notif-alt" data-titulo="${esc(s.titulo)}" data-msg="${esc(s.mensaje)}" style="animation-delay:${i*0.07}s;cursor:pointer" title="Clic para usar esta">
        <div class="synap-rec-num">${i+2}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:3px">${esc(s.titulo)}</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.4">${esc(s.razon)}</div>
        </div>
      </div>`).join('')}
    </div>` : ''}
  `;

  el('synapModal').style.display = '';

  el('synapUseNotif')?.addEventListener('click', () => {
    const tEl = el('notifTitle');
    const bEl = el('notifBody');
    if (tEl) tEl.value = best.titulo;
    if (bEl) bEl.value = best.mensaje;
    el('synapModal').style.display = 'none';
    showSection('notifications');
    el('previewTitle').textContent = best.titulo;
    el('previewBody').textContent  = best.mensaje;
  });

  el('synapModalBody')?.querySelectorAll('.synap-notif-alt').forEach(row => {
    row.addEventListener('click', () => {
      const tEl = el('notifTitle');
      const bEl = el('notifBody');
      if (tEl) tEl.value = row.dataset.titulo;
      if (bEl) bEl.value = row.dataset.msg;
      el('synapModal').style.display = 'none';
      showSection('notifications');
      if (el('previewTitle')) el('previewTitle').textContent = row.dataset.titulo;
      if (el('previewBody'))  el('previewBody').textContent  = row.dataset.msg;
    });
  });
});

// ── Subscriptions ──
function subscribe() {
  if (unsubSessions) return;

  const sesQ = query(collection(db, 'sessions'), orderBy('startTime', 'desc'), limit(500));
  unsubSessions = onSnapshot(sesQ, async snap => {
    sessions = snap.docs.map(d => d.data());
    const newUids = [...new Set(sessions.map(s => s.uid))].filter(uid => !(uid in userRoles));
    if (newUids.length) {
      await Promise.all(newUids.map(async uid => {
        try {
          const uSnap = await getDoc(doc(db, 'users', uid));
          userRoles[uid]    = uSnap.exists() && uSnap.data().isAdmin === true;
          userApproved[uid] = uSnap.exists() && uSnap.data().approved === true;
        } catch { userRoles[uid] = false; userApproved[uid] = false; }
      }));
    }
    renderAll();
  }, err => { if (err.code === 'permission-denied') showNoAdmin(); });

  const actQ = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(500));
  unsubActivity = onSnapshot(actQ, snap => {
    activity = snap.docs.map(d => d.data());
    renderAll();
  }, snapErr('la actividad'));

  const brdQ = query(collection(db, 'adminBroadcasts'), orderBy('createdAt', 'desc'), limit(50));
  unsubBroadcast = onSnapshot(brdQ, snap => {
    broadcasts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBroadcasts();
  }, snapErr('los avisos'));

  const quotesQ = query(collection(db, 'quotes'), orderBy('createdAt', 'desc'));
  unsubQuotes = onSnapshot(quotesQ, snap => {
    quotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderQuotes();
  }, snapErr('las cotizaciones'));

  const clientsQ = query(collection(db, 'clients'), orderBy('empresa'));
  unsubClients = onSnapshot(clientsQ, snap => {
    clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderClients();
  }, snapErr('los clientes'));

  const notesQ = query(collection(db, 'adminNotes'), orderBy('createdAt', 'desc'));
  unsubNotes = onSnapshot(notesQ, snap => {
    adminNotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNotes();
    renderNotesOverview();
  }, snapErr('los recordatorios'));

  const tplQ = query(collection(db, 'notifTemplates'), orderBy('createdAt', 'desc'));
  unsubNotifTpl = onSnapshot(tplQ, snap => {
    notifTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNotifTemplates();
  }, snapErr('las plantillas'));
}

function unsubscribe() {
  unsubSessions?.();  unsubSessions  = null;
  unsubActivity?.();  unsubActivity  = null;
  unsubBroadcast?.(); unsubBroadcast = null;
  unsubQuotes?.();    unsubQuotes    = null;
  unsubClients?.();   unsubClients   = null;
  unsubNotes?.();     unsubNotes     = null;
  unsubNotifTpl?.();  unsubNotifTpl  = null;
}

// ── Sections ──
const SECTIONS = {
  overview:       'sectionOverview',
  comercial:      'sectionComercial',
  users:          'sectionUsers',
  recordatorios:  'sectionRecordatorios',
  activity:       'sectionActivity',
  notifications:  'sectionNotifications',
  quotes:         'sectionQuotes',
  clients:        'sectionClients',
  academia:       'sectionAcademia',
};
const TITLES = {
  overview:       ['Resumen',        'Vista general de uso de la aplicación'],
  comercial:      ['Comercial',      'Indicadores comerciales y ranking del equipo'],
  users:          ['Usuarios',       'Listado completo de usuarios registrados'],
  recordatorios:  ['Recordatorios',  'Bloc de notas por urgencia para el equipo'],
  activity:       ['Actividad',      'Registro de acciones en tiempo real'],
  notifications:  ['Notificaciones', 'Envía mensajes push a todos los usuarios'],
  quotes:         ['Cotizaciones',   'Gestión de cotizaciones de la empresa'],
  clients:        ['Clientes',       'Gestión de clientes de la empresa'],
  academia:       ['Academia',       'Próximamente — comparte tus sugerencias'],
};

function showSection(name) {
  currentSection = name;
  Object.entries(SECTIONS).forEach(([k, id]) => el(id)?.classList.toggle('active', k === name));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  el('pageTitle').textContent = TITLES[name][0];
  el('pageSub').textContent   = TITLES[name][1];
  if (name === 'comercial') renderComercial();
}

// ── UI gates ──
function showLoading()  { el('loadingGate').style.display='';     el('authGate').style.display='none'; el('noAdminGate').style.display='none'; el('adminPanel').style.display='none'; }
function showAuthGate() { el('loadingGate').style.display='none'; el('authGate').style.display='';     el('noAdminGate').style.display='none'; el('adminPanel').style.display='none'; }
function showNoAdmin()  { el('loadingGate').style.display='none'; el('authGate').style.display='none'; el('noAdminGate').style.display='';     el('adminPanel').style.display='none'; unsubscribe(); }
function showPanel()    { el('loadingGate').style.display='none'; el('authGate').style.display='none'; el('noAdminGate').style.display='none'; el('adminPanel').style.display='flex'; }

// ── Auth ──
onAuthStateChanged(auth, async user => {
  if (!user) { unsubscribe(); showAuthGate(); return; }
  showLoading();
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const isAdm = user.email === OWNER_EMAIL || (snap.exists() && snap.data().isAdmin === true);
    if (!isAdm) { showNoAdmin(); return; }
  } catch (_) { showNoAdmin(); return; }

  const name = user.displayName || user.email || 'Admin';
  el('sidebarName').textContent = name;
  const avatarEl = el('sidebarAvatar');
  if (user.photoURL) avatarEl.innerHTML = `<img src="${esc(user.photoURL)}" alt="" />`;
  else avatarEl.textContent = name[0].toUpperCase();

  showPanel();
  subscribe();
});

// ── Persistencia de sesión ("Mantener sesión iniciada") ──
const KEEP_KEY = 'adm_keepSession';
const wantKeep = () => localStorage.getItem(KEEP_KEY) !== '0'; // default: true
async function applyPersistence() {
  const keep = el('gateKeep') ? el('gateKeep').checked : wantKeep();
  localStorage.setItem(KEEP_KEY, keep ? '1' : '0');
  // local = sobrevive cierres del navegador · session = se cierra al cerrar la pestaña
  await setPersistence(auth, keep ? browserLocalPersistence : browserSessionPersistence);
}
// Estado inicial del checkbox + persistencia según preferencia guardada
if (el('gateKeep')) el('gateKeep').checked = wantKeep();
setPersistence(auth, wantKeep() ? browserLocalPersistence : browserSessionPersistence).catch(() => {});

// ── Events: nav ──
el('gateLoginBtn')?.addEventListener('click', async () => {
  try { await applyPersistence(); } catch (_) {}
  signInWithPopup(auth, gProvider).catch(() => {});
});

el('gateEmailBtn')?.addEventListener('click', async () => {
  const email = el('gateEmail')?.value.trim();
  const pass  = el('gatePassword')?.value;
  const errEl = el('gateErr');
  if (!email || !pass) { errEl.textContent = 'Ingresa correo y contraseña.'; return; }
  errEl.textContent = '';
  const btn = el('gateEmailBtn');
  btn.disabled = true; btn.textContent = 'Ingresando…';
  try {
    await applyPersistence();
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msgs = {
      'auth/user-not-found':   'Usuario no encontrado.',
      'auth/wrong-password':   'Contraseña incorrecta.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    };
    errEl.textContent = msgs[e.code] || e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
  }
});

el('gatePassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') el('gateEmailBtn')?.click();
});
el('gateLogoutBtn')?.addEventListener('click', () => signOut(auth));
el('sidebarLogout')?.addEventListener('click', () => signOut(auth));
document.querySelectorAll('.nav-item[data-section]').forEach(btn =>
  btn.addEventListener('click', () => showSection(btn.dataset.section)));

// ── Events: activity filters ──
el('actSearch')?.addEventListener('input', e => {
  actFilters.search = e.target.value;
  actPage = 0; renderActivity();
});

el('actUserFilter')?.addEventListener('change', e => {
  actFilters.user = e.target.value;
  actPage = 0; renderActivity();
});

el('actDateFrom')?.addEventListener('change', e => {
  actFilters.dateFrom = e.target.value;
  actPage = 0; renderActivity();
});

el('actDateTo')?.addEventListener('change', e => {
  actFilters.dateTo = e.target.value;
  actPage = 0; renderActivity();
});

el('actClearBtn')?.addEventListener('click', () => {
  actFilters.search = ''; actFilters.action = 'all';
  actFilters.user = ''; actFilters.dateFrom = ''; actFilters.dateTo = '';
  actPage = 0;
  el('actSearch').value = '';
  el('actUserFilter').value = '';
  el('actDateFrom').value = '';
  el('actDateTo').value = '';
  document.querySelectorAll('.act-chip').forEach(c => c.classList.toggle('active', c.dataset.action === 'all'));
  renderActivity();
});

el('actChips')?.addEventListener('click', e => {
  const chip = e.target.closest('.act-chip');
  if (!chip) return;
  actFilters.action = chip.dataset.action;
  actPage = 0;
  document.querySelectorAll('.act-chip').forEach(c => c.classList.toggle('active', c === chip));
  renderActivity();
});

// ── Events: notification form ──
const notifTitle = el('notifTitle');
const notifBody  = el('notifBody');

function updatePreview() {
  el('previewTitle').textContent = notifTitle?.value.trim() || 'Título de la notificación';
  el('previewBody').textContent  = notifBody?.value.trim()  || 'El mensaje aparecerá aquí...';
}
notifTitle?.addEventListener('input', updatePreview);
notifBody?.addEventListener('input', updatePreview);

el('sendNotifBtn')?.addEventListener('click', async () => {
  const title = notifTitle?.value.trim();
  if (!title) { setFeedback('Escribe un título para la notificación.', 'var(--warn)'); return; }
  const btn = el('sendNotifBtn');
  btn.disabled = true;
  setFeedback('Enviando...', 'var(--muted)');
  try {
    const user = auth.currentUser;
    const target = el('notifTarget')?.value || 'all';
    const schedVal = el('notifSchedule')?.value; // 'YYYY-MM-DDTHH:mm' (hora local)
    let scheduledFor = null;
    if (schedVal) {
      const d = new Date(schedVal);
      if (isNaN(d.getTime())) { setFeedback('Fecha de programación inválida.', 'var(--danger)'); btn.disabled = false; return; }
      if (d.getTime() <= Date.now()) { setFeedback('La fecha programada debe ser futura.', 'var(--warn)'); btn.disabled = false; return; }
      scheduledFor = d;
    }
    await addDoc(collection(db, 'adminBroadcasts'), {
      title,
      body: notifBody?.value.trim() || '',
      target,
      ...(scheduledFor ? { scheduledFor, status: 'scheduled' } : { status: 'sending' }),
      createdAt: serverTimestamp(),
      sentBy: user?.displayName || user?.email || 'Admin',
    });
    const tgtLabel = target === 'all' ? 'todos' : (el('notifTarget')?.selectedOptions[0]?.textContent || 'usuario');
    setFeedback(
      scheduledFor
        ? `Programada para ${scheduledFor.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · ${tgtLabel}.`
        : `Notificación enviada a ${tgtLabel}. Llega en segundos.`,
      'var(--success)'
    );
    if (notifTitle) notifTitle.value = '';
    if (notifBody)  notifBody.value  = '';
    if (el('notifSchedule')) el('notifSchedule').value = '';
    updatePreview();
  } catch (_) {
    setFeedback('Error al enviar. Verifica los permisos de Firestore.', 'var(--danger)');
  } finally {
    btn.disabled = false;
  }
});

// Pobla el selector de destinatario con los usuarios conocidos (preserva la selección).
function populateNotifTargets(users) {
  const sel = el('notifTarget');
  if (!sel) return;
  const prev = sel.value || 'all';
  const opts = ['<option value="all">Todos los usuarios</option>']
    .concat((users || []).map(u => `<option value="${esc(u.uid)}">${esc(u.displayName || u.email || u.uid.slice(0, 6))}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'all';
}

// ── Pool de plantillas de notificación ──
function renderNotifTemplates() {
  const wrap = el('templatesList');
  if (!wrap) return;
  if (!notifTemplates.length) {
    wrap.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:6px 2px">Aún no guardaste plantillas. Escribí una notificación arriba y tocá «+ Guardar actual».</div>';
    return;
  }
  wrap.innerHTML = notifTemplates.map(t => `
    <div data-tpl-id="${esc(t.id)}" title="Usar esta plantilla"
         style="position:relative;width:230px;max-width:100%;background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s">
      <div style="font-weight:600;font-size:13px;color:var(--text);padding-right:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title || '—')}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px;min-height:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.body || '')}</div>
      <button data-tpl-del="${esc(t.id)}" title="Eliminar plantilla"
              style="position:absolute;top:4px;right:6px;border:none;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer;padding:2px 5px;border-radius:6px">×</button>
    </div>`).join('');
}

// Guardar la notificación actual como plantilla
el('saveTemplateBtn')?.addEventListener('click', async () => {
  const title = notifTitle?.value.trim();
  const body  = notifBody?.value.trim() || '';
  if (!title) { adminToast('Escribí un título antes de guardar la plantilla.', true); return; }
  if (notifTemplates.some(t => (t.title || '') === title && (t.body || '') === body)) {
    adminToast('Esa plantilla ya está guardada.'); return;
  }
  try {
    await addDoc(collection(db, 'notifTemplates'), {
      title, body,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
    });
    adminToast('Plantilla guardada');
  } catch (e) {
    console.error('saveTemplate', e);
    adminToast('No se pudo guardar la plantilla: ' + (e?.message || e), true);
  }
});

// Cargar o eliminar plantillas (delegación)
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-tpl-del]');
  if (del) {
    e.stopPropagation();
    const id = del.dataset.tplDel;
    if (!confirm('¿Eliminar esta plantilla?')) return;
    deleteDoc(doc(db, 'notifTemplates', id))
      .then(() => adminToast('Plantilla eliminada'))
      .catch(err => adminToast('No se pudo eliminar: ' + (err?.message || err), true));
    return;
  }
  const card = e.target.closest('[data-tpl-id]');
  if (!card) return;
  const tpl = notifTemplates.find(t => t.id === card.dataset.tplId);
  if (!tpl) return;
  if (notifTitle) notifTitle.value = tpl.title || '';
  if (notifBody)  notifBody.value  = tpl.body || '';
  updatePreview();
  notifTitle?.focus();
  adminToast('Plantilla cargada · revisá y enviá');
});

function setFeedback(msg, color) {
  const el2 = el('notifFeedback');
  if (el2) { el2.textContent = msg; el2.style.color = color; }
}

// ── Theme toggle ──
function admApplyTheme(light, animate = false) {
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  const label = el('admThemeLabel');
  const pill  = el('admPill');
  const wrap  = el('admThemeWrap');
  if (label) label.textContent = light ? 'Modo claro' : 'Modo oscuro';
  if (pill)  pill.classList.toggle('on', light);
  if (animate && wrap) {
    wrap.classList.add('adm-spin');
    wrap.addEventListener('animationend', () => wrap.classList.remove('adm-spin'), { once: true });
  }
}
(function() {
  admApplyTheme(localStorage.getItem('adm_theme') === 'light', false);
})();
el('admThemeBtn')?.addEventListener('click', () => {
  const light = document.documentElement.getAttribute('data-theme') !== 'light';
  localStorage.setItem('adm_theme', light ? 'light' : 'dark');
  admApplyTheme(light, true);
});

// ── Export CSV/Excel ──
function downloadCSV(filename, headers, rows) {
  const BOM = '﻿';
  const sep = ';';
  const escape = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[;\n\r"]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.map(escape).join(sep), ...rows.map(r => r.map(escape).join(sep))];
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

el('exportClientsBtn')?.addEventListener('click', () => {
  if (!clients.length) { alert('No hay clientes para exportar.'); return; }
  downloadCSV(
    `clientes_${new Date().toISOString().slice(0,10)}.csv`,
    ['Empresa', 'Nombre', 'Email', 'Teléfono', 'Cargo', 'Notas'],
    clients.map(c => [c.empresa, c.nombre, c.email, c.telefono, c.cargo, c.notas])
  );
});

el('exportQuotesBtn')?.addEventListener('click', () => {
  if (!quotes.length) { alert('No hay cotizaciones para exportar.'); return; }
  downloadCSV(
    `cotizaciones_${new Date().toISOString().slice(0,10)}.csv`,
    ['N° Cotización', 'Empresa', 'Fecha', 'Estado', 'Valor', 'Descripción', 'Contactos', 'Seguimiento', 'Notas'],
    quotes.map(q => [
      q.numero, q.empresa, q.fecha, q.estado, q.valor,
      q.descripcion,
      Array.isArray(q.contactos) ? q.contactos.join('; ') : (q.contactos || ''),
      q.seguimiento, q.notas
    ])
  );
});

// ── Activity filters modal ──
el('actFilterBtn')?.addEventListener('click', () => {
  el('actFiltersModal').style.display = '';
  requestAnimationFrame(() => el('actFiltersPanel')?.classList.add('open'));
});
function closeActFiltersModal() {
  el('actFiltersPanel')?.classList.remove('open');
  el('actFiltersPanel')?.addEventListener('transitionend', () => {
    el('actFiltersModal').style.display = 'none';
  }, { once: true });
}
el('actFiltersModal')?.addEventListener('click', e => { if (e.target === el('actFiltersModal')) closeActFiltersModal(); });
el('actFiltersClose')?.addEventListener('click', closeActFiltersModal);
el('actFiltersApply')?.addEventListener('click', () => {
  actFilters.user     = el('mActUserFilter')?.value || '';
  actFilters.dateFrom = el('mActDateFrom')?.value   || '';
  actFilters.dateTo   = el('mActDateTo')?.value     || '';
  const chip = document.querySelector('.m-act-chip.active');
  if (chip) actFilters.action = chip.dataset.action;
  actPage = 0;
  renderActivity();
  closeActFiltersModal();
});
el('actFiltersClear')?.addEventListener('click', () => {
  actFilters.search = ''; actFilters.action = 'all';
  actFilters.user = ''; actFilters.dateFrom = ''; actFilters.dateTo = '';
  actPage = 0;
  ['mActUserFilter','mActDateFrom','mActDateTo'].forEach(id => { if (el(id)) el(id).value = ''; });
  document.querySelectorAll('.m-act-chip').forEach(c => c.classList.toggle('active', c.dataset.action === 'all'));
  renderActivity();
  closeActFiltersModal();
});
el('actFiltersModal')?.addEventListener('click', e => {
  const chip = e.target.closest('.m-act-chip');
  if (chip) {
    document.querySelectorAll('.m-act-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  }
});
