/* Service worker de Firebase Cloud Messaging (notificaciones en segundo plano).
 *
 * CLÁSICO (no «module») usando el SDK compat + importScripts → funciona en TODOS
 * los navegadores, incluido iOS Safari (los SW tipo module no son compatibles ahí).
 *
 * Se registra con scope propio (/firebase-cloud-messaging-push-scope/) para NO
 * pelear con sw.js, que controla el scope raíz «/». Ver setupFcm() en app.js.
 */

// El SDK compat referencia `window` en algunas rutas (p. ej. detección de "firebase ya
// definido"). En un Service Worker `window` no existe (el global es `self`), lo que
// rompía la evaluación con "window is not defined". Apuntamos window → self.
self.window = self;

// tag determinístico → reemplaza notificación previa del mismo recurso (quote/cliente)
// para que no se acumulen varias entradas por la misma cotización editada en ráfaga.
function tagFor(data) {
  if (!data) return 'sonqollay';
  if (data.quoteId)  return `quote-${data.quoteId}`;
  if (data.clientId) return `client-${data.clientId}`;
  return data.kind || 'sonqollay';
}

// data → deep link a usar al hacer click en la notificación
function linkFor(data) {
  if (!data) return './';
  if (data.quoteId)  return `./?q=${encodeURIComponent(data.quoteId)}`;
  if (data.clientId) return `./?c=${encodeURIComponent(data.clientId)}`;
  if (data.kind === 'admin_broadcast' || data.kind === 'follow_up_digest') {
    return './?tab=notifs';
  }
  return './';
}

// SDK alojado en el MISMO origen (vendor/) en vez de gstatic.com.
// importScripts() va directo a la red (no pasa por la caché de sw.js); si la red a
// gstatic falla/está bloqueada, el SW no se evaluaba y las push no se registraban.
// Same-origin es confiable (es el dominio que ya sirve este propio SW).
importScripts('/vendor/firebase-app-compat.js');
importScripts('/vendor/firebase-messaging-compat.js');

// Config pública de Firebase. Mantener en sync con firebase-config.js
firebase.initializeApp({
  apiKey: 'AIzaSyDV1K7GRy_3kAqMgM2tLHGtiCmQQVC5rNY',
  authDomain: 'sonqollayapp.firebaseapp.com',
  projectId: 'sonqollayapp',
  storageBucket: 'sonqollayapp.firebasestorage.app',
  messagingSenderId: '587201086953',
  appId: '1:587201086953:web:a71c37189b882decdb7778',
});

const messaging = firebase.messaging();

// Definir onBackgroundMessage hace que el SDK NO muestre una notificación por su
// cuenta: la mostramos nosotros una sola vez (evita avisos duplicados).
messaging.onBackgroundMessage((payload) => {
  // Mensajes solo-data: título/cuerpo vienen en payload.data (ver sendToAll en functions).
  const d = payload.data || payload.notification || {};
  const title = d.title || 'SonqollayAPP';
  const body = d.body || '';

  self.registration.showNotification(title, {
    body,
    // Rutas absolutas: el SW vive en /firebase-cloud-messaging-push-scope/, así que
    // un './logo.jfif' resolvía a una URL inexistente.
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: d,
    tag: tagFor(d),
    renotify: true,
  });

  // Avisar a las pestañas abiertas para guardar la notificación en el historial local.
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((cs) => {
    cs.forEach((c) => c.postMessage({ type: 'PUSH_RECEIVED', title, body, data: d, timestamp: Date.now() }));
  });
});

// Al tocar la notificación: enfocar una pestaña abierta o abrir la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = linkFor(data);

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si ya hay una pestaña abierta de la app, foco + NAV por postMessage (sin recargar)
    if (wins.length) {
      const win = wins[0];
      await win.focus().catch(() => {});
      win.postMessage({
        type: 'NAV',
        quoteId:  data.quoteId  || null,
        clientId: data.clientId || null,
        tab: (data.kind === 'admin_broadcast' || data.kind === 'follow_up_digest') ? 'notifs' : null,
      });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
