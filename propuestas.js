import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, addDoc, deleteDoc, setDoc, onSnapshot,
  query, orderBy, serverTimestamp, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const OWNER_EMAIL = 'ignaciiio.mate@gmail.com';
const ESTADOS = [
  { k: 'pendiente',   label: 'Pendiente' },
  { k: 'en_progreso', label: 'En progreso' },
  { k: 'agregada',    label: 'Agregada' },
  { k: 'rechazada',   label: 'Rechazada' },
];

const app = initializeApp(firebaseConfig, 'propuestas');
const auth = getAuth(app);
const db = getFirestore(app);
const gProvider = new GoogleAuthProvider();
setPersistence(auth, browserLocalPersistence).catch(() => {});

const el = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currentUser = null;
let isMod = false;
let items = [];
let filter = 'all';
let unsub = null;

let _toastT;
function toast(msg) {
  let t = el('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

function show(view) {
  ['gate', 'noAccess', 'board'].forEach(v => el(v).classList.toggle('hidden', v !== view));
}

// ── Auth ──
onAuthStateChanged(auth, async user => {
  if (!user) { if (unsub) { unsub(); unsub = null; } show('gate'); return; }
  currentUser = user;
  let approved = false;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const d = snap.exists() ? snap.data() : {};
    isMod = user.email === OWNER_EMAIL || d.isAdmin === true;
    approved = isMod || d.approved === true;
  } catch (_) { isMod = user.email === OWNER_EMAIL; approved = isMod; }
  if (!approved) { show('noAccess'); return; }
  el('modPill').classList.toggle('hidden', !isMod);
  show('board');
  subscribe();
});

el('gGoogle').addEventListener('click', () => signInWithPopup(auth, gProvider).catch(e => { el('gateErr').textContent = e.message; }));
el('gEmailBtn').addEventListener('click', async () => {
  const email = el('gEmail').value.trim(), pass = el('gPass').value;
  if (!email || !pass) { el('gateErr').textContent = 'Ingresa correo y contraseña.'; return; }
  el('gateErr').textContent = '';
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) {
    const m = { 'auth/invalid-credential': 'Correo o contraseña incorrectos.', 'auth/wrong-password': 'Contraseña incorrecta.', 'auth/user-not-found': 'Usuario no encontrado.' };
    el('gateErr').textContent = m[e.code] || e.message;
  }
});
el('naLogout').addEventListener('click', () => signOut(auth));

// ── Datos ──
function subscribe() {
  if (unsub) unsub();
  unsub = onSnapshot(query(collection(db, 'propuestas'), orderBy('createdAt', 'desc')), snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => {
    if (err.code === 'permission-denied') show('noAccess');
    else toast('Error al cargar: ' + err.message);
  });
}

el('npSend').addEventListener('click', async () => {
  const titulo = el('npTitle').value.trim();
  const detalle = el('npDetail').value.trim();
  if (titulo.length < 4) { toast('Escribe un título más descriptivo.'); return; }
  const btn = el('npSend'); btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await addDoc(collection(db, 'propuestas'), {
      titulo, detalle,
      autor: currentUser.displayName || currentUser.email || 'Anónimo',
      autorUid: currentUser.uid,
      estado: 'pendiente',
      votos: [currentUser.uid],
      createdAt: serverTimestamp(),
    });
    el('npTitle').value = ''; el('npDetail').value = '';
    toast('¡Propuesta enviada! Gracias 🙌');
  } catch (e) { toast('No se pudo enviar: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Enviar propuesta'; }
});

// ── Acciones ──
async function toggleVote(id) {
  const p = items.find(x => x.id === id); if (!p) return;
  const has = (p.votos || []).includes(currentUser.uid);
  try {
    await setDoc(doc(db, 'propuestas', id), { votos: has ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid) }, { merge: true });
  } catch (e) { toast('No se pudo votar: ' + e.message); }
}
async function setEstado(id, estado) {
  try { await setDoc(doc(db, 'propuestas', id), { estado, resueltoPor: currentUser.email, resueltoEn: serverTimestamp() }, { merge: true }); }
  catch (e) { toast('No se pudo actualizar: ' + e.message); }
}
async function removeItem(id) {
  if (!confirm('¿Eliminar esta propuesta?')) return;
  try { await deleteDoc(doc(db, 'propuestas', id)); toast('Propuesta eliminada'); }
  catch (e) { toast('No se pudo eliminar: ' + e.message); }
}

el('filters').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  filter = c.dataset.f;
  el('filters').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
  render();
});

el('list').addEventListener('click', e => {
  const v = e.target.closest('[data-vote]'); if (v) return toggleVote(v.dataset.vote);
  const m = e.target.closest('[data-set]'); if (m) return setEstado(m.dataset.id, m.dataset.set);
  const d = e.target.closest('[data-del]'); if (d) return removeItem(d.dataset.del);
});

// ── Render ──
function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  if (!d) return '';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
}
function render() {
  const total = items.length;
  const added = items.filter(p => p.estado === 'agregada').length;
  const pend = items.filter(p => (p.estado || 'pendiente') === 'pendiente').length;
  el('stTotal').textContent = total;
  el('stAdded').textContent = added;
  el('stPend').textContent = pend;

  const orderRank = { pendiente: 0, en_progreso: 1, agregada: 2, rechazada: 3 };
  let list = items.slice();
  if (filter !== 'all') list = list.filter(p => (p.estado || 'pendiente') === filter);
  // Orden: por estado (pendientes primero) y dentro de cada uno por votos
  list.sort((a, b) =>
    (orderRank[a.estado || 'pendiente'] - orderRank[b.estado || 'pendiente']) ||
    ((b.votos || []).length - (a.votos || []).length)
  );

  if (!list.length) {
    el('list').innerHTML = '<div class="empty">Sin propuestas todavía. ¡Sé el primero en aportar una idea! 💡</div>';
    return;
  }

  el('list').innerHTML = list.map(p => {
    const estado = p.estado || 'pendiente';
    const label = (ESTADOS.find(e => e.k === estado) || {}).label || estado;
    const votos = (p.votos || []).length;
    const voted = (p.votos || []).includes(currentUser.uid);
    const mine = p.autorUid === currentUser.uid;
    const modRow = isMod
      ? `<div class="mod-row">${ESTADOS.map(e =>
          `<button class="mod-btn${estado === e.k ? ' sel s-' + e.k : ''}" data-set="${e.k}" data-id="${esc(p.id)}">${e.label}</button>`
        ).join('')}<button class="del-btn" data-del="${esc(p.id)}" title="Eliminar">🗑</button></div>`
      : (mine ? `<div class="mod-row"><button class="del-btn" data-del="${esc(p.id)}" style="margin-left:0" title="Eliminar mi propuesta">🗑 Eliminar</button></div>` : '');
    return `<div class="card ${estado === 'agregada' ? 'added' : ''}">
      <div class="card-head">
        <div class="card-title">${estado === 'agregada' ? '✅ ' : ''}${esc(p.titulo)}</div>
        <button class="vote${voted ? ' on' : ''}" data-vote="${esc(p.id)}">👍 ${votos}</button>
      </div>
      ${p.detalle ? `<div class="card-detail">${esc(p.detalle)}</div>` : ''}
      <div class="card-meta">
        <span class="badge b-${estado}">${esc(label)}</span>
        <span>${esc(p.autor || '')}</span>
        ${p.createdAt ? `<span>· ${esc(fmtDate(p.createdAt))}</span>` : ''}
      </div>
      ${modRow}
    </div>`;
  }).join('');
}
