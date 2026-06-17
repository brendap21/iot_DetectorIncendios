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
  var mlResultsBtn = document.getElementById('mlResultsBtn');
  var mlResultsModal = document.getElementById('mlResultsModal');
  var lastCriticalAlertId = null;
  var pushIsEnabled = false;
  var LS_ALERT_FILTERS = 'iot.alertFilters.v1';
  var LS_NOTIF_MENU_OPEN = 'iot.notifMenuOpen.v1';

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

  function saveAlertFilterState() {
    try {
      var state = {
        severity: severityFilter ? severityFilter.value : 'all',
        unreadOnly: Boolean(onlyUnreadAlerts && onlyUnreadAlerts.checked),
      };
      localStorage.setItem(LS_ALERT_FILTERS, JSON.stringify(state));
    } catch (error) {
      console.warn('No se pudo guardar estado de filtros:', error.message);
    }
  }

  function openMlResultsModal() {
    if (!mlResultsModal) {
      return;
    }

    mlResultsModal.classList.add('open');
    mlResultsModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeMlResultsModal() {
    if (!mlResultsModal) {
      return;
    }

    mlResultsModal.classList.remove('open');
    mlResultsModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function setupMlResultsModal() {
    if (!mlResultsBtn || !mlResultsModal) {
      return;
    }

    mlResultsBtn.addEventListener('click', openMlResultsModal);

    mlResultsModal.querySelectorAll('[data-ml-close]').forEach(function (element) {
      element.addEventListener('click', closeMlResultsModal);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && mlResultsModal.classList.contains('open')) {
        closeMlResultsModal();
      }
    });
  }

  function restoreAlertFilterState() {
    try {
      var raw = localStorage.getItem(LS_ALERT_FILTERS);
      if (!raw) return;

      var state = JSON.parse(raw);
      if (severityFilter && state && typeof state.severity === 'string') {
        severityFilter.value = state.severity;
      }
      if (onlyUnreadAlerts && state && typeof state.unreadOnly === 'boolean') {
        onlyUnreadAlerts.checked = state.unreadOnly;
      }
    } catch (error) {
      console.warn('No se pudo restaurar estado de filtros:', error.message);
    }
  }

  function persistNotifMenuState(isOpen) {
    try {
      localStorage.setItem(LS_NOTIF_MENU_OPEN, isOpen ? '1' : '0');
    } catch (error) {
      console.warn('No se pudo guardar estado del panel:', error.message);
    }
  }

  function restoreNotifMenuState() {
    try {
      if (!navbarNotifMenu) return;
      var val = localStorage.getItem(LS_NOTIF_MENU_OPEN);
      if (val === '1') {
        navbarNotifMenu.classList.add('open');
      }
    } catch (error) {
      console.warn('No se pudo restaurar panel:', error.message);
    }
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

    await syncPushUiState();
  }

  async function syncPushUiState() {
    var supported = ('serviceWorker' in navigator) && ('PushManager' in window);
    var granted = window.Notification && Notification.permission === 'granted';
    var hasSubscription = false;

    if (supported && granted) {
      try {
        var reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          var sub = await reg.pushManager.getSubscription();
          hasSubscription = Boolean(sub);
        }
      } catch (error) {
        console.warn('No se pudo consultar subscripcion push:', error.message);
      }
    }

    pushIsEnabled = Boolean(supported && granted && hasSubscription);

    if (!pushBtn) {
      return pushIsEnabled;
    }

    if (!supported) {
      pushBtn.style.display = 'inline-flex';
      pushBtn.textContent = 'Notificaciones no disponibles';
      pushBtn.disabled = true;
      return false;
    }

    if (!granted || !hasSubscription) {
      pushBtn.style.display = 'inline-flex';
      pushBtn.textContent = 'Activar notificaciones';
      pushBtn.disabled = false;

      if (notifStatus) {
        notifStatus.textContent = 'Las notificaciones estan desactivadas en este dispositivo.';
      }

      return false;
    }

    // Ya activadas: no mostramos boton principal para que la UI sea limpia.
    pushBtn.style.display = 'none';
    pushBtn.disabled = true;
    pushBtn.textContent = 'Notificaciones activadas';

    if (notifStatus) {
      notifStatus.textContent = 'Push activo en este dispositivo';
    }

    return true;
  }

  async function checkPushAvailability() {
    try {
      var data = await fetchJson('/api/alertas/public-key');

      if (data && data.publicKey) {
        await syncPushUiState();
        return true;
      }
    } catch (error) {
      if (pushBtn) {
        pushBtn.style.display = 'inline-flex';
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

        // Si el usuario abre el panel sin push activo, mostramos CTA para activarlo.
        if (pushBtn && navbarNotifMenu.classList.contains('open') && !pushIsEnabled) {
          pushBtn.style.display = 'inline-flex';
        }

        persistNotifMenuState(navbarNotifMenu.classList.contains('open'));
      });

      document.addEventListener('click', function (event) {
        if (!navbarNotifMenu.classList.contains('open')) {
          return;
        }

        var clickedBell = notifBellBtn.contains(event.target);
        var clickedMenu = navbarNotifMenu.contains(event.target);

        if (!clickedBell && !clickedMenu) {
          navbarNotifMenu.classList.remove('open');
          persistNotifMenuState(false);
        }
      });
    }
  }

  function setupInstallPrompt() {
    if (!installBtn) {
      return;
    }

    // Mantenemos visible el boton de instalacion en movil para que el usuario
    // tenga una accion clara incluso si beforeinstallprompt no dispara.
    installBtn.style.display = 'inline-flex';
    installBtn.disabled = true;

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      installPromptEvent = event;
      installBtn.disabled = false;
    });

    window.addEventListener('appinstalled', function () {
      installBtn.style.display = 'none';
      installBtn.disabled = true;
    });

    installBtn.addEventListener('click', async function () {
      if (!installPromptEvent) {
        alert('Para instalar en movil: abre menu del navegador y elige "Agregar a pantalla de inicio".');
        return;
      }

      installPromptEvent.prompt();
      await installPromptEvent.userChoice;
      installPromptEvent = null;
      installBtn.disabled = true;
      installBtn.style.display = 'none';
    });
  }

  async function refreshDashboard() {
    try {
      console.debug('[pwa-client] refreshDashboard: llamando a /api/sensores/ultimas');
      var response = await fetch('/api/sensores/ultimas?limit=20', { cache: 'no-store' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error cargando lecturas');

      var lastReading = data && data.length > 0 ? data[0] : null;
      if (lastReading) {
        var cardLlamaValue = document.getElementById('cardLlamaValue');
        var cardGasValue = document.getElementById('cardGasValue');
        var cardMovimientoValue = document.getElementById('cardMovimientoValue');
        var cardCountValue = document.getElementById('cardCountValue');
        var interpretationBlock = document.getElementById('interpretationBlock');
        var lastUpdatedTime = document.getElementById('lastUpdatedTime');

        if (cardLlamaValue) cardLlamaValue.textContent = (lastReading.llama || 0) + '';
        if (cardGasValue) cardGasValue.textContent = (lastReading.gas || 0) + ' ppm';
        if (cardMovimientoValue) cardMovimientoValue.textContent = (lastReading.movimiento || 0) + '';
        if (cardCountValue) cardCountValue.textContent = (data.length || 0) + '';
        if (interpretationBlock && lastReading.riesgo) {
          interpretationBlock.textContent = interpretarEstado(lastReading.riesgo);
        }
        if (lastUpdatedTime) {
          var now = new Date();
          lastUpdatedTime.textContent = now.toLocaleTimeString('es-ES');
        }
      }

      var labels = data.map(function (r) { return new Date(r.timestamp).toLocaleTimeString('es-ES'); }).reverse();
      var gasValues = data.map(function (r) { return r.gas || 0; }).reverse();
      var riesgoValues = data.map(function (r) { return r.riesgo ? (r.riesgo.includes('ALTO') ? 3 : r.riesgo.includes('MEDIO') ? 2 : 1) : 1; }).reverse();

      if (typeof window.updateGasChart === 'function') {
        window.updateGasChart(labels, gasValues, riesgoValues);
      }
      console.debug('[pwa-client] refreshDashboard: actualizado OK');

    } catch (error) {
      console.warn('No se pudo actualizar dashboard:', error.message);
    }
  }

  function interpretarEstado(riesgo) {
    if (!riesgo) return 'Desconocido';
    if (riesgo.includes('CRÍTICO') || riesgo.includes('CRITICO')) return '🔴 CRÍTICO';
    if (riesgo.includes('ALTO')) return '🟠 ALTO RIESGO';
    if (riesgo.includes('MEDIO')) return '🟡 RIESGO MODERADO';
    return '🟢 BAJO RIESGO';
  }

  async function init() {
    setupInstallPrompt();
    setupNavbarNotifications();
    setupMlResultsModal();
    restoreAlertFilterState();
    restoreNotifMenuState();

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (error) {
        console.warn('No se pudo registrar service worker:', error.message);
      }
    }

    await checkPushAvailability();
    await syncPushUiState();

    if (pushBtn) {
      pushBtn.addEventListener('click', function () {
        registerPush().catch(function (error) {
          alert('No fue posible activar notificaciones: ' + error.message);
        });
      });
    }

    if (severityFilter) {
      severityFilter.addEventListener('change', function () {
        saveAlertFilterState();
        refreshAlerts().catch(function () { return null; });
      });
    }

    if (onlyUnreadAlerts) {
      onlyUnreadAlerts.addEventListener('change', function () {
        saveAlertFilterState();
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

    // Actualizamos el dashboard inmediatamente al iniciar.
    try { await refreshDashboard(); } catch (e) { console.warn('refreshDashboard inicial fallo', e && e.message ? e.message : e); }

    // Refrescar cuando la pestaña vuelve a tener foco o cambia visibilidad.
    window.addEventListener('focus', function () { refreshDashboard().catch(function () { return null; }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshDashboard().catch(function () { return null; }); });

    // Polling constante cada 10 segundos para que el dashboard se actualice sin reload.
    setInterval(function () { refreshDashboard().catch(function () { return null; }); }, 10000);

    await refreshAlerts();
    setInterval(refreshAlerts, 15000);
  }

  init().catch(function (error) {
    console.error('Error inicializando cliente PWA:', error);
  });
}());
