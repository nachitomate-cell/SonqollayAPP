/* Service worker de Firebase Cloud Messaging (notificaciones en segundo plano).
 *
 * CLÁSICO (no «module») usando el SDK compat + importScripts → funciona en TODOS
 * los navegadores, incluido iOS Safari (los SW tipo module no son compatibles ahí).
 *
 * Se registra con scope propio (/firebase-cloud-messaging-push-scope/) para NO
 * pelear con sw.js, que controla el scope raíz «/». Ver setupFcm() en app.js.
 */

importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

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
  const n = payload.notification || {};
  const title = n.title || 'SonqollayAPP';
  const body = n.body || '';

  self.registration.showNotification(title, {
    body,
    icon: './logo.jfif',
    badge: './logo.jfif',
    data: payload.data || {},
  });

  // Avisar a las pestañas abiertas para guardar la notificación en el historial local.
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((cs) => {
    cs.forEach((c) => c.postMessage({ type: 'PUSH_RECEIVED', title, body, timestamp: Date.now() }));
  });
});

// Al tocar la notificación: enfocar una pestaña abierta o abrir la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
