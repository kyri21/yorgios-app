importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyANChz23_TbsdX6LE3jzWtBOAjoy7Pp4a0",
  authDomain:        "cuisine-yorgios.firebaseapp.com",
  projectId:         "cuisine-yorgios",
  storageBucket:     "cuisine-yorgios.firebasestorage.app",
  messagingSenderId: "25731625658",
  appId:             "1:25731625658:web:5c1cc04e4530a7a161c883",
});

const messaging = firebase.messaging();

// Message reçu en background → notification push système
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Matias', {
    body: body || '',
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data,
    vibrate: [200, 100, 200],
    tag: 'matias-msg',
    renotify: true,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/messages');
    })
  );
});
