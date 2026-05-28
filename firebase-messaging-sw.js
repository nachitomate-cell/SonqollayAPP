// Service worker para Firebase Cloud Messaging (background notifications).
// Debe estar en la raíz del sitio para que FCM lo encuentre.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getMessaging, onBackgroundMessage } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-sw.js';
import { firebaseConfig } from './firebase-config.js';

try {
  const app = initializeApp(firebaseConfig);

  const messaging = getMessaging(app);

  onBackgroundMessage(messaging, (payload) => {
    const title = (payload.notification && payload.notification.title) || 'SonqollayAPP';
    const options = {
      body: (payload.notification && payload.notification.body) || '',
      icon: './logo.png',
      badge: './logo.png',
      data: payload.data || {},
    };
    self.registration.showNotification(title, options);
  });
} catch (e) {
  console.warn('Firebase messaging SW init failed:', e);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./'));
});
