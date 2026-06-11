// Service worker de la app (cache de shell para offline).
// El SW de FCM es ./firebase-messaging-sw.js (registrado aparte).
const CACHE = 'sonqollay-v40';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './lib/format.js',
  './lib/seed-data.js',
  './lib/indicadores.js',
  './lib/tour.js',
  './lib/quote-pdf.js',
  './lib/empresa-config.js',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './firebase-config.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // cache: 'reload' fuerza fetch desde red, ignorando la HTTP cache del browser.
      // Tolerante: un asset que falle (404) no debe romper toda la instalación del SW.
      Promise.all(ASSETS.map(url =>
        c.add(new Request(url, { cache: 'reload' })).catch(err => console.warn('precache miss', url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      const old = keys.filter(k => k !== CACHE);
      return Promise.all(old.map(k => caches.delete(k))).then(() => {
        if (old.length > 0) {
          return self.clients.matchAll({ type: 'window' })
            .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })));
        }
      });
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Caché dinámico de Firebase SDK (gstatic.com) para soporte offline resiliente
  if (url.hostname.endsWith('gstatic.com') && url.pathname.includes('/firebasejs/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        });
        return cached || network;
      })
    );
    return;
  }

  // No interceptar requests a Firebase / Google APIs ni al SDK
  if (
    url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('gstatic.com') ||
    url.hostname.endsWith('firebaseio.com') ||
    url.hostname.endsWith('firebase.googleapis.com')
  ) return;

  // index.html: network-first para que el deploy llegue siempre
  if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto: cache-first (offline funciona), actualiza cache en background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      });
      return cached || network;
    })
  );
});
