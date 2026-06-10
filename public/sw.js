self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

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
  var isCritical = data.severity === 'critical';
  var defaultVibration = isCritical ? [300, 150, 300, 150, 700] : [120];

  var options = {
    body: data.body || 'Se detecto un nuevo evento.',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: isCritical ? 'critical-fire-alert' : (data.tag || 'iot-alert'),
    renotify: isCritical ? true : (data.renotify === true),
    requireInteraction: isCritical ? true : (data.requireInteraction === true),
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : defaultVibration,
    data: {
      url: data.url || '/resultados',
      severity: data.severity || 'medium',
      lecturaId: data.data && data.data.lecturaId ? data.data.lecturaId : null,
    },
    actions: isCritical
      ? [
        { action: 'open', title: 'Abrir monitoreo' },
        { action: 'dismiss', title: 'Cerrar' },
      ]
      : [],
  };

  event.waitUntil((async function () {
    await self.registration.showNotification(title, options);

    if (isCritical) {
      var clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientsList.forEach(function (client) {
        client.postMessage({ type: 'critical-alert' });
      });

      // Segundo pulso para incrementar visibilidad cuando la primera alerta
      // se pierde entre notificaciones del sistema.
      await delay(2500);
      await self.registration.showNotification('ALERTA URGENTE', {
        body: data.body || 'Posible incendio detectado. Revisa el monitoreo ahora.',
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        tag: 'critical-fire-alert-repeat',
        renotify: true,
        requireInteraction: true,
        vibrate: [500, 200, 500, 200, 900],
        data: options.data,
      });
    }
  }()));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  var url = '/resultados';
  if (event.notification && event.notification.data && event.notification.data.url) {
    url = event.notification.data.url;
  }

  event.waitUntil(clients.openWindow(url));
});
