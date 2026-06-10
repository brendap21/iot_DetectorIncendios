(function () {
  'use strict';

  var installPromptEvent = null;
  var installBtn = document.getElementById('installAppBtn');
  var pushBtn = document.getElementById('navbarEnablePushBtn');
  var alertsList = document.getElementById('alertsList');
  var navbarNotifList = document.getElementById('navbarNotifList');
  var notifBellBtn = document.getElementById('notifBellBtn');
  var notifBadge = document.getElementById('notifBadge');
  var navbarNotifMenu = document.getElementById('navbarNotifMenu');
  var notifStatus = document.getElementById('notifStatus');
  var severityFilter = document.getElementById('severityFilter');
  var onlyUnreadAlerts = document.getElementById('onlyUnreadAlerts');
  var lastCriticalAlertId = null;

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  async function fetchJson(url, options) {
    var response = await fetch(url, options);
    var data = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      throw new Error(data.error || ('HTTP ' + response.status));
    }

    return data;
  }

  function playCriticalTone() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return;
      }

      var ctx = new AudioCtx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);

      osc.start();
      osc.stop(ctx.currentTime + 0.36);

      setTimeout(function () {
        ctx.close().catch(function () { return null; });
      }, 450);
    } catch (error) {
      console.warn('No se pudo reproducir tono de alerta:', error.message);
    }
  }

  function buildAlertsQuery() {
    var query = ['limit=20'];

    if (severityFilter && severityFilter.value && severityFilter.value !== 'all') {
      query.push('severidad=' + encodeURIComponent(severityFilter.value));
    }

    if (onlyUnreadAlerts && onlyUnreadAlerts.checked) {
      query.push('leida=false');
    }

    return '/api/alertas/ultimas?' + query.join('&');
  }

  async function marcarLeida(alertaId) {
    if (!alertaId) {
      return;
    }

    await fetchJson('/api/alertas/' + encodeURIComponent(alertaId) + '/leida', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });

    await refreshAlerts();
  }

  function setNotifBadge(items) {
    if (!notifBadge) {
      return;
    }

    var unread = Array.isArray(items)
      ? items.filter(function (a) { return a && a.leida !== true; }).length
      : 0;

    notifBadge.textContent = String(unread);
    notifBadge.style.display = unread > 0 ? 'inline-flex' : 'none';
  }

  function bindReadButtons(root) {
    if (!root) {
      return;
    }

    var readButtons = root.querySelectorAll('.btn-mark-read[data-alert-id]');
    readButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var alertId = btn.getAttribute('data-alert-id');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        marcarLeida(alertId).catch(function (error) {
          alert('No se pudo marcar la alerta: ' + error.message);
          btn.disabled = false;
          btn.textContent = 'Marcar leida';
        });
      });
    });
  }

  function renderAlertItems(items, compact) {
    if (!Array.isArray(items) || items.length === 0) {
      return '<li><strong>Sin alertas nuevas</strong><div class="meta">Cuando ocurra un evento critico aparecera aqui.</div></li>';
    }

    return items.map(function (a) {
      var sev = a.severidad || 'medium';
      var fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Sin fecha';
      var estado = a.leida ? 'Leida' : 'No leida';
      var estadoClass = a.leida ? 'badge-state read' : 'badge-state';
      var btn = a.leida
        ? '<button class="btn-mark-read" disabled>Leida</button>'
        : '<button class="btn-mark-read" data-alert-id="' + a.id + '">Marcar leida</button>';
      var compactStyle = compact ? ' style="margin-bottom:2px;"' : '';

      return '<li class="' + sev + '">' +
        '<div class="alert-top"' + compactStyle + '><strong>' + (a.titulo || 'Alerta') + '</strong><span class="' + estadoClass + '">' + estado + '</span>' + btn + '</div>' +
        '<div>' + (a.mensaje || '') + '</div>' +
        '<div class="meta">' + fecha + ' · ' + (a.tipo || '-') + '</div>' +
      '</li>';
    }).join('');
  }

  function renderAlerts(items) {
    if (alertsList) {
      alertsList.innerHTML = renderAlertItems(items, false);
      bindReadButtons(alertsList);
    }

    if (navbarNotifList) {
      navbarNotifList.innerHTML = renderAlertItems(items, true);
      bindReadButtons(navbarNotifList);
    }

    setNotifBadge(items);
  }

  async function refreshAlerts() {
    try {
      var data = await fetchJson(buildAlertsQuery());
      var alertas = data.alertas || [];

      var critical = alertas.find(function (a) {
        return a.severidad === 'critical' && a.leida !== true;
      });

      if (critical && critical.id && critical.id !== lastCriticalAlertId) {
        playCriticalTone();
        lastCriticalAlertId = critical.id;
      }

      renderAlerts(alertas);

      if (notifStatus) {
        notifStatus.textContent = alertas.length > 0
          ? 'Tienes ' + alertas.length + ' alertas recientes'
          : 'Sin alertas nuevas';
      }
    } catch (error) {
      console.warn('No se pudieron cargar alertas:', error.message);
      if (notifStatus) {
        notifStatus.textContent = 'No se pudieron cargar notificaciones';
      }
    }
  }

  async function registerPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Este navegador no soporta notificaciones push.');
      return;
    }

    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Permiso de notificaciones no concedido.');
      return;
    }

    var swReg = await navigator.serviceWorker.register('/sw.js');

    var keyData = await fetchJson('/api/alertas/public-key');
    var appServerKey = urlBase64ToUint8Array(keyData.publicKey);

    var existing = await swReg.pushManager.getSubscription();
    var subscription = existing || await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });

    await fetchJson('/api/alertas/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription }),
    });

    if (pushBtn) {
      pushBtn.textContent = 'Notificaciones activadas';
      pushBtn.disabled = true;
    }

    if (notifStatus) {
      notifStatus.textContent = 'Push activo en este dispositivo';
    }
  }

  async function checkPushAvailability() {
    try {
      var data = await fetchJson('/api/alertas/public-key');

      if (data && data.publicKey) {
        if (notifStatus) {
          notifStatus.textContent = 'Push disponible. Activalo en este dispositivo.';
        }
        return true;
      }
    } catch (error) {
      if (pushBtn) {
        pushBtn.textContent = 'Notificaciones no disponibles';
        pushBtn.disabled = true;
      }
      if (notifStatus) {
        notifStatus.textContent = 'Push deshabilitado en servidor (faltan llaves VAPID).';
      }
      return false;
    }

    return false;
  }

  function setupNavbarNotifications() {
    if (notifBellBtn && navbarNotifMenu) {
      notifBellBtn.addEventListener('click', function () {
        navbarNotifMenu.classList.toggle('open');
      });

      document.addEventListener('click', function (event) {
        if (!navbarNotifMenu.classList.contains('open')) {
          return;
        }

        var clickedBell = notifBellBtn.contains(event.target);
        var clickedMenu = navbarNotifMenu.contains(event.target);

        if (!clickedBell && !clickedMenu) {
          navbarNotifMenu.classList.remove('open');
        }
      });
    }
  }

  function setupInstallPrompt() {
    if (!installBtn) {
      return;
    }

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      installPromptEvent = event;
      installBtn.disabled = false;
    });

    installBtn.addEventListener('click', async function () {
      if (!installPromptEvent) {
        return;
      }

      installPromptEvent.prompt();
      await installPromptEvent.userChoice;
      installPromptEvent = null;
      installBtn.disabled = true;
    });
  }

  async function init() {
    setupInstallPrompt();
    setupNavbarNotifications();

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (error) {
        console.warn('No se pudo registrar service worker:', error.message);
      }
    }

    await checkPushAvailability();

    if (pushBtn) {
      pushBtn.addEventListener('click', function () {
        registerPush().catch(function (error) {
          alert('No fue posible activar notificaciones: ' + error.message);
        });
      });
    }

    if (severityFilter) {
      severityFilter.addEventListener('change', function () {
        refreshAlerts().catch(function () { return null; });
      });
    }

    if (onlyUnreadAlerts) {
      onlyUnreadAlerts.addEventListener('change', function () {
        refreshAlerts().catch(function () { return null; });
      });
    }

    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        if (event && event.data && event.data.type === 'critical-alert') {
          playCriticalTone();
        }
      });
    }

    await refreshAlerts();
    setInterval(refreshAlerts, 15000);
  }

  init().catch(function (error) {
    console.error('Error inicializando cliente PWA:', error);
  });
}());
