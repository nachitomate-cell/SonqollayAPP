import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app  = initializeApp(firebaseConfig, 'superadmin');
const auth = getAuth(app);
const db   = getFirestore(app);
const gProvider = new GoogleAuthProvider();

const el  = id => document.getElementById(id);
const esc = s  => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let currentUser = null;
let updateCount = 0;
let unsubVersion = null;

// ── Toast ──
let _toastTimer;
function showToast(msg) {
  const t = el('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Auth gate ──
el('signInBtn').addEventListener('click', async () => {
  el('authErr').textContent = '';
  try {
    await signInWithPopup(auth, gProvider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, gProvider);
    } else {
      el('authErr').textContent = e.message;
    }
  }
});

// Capturar resultado de redirect si volvemos de Google
getRedirectResult(auth).catch(() => {});

el('signOutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
  if (!user) {
    currentUser = null;
    el('authGate').style.display = '';
    el('appShell').style.display = 'none';
    if (unsubVersion) { unsubVersion(); unsubVersion = null; }
    return;
  }

  // Verificar que sea admin (propietario o flag isAdmin en Firestore)
  const snap = await getDoc(doc(db, 'users', user.uid)).catch(() => null);
  const OWNER_EMAIL = 'ignaciiio.mate@gmail.com';
  const isAdmin = user.email === OWNER_EMAIL || (snap?.exists() && snap.data().isAdmin === true);
  if (!isAdmin) {
    el('authErr').textContent = 'Acceso denegado: se requiere rol de administrador.';
    el('authGate').style.display = '';
    el('appShell').style.display = 'none';
    await signOut(auth);
    return;
  }

  currentUser = user;
  el('authGate').style.display = 'none';
  el('appShell').style.display = 'flex';

  initNav();
  setupVersionListener();
  loadStats();
  loadTokens();
});

// ── Nav ──
function initNav() {
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sec = btn.dataset.section;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      el('sec-' + sec)?.classList.add('active');
      if (sec === 'tokens') loadTokens();
    });
  });
}

// ── Version listener ──
function setupVersionListener() {
  if (unsubVersion) return;
  unsubVersion = onSnapshot(doc(db, 'config', 'appVersion'), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    updateCount = data.count || 0;
    el('statUpdates').textContent = updateCount;
    const ts = data.updatedAt?.toDate?.();
    el('lastUpdateLabel').textContent = ts
      ? `Última actualización: ${timeAgo(ts)} por ${esc(data.updatedBy || '—')}`
      : 'Última actualización: —';
  }, err => console.error('appVersion listener', err));
}

// ── Force update ──
el('forceUpdateBtn').addEventListener('click', async () => {
  const btn = el('forceUpdateBtn');
  const res = el('updateResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando…';
  res.className = 'update-result';

  try {
    const v = Date.now();
    await setDoc(doc(db, 'config', 'appVersion'), {
      v,
      count: updateCount + 1,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.displayName || currentUser.email,
    });
    res.textContent = 'Señal enviada. Todos los usuarios actualizarán al recargar.';
    res.className = 'update-result ok';
    showToast('Actualización forzada enviada');
  } catch (e) {
    res.textContent = 'Error: ' + e.message;
    res.className = 'update-result err';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Forzar actualización`;
  }
});

// ── Stats ──
async function loadStats() {
  try {
    // Usuarios únicos
    const usersSnap = await getDocs(collection(db, 'users'));
    el('statTotalUsers').textContent = usersSnap.size;

    // Online (sesiones sin endTime)
    const sesSnap = await getDocs(query(collection(db, 'sessions'), orderBy('startTime', 'desc'), limit(200)));
    const onlineUids = new Set();
    sesSnap.docs.forEach(d => { if (d.data().endTime === null) onlineUids.add(d.data().uid); });
    el('statOnline').textContent = onlineUids.size;

    // Total tokens FCM (lecturas en paralelo, no N+1 secuencial)
    const tokenCounts = await Promise.all(
      usersSnap.docs.map(d => getDocs(collection(db, 'users', d.id, 'fcmTokens')).then(s => s.size))
    );
    el('statTokens').textContent = tokenCounts.reduce((a, b) => a + b, 0);
  } catch (e) {
    console.error('loadStats', e);
    showToast('Error cargando estadísticas');
  }
}

// ── Token table ──
el('refreshTokensBtn').addEventListener('click', loadTokens);

async function loadTokens() {
  const wrap = el('tokenTableWrap');
  wrap.innerHTML = '<div style="padding:32px;text-align:center"><div class="spinner"></div></div>';

  try {
    const usersSnap = await getDocs(collection(db, 'users'));

    // Lecturas de tokens en paralelo (antes: un getDocs secuencial por usuario)
    const rows = await Promise.all(usersSnap.docs.map(async userDoc => {
      const u = userDoc.data();
      const tokSnap = await getDocs(collection(db, 'users', userDoc.id, 'fcmTokens'));
      return { uid: userDoc.id, ...u, tokens: tokSnap.docs.map(d => d.data()) };
    }));

    rows.sort((a, b) => (b.tokens.length - a.tokens.length) || (a.displayName || '').localeCompare(b.displayName || ''));

    if (!rows.length) {
      wrap.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">Sin usuarios registrados.</div>';
      return;
    }

    const rowsHtml = rows.map(u => {
      const init = (u.displayName || u.email || '?').trim()[0].toUpperCase();
      const avatar = u.photoURL
        ? `<div class="u-avatar"><img src="${esc(u.photoURL)}" alt="" /></div>`
        : `<div class="u-avatar">${esc(init)}</div>`;

      const badgeCls = u.tokens.length === 0 ? 'badge-none'
        : u.tokens.length === 1 ? 'badge-ok' : 'badge-multi';
      const badgeTxt = u.tokens.length === 0 ? 'Sin token'
        : u.tokens.length === 1 ? '1 token' : `${u.tokens.length} tokens`;

      const deviceRows = u.tokens.length === 0
        ? `<tr><td colspan="4" style="padding:10px 12px;color:var(--muted);font-size:12px;border-top:1px solid var(--border)">Sin tokens registrados</td></tr>`
        : u.tokens.map(t => {
            const ua = t.ua || '—';
            const isIOS     = /iPhone|iPad/.test(ua);
            const isAndroid = /Android/.test(ua);
            const isMac     = /Macintosh/.test(ua);
            const deviceIcon = isIOS ? '📱' : isAndroid ? '🤖' : isMac ? '💻' : '🖥';
            const ts = t.createdAt?.toDate?.();
            const ago = ts ? timeAgo(ts) : '—';
            const shortToken = t.token ? t.token.slice(0, 24) + '…' : '—';
            return `<tr>
              <td></td>
              <td><span class="device-ua" title="${esc(ua)}">${deviceIcon} ${esc(ua.slice(0, 60))}</span></td>
              <td><span class="token-mono" title="${esc(t.token)}">${esc(shortToken)}</span></td>
              <td style="font-size:12px;color:var(--muted)">${esc(ago)}</td>
            </tr>`;
          }).join('');

      return `<tr>
        <td>
          <div class="u-ident">
            ${avatar}
            <div>
              <div class="u-name">${esc(u.displayName || '—')}</div>
              <div class="u-email">${esc(u.email || '—')}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${badgeCls}">${esc(badgeTxt)}</span></td>
        <td></td>
        <td></td>
      </tr>${deviceRows}`;
    }).join('');

    wrap.innerHTML = `<table class="token-table">
      <thead><tr>
        <th>Usuario</th>
        <th>Tokens</th>
        <th>Dispositivo</th>
        <th>Registrado</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  } catch (e) {
    wrap.innerHTML = `<div style="padding:24px;color:var(--danger);font-size:13px">Error cargando tokens: ${esc(e.message)}</div>`;
  }
}

// ── Enviar notificación ──
el('sendNotifBtn').addEventListener('click', async () => {
  const title = el('notifTitle').value.trim();
  const body  = el('notifBody').value.trim();
  const res   = el('notifResult');

  if (!title) {
    res.style.color = 'var(--danger)';
    res.textContent = 'El título es obligatorio.';
    return;
  }

  const btn = el('sendNotifBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando…';
  res.textContent = '';

  try {
    await addDoc(collection(db, 'adminBroadcasts'), {
      title,
      body,
      createdAt: serverTimestamp(),
      createdBy: currentUser.displayName || currentUser.email,
    });
    res.style.color = 'var(--success)';
    res.textContent = 'Notificación enviada a todos los usuarios.';
    el('notifTitle').value = '';
    el('notifBody').value = '';
    showToast('Notificación enviada');
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Enviar a todos';
  }
});

// ── Helpers ──
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
