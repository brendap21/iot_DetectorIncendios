self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  if (!event.data) {
    return;
  }

  var data = {};
  try {
    data = event.data.json();
  } catch (error) {
    data = { title: 'Alerta IoT', body: event.data.text() };
  }

  var title = data.title || 'Alerta IoT';
  var options = {
    body: data.body || 'Se detecto un nuevo evento.',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: data.tag || 'iot-alert',
    renotify: data.renotify === true,
    requireInteraction: data.requireInteraction === true,
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : [120],
    data: {
      url: data.url || '/resultados',
      severity: data.severity || 'medium',
      lecturaId: data.data && data.data.lecturaId ? data.data.lecturaId : null,
    },
  };

  event.waitUntil((async function () {
    await self.registration.showNotification(title, options);

    if (data.severity === 'critical') {
      var clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientsList.forEach(function (client) {
        client.postMessage({ type: 'critical-alert' });
      });
    }
  }()));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var url = '/resultados';
  if (event.notification && event.notification.data && event.notification.data.url) {
    url = event.notification.data.url;
  }

  event.waitUntil(clients.openWindow(url));
});
