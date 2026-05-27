// Service worker para Firebase Cloud Messaging (background notifications).
// Debe estar en la raíz del sitio para que FCM lo encuentre.
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
importScripts('./firebase-config-compat.js');

firebase.initializeApp(self.firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'SonqollayAPP';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: './icon.svg',
    badge: './icon.svg',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./'));
});
