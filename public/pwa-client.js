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
  var LS_NOTIFIED_ALERTS = 'iot.notifiedAlerts.v1';
  var LS_NOTIFIED_TYPES = 'iot.notifiedAlertTypes.v1';
  var LS_DISMISSED_ACTIVE_ALERTS = 'iot.dismissedActiveAlerts.v1';
  var audioUnlocked = false;
  var audioCtx = null;
  var lecturasEventSource = null;
  var DASHBOARD_CHART_LIMIT = 300;

  function getSummaryPriority(lectura) {
    if (!lectura) {
      return {
        cls: 'priority-normal',
        title: 'Sin datos recientes',
        message: 'En cuanto llegue una lectura nueva, el panel mostrara el nivel de prioridad.',
      };
    }

    var riesgo = String(lectura.riesgo || 'normal').toLowerCase();
    var prob = Number(lectura.probabilidad || 0);
    var gas = Number(lectura.gas || 0);
    var llama = Number(lectura.llama) === 1;

    if (riesgo === 'alto' || llama || prob >= 0.75 || gas >= 1800) {
      return {
        cls: 'priority-critical',
        title: 'Prioridad maxima: revisar de inmediato',
        message: 'Se detecto una condicion de amenaza. Verifica el area ahora y sigue el protocolo de seguridad.',
      };
    }

    if (riesgo === 'medio' || prob >= 0.55 || gas >= 1100) {
      return {
        cls: 'priority-warning',
        title: 'Atencion requerida',
        message: 'Hay una senal que puede evolucionar a riesgo alto. Mantente atento y valida ventilacion y entorno.',
      };
    }

    return {
      cls: 'priority-normal',
      title: 'Estado estable',
      message: 'No se detectan amenazas inmediatas. Continua el monitoreo normal.',
    };
  }

  function applySummaryVisualState(reading) {
    var priority = getSummaryPriority(reading);
    var priorityClasses = ['priority-normal', 'priority-warning', 'priority-critical'];

    var banner = document.getElementById('summaryPriorityBanner');
    var bannerTitle = document.getElementById('summaryPriorityTitle');
    var bannerMessage = document.getElementById('summaryPriorityMessage');

    if (banner) {
      banner.classList.remove.apply(banner.classList, priorityClasses);
      banner.classList.add(priority.cls);
    }
    if (bannerTitle) bannerTitle.textContent = priority.title;
    if (bannerMessage) bannerMessage.textContent = priority.message;

    var statusInterpretationCard = document.getElementById('statusInterpretationCard');
    var statusUpdatedCard = document.getElementById('statusUpdatedCard');

    [statusInterpretationCard, statusUpdatedCard].forEach(function (card) {
      if (!card) return;
      card.classList.remove.apply(card.classList, priorityClasses);
      card.classList.add(priority.cls);
    });

    var cardLlama = document.getElementById('cardLlama');
    var cardGas = document.getElementById('cardGas');

    if (cardLlama) {
      cardLlama.classList.toggle('alerta', Number(reading && reading.llama) === 1);
    }

    if (cardGas) {
      var gas = Number(reading && reading.gas || 0);
      cardGas.classList.remove('alerta');
      cardGas.classList.remove('warning');
      if (gas >= 1800) {
        cardGas.classList.add('alerta');
      } else if (gas >= 1100) {
        cardGas.classList.add('warning');
      }
    }
  }

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

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function playCriticalTone() {
    if (!audioUnlocked) {
      return;
    }

    try {
      var ctx = getAudioContext();
      if (!ctx) return;
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
    } catch (error) {
      console.warn('No se pudo reproducir tono de alerta:', error.message);
    }
  }

  function getAudioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }

    if (!audioUnlocked) {
      return null;
    }

    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () { return null; });
    }

    return audioCtx;
  }

  function unlockAudio() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtx) {
        audioCtx = new AudioCtx();
      }

      audioUnlocked = true;

      var ctx = audioCtx;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(function () { return null; });
      }

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
      audioUnlocked = true;
    } catch (error) {
      console.warn('No se pudo desbloquear audio:', error.message);
    }
  }

  function setupAudioUnlockGestures() {
    var unlockOnce = function () {
      unlockAudio();
    };

    document.addEventListener('pointerdown', unlockOnce, { passive: true });
    document.addEventListener('touchstart', unlockOnce, { passive: true });
    document.addEventListener('keydown', unlockOnce);
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

  function buildAllAlertsQuery() {
    var query = ['limit=20'];

    if (severityFilter && severityFilter.value && severityFilter.value !== 'all') {
      query.push('severidad=' + encodeURIComponent(severityFilter.value));
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
          btn.textContent = 'Entendido';
        });
      });
    });
  }

  function severityLabel(severity) {
    if (severity === 'critical') return 'Riesgo critico';
    if (severity === 'high') return 'Riesgo alto';
    if (severity === 'medium') return 'Riesgo medio';
    return 'Aviso preventivo';
  }

  function renderAlertItems(items, compact) {
    if (!Array.isArray(items) || items.length === 0) {
      return '<li><strong>Sin alertas activas</strong><div class="meta">Si aparece una amenaza, la veras aqui con una accion clara.</div></li>';
    }

    return items.map(function (a) {
      var sev = a.severidad || 'medium';
      a.tipo = severityLabel(sev);
      var fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Sin fecha';
      var estado = a.leida ? 'Atendida' : 'Pendiente';
      var estadoClass = a.leida ? 'badge-state read' : 'badge-state';
      var btn = a.leida
        ? '<button class="btn-mark-read" disabled>Ya revisada</button>'
        : '<button class="btn-mark-read" data-alert-id="' + escapeHtml(a.id) + '">Marcar como revisada</button>';
      var compactStyle = compact ? ' style="margin-bottom:2px;"' : '';
      var evidencia = Array.isArray(a.evidencia) && a.evidencia.length > 0
        ? '<div class="alert-evidence">' + a.evidencia.map(function (item) {
          return '<span>' + escapeHtml(item) + '</span>';
        }).join('') + '</div>'
        : '';
      var accion = a.accion
        ? '<div class="alert-action"><strong>Que hacer:</strong> ' + escapeHtml(a.accion) + '</div>'
        : '';

      return '<li class="' + sev + '">' +
        '<div class="alert-top"' + compactStyle + '><strong>' + escapeHtml(a.titulo || 'Alerta') + '</strong><span class="' + estadoClass + '">' + estado + '</span>' + btn + '</div>' +
        '<div class="alert-message">' + escapeHtml(a.mensaje || '') + '</div>' +
        evidencia +
        accion +
        '<div class="meta">' + fecha + ' · ' + (a.tipo || '-') + '</div>' +
      '</li>';
    }).join('');
  }

  function renderAlerts(items) {
    window.__lastRenderedAlerts = Array.isArray(items) ? items : [];

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

  function playAlertTone(severity) {
    if (!audioUnlocked) {
      return;
    }

    if (severity === 'critical') {
      [0, 420, 840, 1260].forEach(function (delay) {
        setTimeout(playCriticalTone, delay);
      });
      return;
    }

    try {
      var ctx = getAudioContext();
      if (!ctx) return;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    } catch (error) {
      console.warn('No se pudo reproducir tono de alerta:', error.message);
    }
  }

  function loadNotifiedAlertIds() {
    try {
      var raw = localStorage.getItem(LS_NOTIFIED_ALERTS);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
    } catch (error) {
      return [];
    }
  }

  function buildAlertNotificationToken(alerta) {
    if (!alerta) {
      return '';
    }

    var id = alerta.id || alerta.tipo || 'sin-id';
    var marca = alerta.lastSeen || alerta.fecha || '';
    var severidad = alerta.severidad || 'medium';
    return id + '|' + marca + '|' + severidad;
  }

  function rememberNotifiedAlertId(id) {
    if (!id) {
      return;
    }

    try {
      var ids = loadNotifiedAlertIds().filter(function (item) { return item !== id; });
      ids.unshift(id);
      localStorage.setItem(LS_NOTIFIED_ALERTS, JSON.stringify(ids.slice(0, 80)));
    } catch (error) {
      console.warn('No se pudo guardar alerta notificada:', error.message);
    }
  }

  function getAlertCooldownMs(alerta) {
    var tipo = alerta && alerta.tipo ? alerta.tipo : '';
    if (tipo === 'llama_detectada') return 10000;
    if (tipo === 'riesgo_alto') return 30000;
    if (tipo === 'gas_extremo') return 30000;
    if (tipo === 'cambio_extremo_gas') return 30000;
    if (tipo === 'probabilidad_incendio_alta') return 30000;
    if (tipo === 'probabilidad_incendio_media') return 45000;
    if (tipo === 'tendencia_gas_subiendo') return 30000;
    if (tipo === 'movimiento_detectado') return 20000;
    return 15000;
  }

  function canNotifyAlertType(alerta) {
    try {
      var key = alerta && alerta.tipo ? alerta.tipo : 'desconocida';
      var raw = localStorage.getItem(LS_NOTIFIED_TYPES);
      var state = raw ? JSON.parse(raw) : {};
      var last = Number(state[key] || 0);
      return Date.now() - last >= getAlertCooldownMs(alerta);
    } catch (error) {
      return true;
    }
  }

  function rememberAlertType(alerta) {
    try {
      var key = alerta && alerta.tipo ? alerta.tipo : 'desconocida';
      var raw = localStorage.getItem(LS_NOTIFIED_TYPES);
      var state = raw ? JSON.parse(raw) : {};
      state[key] = Date.now();
      localStorage.setItem(LS_NOTIFIED_TYPES, JSON.stringify(state));
    } catch (error) {
      console.warn('No se pudo guardar cooldown de alerta:', error.message);
    }
  }

  function getActiveAlertSignature(alertas) {
    if (!Array.isArray(alertas)) {
      return '';
    }

    return alertas
      .filter(function (alerta) { return alerta && alerta.leida !== true; })
      .map(function (alerta) { return alerta.id || alerta.tipo || ''; })
      .filter(Boolean)
      .sort()
      .join('|');
  }

  function shouldAutoOpenNotifications(alertas) {
    var signature = getActiveAlertSignature(alertas);
    if (!signature) {
      try { localStorage.removeItem(LS_DISMISSED_ACTIVE_ALERTS); } catch (error) {}
      return false;
    }

    try {
      return localStorage.getItem(LS_DISMISSED_ACTIVE_ALERTS) !== signature;
    } catch (error) {
      return true;
    }
  }

  function rememberDismissedNotifications(alertas) {
    var signature = getActiveAlertSignature(alertas);
    try {
      if (signature) {
        localStorage.setItem(LS_DISMISSED_ACTIVE_ALERTS, signature);
      }
    } catch (error) {
      console.warn('No se pudo recordar cierre del panel:', error.message);
    }
  }

  async function showSystemNotification(alerta) {
    if (!alerta || !('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    var isCritical = alerta.severidad === 'critical';
    var title = alerta.titulo || (isCritical ? 'Alerta critica IoT' : 'Alerta IoT');
    var options = {
      body: alerta.mensaje || 'Se detecto un evento en el detector.',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      tag: alerta.id || alerta.tipo || 'iot-alert',
      renotify: isCritical,
      requireInteraction: isCritical,
      vibrate: isCritical ? [300, 150, 300, 150, 700] : [120],
      data: {
        url: '/resultados',
        severity: alerta.severidad || 'medium',
        lecturaId: alerta.lecturaId || null,
      },
    };

    try {
      if ('serviceWorker' in navigator) {
        var registration = await navigator.serviceWorker.getRegistration();
        if (registration && registration.showNotification) {
          await registration.showNotification(title, options);
          return;
        }
      }

      var notification = new Notification(title, options);
      notification.onclick = function () {
        window.focus();
        notification.close();
      };
    } catch (error) {
      console.warn('No se pudo mostrar notificacion:', error.message);
    }
  }

  function notifyNewAlerts(alertas) {
    if (!Array.isArray(alertas) || alertas.length === 0) {
      return;
    }

    var notified = loadNotifiedAlertIds();
    var now = Date.now();
    var nuevas = alertas.filter(function (alerta) {
      var marcaTiempo = alerta && (alerta.lastSeen || alerta.fecha);
      var fechaMs = marcaTiempo ? Date.parse(marcaTiempo) : now;
      var reciente = Number.isFinite(fechaMs) ? (now - fechaMs) <= 45000 : true;
      var token = buildAlertNotificationToken(alerta);
      return alerta &&
        token &&
        alerta.leida !== true &&
        reciente &&
        notified.indexOf(token) === -1 &&
        canNotifyAlertType(alerta);
    });

    var alerta = nuevas[0];
    if (!alerta) {
      return;
    }

    var notificationToken = buildAlertNotificationToken(alerta);
    playAlertTone(alerta.severidad);
    showSystemNotification(alerta).catch(function () { return null; });
    rememberNotifiedAlertId(notificationToken);
    rememberAlertType(alerta);
  }

  function setupLecturasStream() {
    if (!window.EventSource) {
      return;
    }

    try {
      if (lecturasEventSource) {
        lecturasEventSource.close();
      }

      lecturasEventSource = new EventSource('/api/sensores/stream');
      lecturasEventSource.addEventListener('lectura', function (event) {
        try {
          var lectura = JSON.parse(event.data || '{}');
          var alertas = lectura && Array.isArray(lectura.alertas) ? lectura.alertas : [];

          refreshDashboard().catch(function () { return null; });

          // Si vienen alertas en el SSE, procesarlas directamente (sin refetch).
          if (alertas.length > 0) {
            console.debug('[pwa-client] Procesando alertas desde SSE:', alertas.length);
            notifyNewAlerts(alertas);
            renderAlerts(alertas);
          } else {
            // Si no vienen alertas en el SSE, hacer refetch normal.
            refreshAlerts().catch(function () { return null; });
          }
        } catch (err) {
          console.warn('[pwa-client] Error procesando evento SSE:', err.message);
          refreshAlerts().catch(function () { return null; });
        }
      });

      lecturasEventSource.onerror = function () {
        if (lecturasEventSource) {
          lecturasEventSource.close();
          lecturasEventSource = null;
        }

        setTimeout(function () {
          setupLecturasStream();
        }, 3000);
      };
    } catch (error) {
      console.warn('No se pudo inicializar stream de lecturas:', error.message);
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

  function renderRealValidationReport(reporteValidacion) {
    if (!reporteValidacion) {
      return;
    }

    var baseline = reporteValidacion.baseline;
    var realValidation = reporteValidacion.realValidation || {};
    var hasConfirmations = realValidation.totalConfirmaciones && realValidation.totalConfirmaciones > 0;

    var html = '<article class="ml-validation-report">' +
      '<h3>Validación en Tiempo Real</h3>';

    if (!hasConfirmations) {
      html += '<div class="ml-note"><strong>Sin datos de validación real aún.</strong> ' +
        'Marca predicciones como correctas/incorrectas en el UI para construir validación real.</div>';
    } else {
      html += '<div class="ml-validation-metrics">' +
        '<div class="metric"><strong>Confirmaciones:</strong> ' + realValidation.totalConfirmaciones + '</div>' +
        '<div class="metric"><strong>Correctas:</strong> ' + realValidation.correctas + '</div>' +
        '<div class="metric"><strong>Incorrectas:</strong> ' + realValidation.incorrectas + '</div>' +
        '<div class="metric metric-accuracy"><strong>Precisión Real:</strong> ' + formatPercent(realValidation.precisionReal / 100) + '</div>';

      if (baseline) {
        html += '<div class="metric"><strong>Baseline (entrenamiento):</strong> ' + formatPercent(baseline.accuracy / 100) + '</div>' +
          '<div class="metric ' + (realValidation.degradacion < -0.05 ? 'metric-danger' : realValidation.degradacion < 0 ? 'metric-warning' : 'metric-ok') + '">' +
          '<strong>Degradación:</strong> ' + (realValidation.degradacion > 0 ? '+' : '') + formatPercent(realValidation.degradacion / 100) + '</div>' +
          '<div class="metric"><strong>Estado:</strong> ' + realValidation.estado + '</div>';
      }

      html += '</div>';
    }

    html += '</article>';
    return html;
  }

  async function refreshMlEvaluation() {
    if (mlValidationStatus) {
      mlValidationStatus.textContent = 'Cargando evaluacion...';
    }

    var data = await fetchJson('/api/sensores/ml/evaluacion?limit=300', { cache: 'no-store' });
    var evaluacion = data.evaluacion || {};
    var reporteValidacion = data.reporteValidacion || null;

    renderMlSummary(evaluacion);
    renderConfusionMatrix(evaluacion);
    renderValidationList(data.lecturas || []);

    // Append real validation report if available
    if (mlValidationList && reporteValidacion) {
      var reportHTML = renderRealValidationReport(reporteValidacion);
      mlValidationList.innerHTML += reportHTML;
    }

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

      if (alertas.length === 0 && onlyUnreadAlerts && onlyUnreadAlerts.checked) {
        var allData = await fetchJson(buildAllAlertsQuery());
        alertas = allData.alertas || [];
      }

      notifyNewAlerts(alertas);

      renderAlerts(alertas);

      if (shouldAutoOpenNotifications(alertas) && navbarNotifMenu) {
        navbarNotifMenu.classList.add('open');
        persistNotifMenuState(true);
      }

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
    if (!('Notification' in window)) {
      alert('Este navegador no soporta notificaciones.');
      return;
    }

    unlockAudio();

    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Permiso de notificaciones no concedido.');
      return;
    }

    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js');
    }

    await syncPushUiState();
    playAlertTone('medium');
    await showSystemNotification({
      id: 'notificaciones-activadas',
      tipo: 'sistema',
      severidad: 'medium',
      titulo: 'Notificaciones activadas',
      mensaje: 'El detector IoT avisara cuando el analisis detecte una amenaza.',
      fecha: new Date().toISOString(),
    });
  }

  async function syncPushUiState() {
    var supported = ('Notification' in window);
    var granted = window.Notification && Notification.permission === 'granted';

    pushIsEnabled = Boolean(supported && granted);

    if (!pushBtn) {
      return pushIsEnabled;
    }

    if (!supported) {
      pushBtn.style.display = 'inline-flex';
      pushBtn.textContent = 'Notificaciones no disponibles';
      pushBtn.disabled = true;
      return false;
    }

    if (!granted) {
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
      notifStatus.textContent = 'Notificaciones activas en este dispositivo';
    }

    return true;
  }

  async function checkPushAvailability() {
    if (!('Notification' in window)) {
      if (pushBtn) {
        pushBtn.style.display = 'inline-flex';
        pushBtn.textContent = 'Notificaciones no disponibles';
        pushBtn.disabled = true;
      }
      if (notifStatus) {
        notifStatus.textContent = 'Este navegador no soporta notificaciones.';
      }
      return false;
    }

    await syncPushUiState();
    return true;
  }

  function setupNavbarNotifications() {
    if (notifBellBtn && navbarNotifMenu) {
      notifBellBtn.addEventListener('click', function () {
        navbarNotifMenu.classList.toggle('open');

        // Si el usuario abre el panel sin push activo, mostramos CTA para activarlo.
        if (pushBtn && navbarNotifMenu.classList.contains('open') && !pushIsEnabled) {
          pushBtn.style.display = 'inline-flex';
        }

        if (!navbarNotifMenu.classList.contains('open')) {
          rememberDismissedNotifications(window.__lastRenderedAlerts || []);
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
          rememberDismissedNotifications(window.__lastRenderedAlerts || []);
          persistNotifMenuState(false);
        }
      });
    }
  }

  function setupSectionNavHighlight() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.section-nav .section-link'));
    var sections = Array.prototype.slice.call(document.querySelectorAll('main .section[id]'));

    if (links.length === 0 || sections.length === 0) {
      return;
    }

    function setActive(id) {
      links.forEach(function (link) {
        var target = (link.getAttribute('href') || '').replace('#', '');
        link.classList.toggle('active', target === id);
      });
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.target && entry.target.id) {
          setActive(entry.target.id);
        }
      });
    }, {
      root: null,
      threshold: 0.35,
      rootMargin: '-20% 0px -45% 0px',
    });

    sections.forEach(function (section) {
      observer.observe(section);
    });

    if (sections[0] && sections[0].id) {
      setActive(sections[0].id);
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
      var response = await fetch('/api/sensores/ultimas?limit=' + DASHBOARD_CHART_LIMIT, { cache: 'no-store' });
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

        if (cardLlamaValue) cardLlamaValue.textContent = Number(lastReading.llama) === 1 ? 'Detectada' : 'Sin llama';
        if (cardGasValue) cardGasValue.textContent = String(lastReading.gas || 0);
        if (cardMovimientoValue) cardMovimientoValue.textContent = Number(lastReading.movimiento) === 1 ? 'Detectado' : 'Sin presencia';
        if (cardCountValue) cardCountValue.textContent = (lecturas.length || 0) + '';
        var chartHistoryCount = document.getElementById('chartHistoryCount');
        if (chartHistoryCount) chartHistoryCount.textContent = (lecturas.length || 0) + '';
        if (interpretationBlock) {
          interpretationBlock.innerHTML = interpretarLectura(lastReading);
        }
        applySummaryVisualState(lastReading);
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
    if (riesgo.includes('CRÍTICO') || riesgo.includes('CRITICO')) return 'CRÍTICO';
    if (riesgo.includes('ALTO')) return 'ALTO RIESGO';
    if (riesgo.includes('MEDIO')) return 'RIESGO MODERADO';
    return 'BAJO RIESGO';
  }

  function interpretarLectura(lectura) {
    if (!lectura) return '<p class="interp">Sin datos todavia.</p>';

    var riesgo = String(lectura.riesgo || 'normal').toLowerCase();
    var tagClass = riesgo === 'alto' ? 'tag-alto' : riesgo === 'medio' ? 'tag-medio' : 'tag-normal';
    var tagText = riesgo === 'alto' ? 'Amenaza critica' : riesgo === 'medio' ? 'Atencion requerida' : 'Operacion normal';
    var prob = Number(lectura.probabilidad || 0);
    var evidencia = [];
    var recomendacion = 'Mantener monitoreo.';

    evidencia.push(Number(lectura.llama) === 1 ? 'llama detectada' : 'sin llama');
    evidencia.push('gas ' + (lectura.gas || 0) + ' ADC');
    evidencia.push(Number(lectura.movimiento) === 1 ? 'movimiento detectado' : 'sin movimiento');

    if (lectura.prediccion_gas === 'subiendo') evidencia.push('gas subiendo');
    if (lectura.prediccion_gas === 'bajando') evidencia.push('gas bajando');
    if (lectura.anomalia === true) evidencia.push('anomalia ML');

    if (riesgo === 'alto') {
      recomendacion = 'Revisa el area de inmediato y corta fuentes de ignicion si es seguro hacerlo.';
    } else if (riesgo === 'medio') {
      recomendacion = 'Mantente atento y verifica ventilacion, gas y presencia cercana.';
    }

    return '<div class="interp-wrap">' +
      '<span class="tag ' + tagClass + '">' + tagText + '</span>' +
      '<div class="interp">' +
        '<strong>Lectura interpretada:</strong> ' + evidencia.join(' · ') + '.' +
        '<br><strong>ML:</strong> ' + Math.round(prob * 100) + '% de probabilidad.' +
        '<br><strong>Que hacer:</strong> ' + recomendacion +
      '</div>' +
    '</div>';
  }

  async function init() {
    setupAudioUnlockGestures();
    setupSectionNavHighlight();
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
    setupLecturasStream();

    if (pushBtn) {
      pushBtn.addEventListener('click', function () {
        unlockAudio();
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

    // Polling corto; el backend usa cache para no saturar Adafruit IO.
    setInterval(function () { refreshDashboard().catch(function () { return null; }); }, 1500);

    await refreshAlerts();
    setInterval(function () { refreshAlerts().catch(function () { return null; }); }, 1500);
  }

  init().catch(function (error) {
    console.error('Error inicializando cliente PWA:', error);
  });
}());
