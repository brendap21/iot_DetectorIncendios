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
  var mlSummaryGrid = document.getElementById('mlSummaryGrid');
  var mlConfusionGrid = document.getElementById('mlConfusionGrid');
  var mlValidationStatus = document.getElementById('mlValidationStatus');
  var mlValidationList = document.getElementById('mlValidationList');
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
    refreshMlEvaluation().catch(function (error) {
      if (mlValidationStatus) {
        mlValidationStatus.textContent = 'No se pudo cargar la evaluacion: ' + error.message;
      }
    });
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

  function formatPercent(value) {
    return typeof value === 'number' ? Math.round(value * 1000) / 10 + '%' : 'Sin datos';
  }

  function renderMetricCard(label, value, description) {
    return '<article>' +
      '<span class="ml-label">' + label + '</span>' +
      '<strong>' + formatPercent(value) + '</strong>' +
      '<small>' + description + '</small>' +
    '</article>';
  }

  function renderMlSummary(evaluacion) {
    if (!mlSummaryGrid) {
      return;
    }

    var metricas = evaluacion && evaluacion.metricas ? evaluacion.metricas : {};
    mlSummaryGrid.innerHTML =
      renderMetricCard('Exactitud', metricas.exactitud, 'Predicciones correctas entre las lecturas validadas.') +
      renderMetricCard('Precision', metricas.precision, 'Alertas de incendio que fueron incendio real.') +
      renderMetricCard('Sensibilidad', metricas.sensibilidad, 'Incendios reales que el modelo detecto.') +
      renderMetricCard('F1-score', metricas.f1, 'Balance entre precision y sensibilidad.');
  }

  function renderConfusionMatrix(evaluacion) {
    if (!mlConfusionGrid) {
      return;
    }

    var matriz = evaluacion && evaluacion.matriz ? evaluacion.matriz : {};
    mlConfusionGrid.innerHTML =
      '<div class="corner"></div>' +
      '<div class="axis">Real: incendio</div>' +
      '<div class="axis">Real: normal</div>' +
      '<div class="axis">Predijo incendio</div>' +
      '<div class="hit"><strong>VP: ' + (matriz.verdaderosPositivos || 0) + '</strong><span>Incendios detectados correctamente.</span></div>' +
      '<div><strong>FP: ' + (matriz.falsosPositivos || 0) + '</strong><span>Alertas cuando no era incendio.</span></div>' +
      '<div class="axis">Predijo normal</div>' +
      '<div><strong>FN: ' + (matriz.falsosNegativos || 0) + '</strong><span>Incendios que no fueron detectados.</span></div>' +
      '<div class="hit"><strong>VN: ' + (matriz.verdaderosNegativos || 0) + '</strong><span>Estados normales reconocidos.</span></div>';
  }

  function renderValidationList(lecturas) {
    if (!mlValidationList) {
      return;
    }

    if (!Array.isArray(lecturas) || lecturas.length === 0) {
      mlValidationList.innerHTML = '<div class="ml-note">Todavia no hay lecturas reales para evaluar.</div>';
      return;
    }

    mlValidationList.innerHTML = lecturas.map(function (lectura) {
      var fecha = lectura.fecha
        ? new Date(lectura.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
        : 'Sin fecha';
      var riesgo = lectura.riesgo || 'normal';
      var observado = lectura.incendioObservado ? 'Incendio observado' : 'Normal observado';

      return '<div class="ml-validation-item">' +
        '<div>' +
          '<strong>' + fecha + '</strong>' +
          '<span>Llama: ' + (Number(lectura.llama) === 1 ? 'Si' : 'No') +
          ' | Gas: ' + (lectura.gas || 0) +
          ' | Movimiento: ' + (Number(lectura.movimiento) === 1 ? 'Si' : 'No') +
          ' | Modelo: ' + riesgo +
          ' | Real: ' + observado + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function refreshMlEvaluation() {
    if (mlValidationStatus) {
      mlValidationStatus.textContent = 'Cargando evaluacion...';
    }

    var data = await fetchJson('/api/sensores/ml/evaluacion?limit=300', { cache: 'no-store' });
    var evaluacion = data.evaluacion || {};
    renderMlSummary(evaluacion);
    renderConfusionMatrix(evaluacion);
    renderValidationList(data.lecturas || []);

    if (mlValidationStatus) {
      var evaluadas = evaluacion.totalEvaluadas || 0;
      var incendios = evaluacion.totalObservadasIncendio || 0;
      mlValidationStatus.textContent = evaluadas > 0
        ? 'Lecturas evaluadas: ' + evaluadas + '. Incendios observados: ' + incendios + '.'
        : 'Sin lecturas reales suficientes para calcular metricas.';
    }
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

      var lecturas = Array.isArray(data) ? data : (data.lecturas || []);
      var lastReading = lecturas.length > 0 ? lecturas[0] : null;
      if (lastReading) {
        var cardLlamaValue = document.getElementById('cardLlamaValue');
        var cardGasValue = document.getElementById('cardGasValue');
        var cardMovimientoValue = document.getElementById('cardMovimientoValue');
        var cardCountValue = document.getElementById('cardCountValue');
        var interpretationBlock = document.getElementById('interpretationBlock');
        var lastUpdatedTime = document.getElementById('lastUpdatedTime');

        if (cardLlamaValue) cardLlamaValue.textContent = Number(lastReading.llama) === 1 ? 'Si' : 'No';
        if (cardGasValue) cardGasValue.textContent = String(lastReading.gas || 0);
        if (cardMovimientoValue) cardMovimientoValue.textContent = Number(lastReading.movimiento) === 1 ? 'Si' : 'No';
        if (cardCountValue) cardCountValue.textContent = (lecturas.length || 0) + '';
        if (interpretationBlock) {
          interpretationBlock.innerHTML = interpretarLectura(lastReading);
        }
        if (lastUpdatedTime) {
          var now = new Date();
          lastUpdatedTime.textContent = now.toLocaleTimeString('es-ES');
        }
      }

      var labels = lecturas.map(function (r) {
        return new Date(r.fecha || r.timestamp || Date.now()).toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'America/Mexico_City',
        });
      }).reverse();
      var gasValues = lecturas.map(function (r) { return r.gas || 0; }).reverse();
      var riesgoValues = lecturas.map(function (r) {
        return String(r.riesgo || 'normal').toLowerCase();
      }).reverse();
      var fireValues = lecturas.map(function (r) { return Number(r.llama) === 1 ? 1 : 0; }).reverse();
      var movementValues = lecturas.map(function (r) { return Number(r.movimiento) === 1 ? 1 : 0; }).reverse();

      if (typeof window.updateDashboardCharts === 'function') {
        window.updateDashboardCharts(labels, gasValues, riesgoValues, fireValues, movementValues);
      } else if (typeof window.updateGasChart === 'function') {
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

  function interpretarLectura(lectura) {
    if (!lectura) return '<p class="interp">Sin datos todavia.</p>';

    var riesgo = String(lectura.riesgo || 'normal').toLowerCase();
    var tagClass = riesgo === 'alto' ? 'tag-alto' : riesgo === 'medio' ? 'tag-medio' : 'tag-normal';
    var tagText = riesgo === 'alto' ? 'Alto' : riesgo === 'medio' ? 'Medio' : 'Normal';
    var partes = [];

    partes.push(Number(lectura.llama) === 1 ? 'Se detecta llama.' : 'No se detecta llama.');
    partes.push('Gas: ' + (lectura.gas || 0) + ' ADC.');
    partes.push(Number(lectura.movimiento) === 1 ? 'Hay movimiento en el area.' : 'Sin movimiento detectado.');

    if (lectura.prediccion_gas === 'subiendo') {
      partes.push('El gas va en aumento.');
    } else if (lectura.prediccion_gas === 'bajando') {
      partes.push('El gas esta bajando.');
    } else {
      partes.push('Gas estable.');
    }

    if (lectura.anomalia === true) {
      partes.push('Lectura anomala.');
    }

    return '<div class="interp-wrap">' +
      '<span class="tag ' + tagClass + '">' + tagText + '</span>' +
      '<p class="interp">' + partes.join(' ') + '</p>' +
    '</div>';
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
