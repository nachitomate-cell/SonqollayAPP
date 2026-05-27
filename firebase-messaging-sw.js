// Service worker para Firebase Cloud Messaging (background notifications).
// Debe estar en la raíz del sitio para que FCM lo encuentre.
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

try {
  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey: "AIzaSyDV1K7GRy_3kAqMgM2tLHGtiCmQQVC5rNY",
      authDomain: "sonqollayapp.firebaseapp.com",
      projectId: "sonqollayapp",
      storageBucket: "sonqollayapp.firebasestorage.app",
      messagingSenderId: "587201086953",
      appId: "1:587201086953:web:a71c37189b882decdb7778"
    });
  }

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
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
