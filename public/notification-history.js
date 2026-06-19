(function () {
  'use strict';

  // DOM Elements
  var notifHistoryContainer = document.getElementById('notificationHistoryContainer');
  var notifHistoryList = document.getElementById('notificationHistoryList');
  var notifHistoryStatus = document.getElementById('notificationHistoryStatus');
  var notifResumenStats = document.getElementById('notificationResumenStats');
  var notifSeverityFilter = document.getElementById('notifSeverityFilter');
  var notifStatusFilter = document.getElementById('notifStatusFilter');
  var notifOnlyUnread = document.getElementById('notifOnlyUnread');
  var notifRefreshBtn = document.getElementById('notificationRefreshBtn');
  var notifClearBtn = document.getElementById('notificationClearBtn');

  if (!notifHistoryContainer || !notifHistoryList) {
    return;
  }

  var LS_NOTIF_FILTERS = 'iot.notifFilters.v1';
  var loaded = [];

  function setStatus(message) {
    if (notifHistoryStatus) {
      notifHistoryStatus.textContent = message || '';
    }
  }

  function formatDate(value) {
    if (!value) return 'Sin fecha';
    var d = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return 'Sin fecha';
    return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  }

  function getSeverityColor(severity) {
    switch (String(severity || '').toLowerCase()) {
      case 'critical': return '#dc3545';
      case 'high': return '#fd7e14';
      case 'medium': return '#ffc107';
      case 'low': return '#28a745';
      default: return '#6c757d';
    }
  }

  function getSeverityLabel(severity) {
    switch (String(severity || '').toLowerCase()) {
      case 'critical': return '🔴 CRÍTICA';
      case 'high': return '🟠 ALTA';
      case 'medium': return '🟡 MEDIA';
      case 'low': return '🟢 BAJA';
      default: return '⚪ NORMAL';
    }
  }

  function getStatusLabel(notif) {
    if (!notif.sent && !notif.failed) return '⏳ Pendiente';
    if (notif.failed === 0 && notif.sent > 0) return '✅ Exitosa';
    if (notif.sent === 0 && notif.failed > 0) return '❌ Fallida';
    return '⚠️ Parcial';
  }

  function notificationRow(notif) {
    var leidaClass = notif.leida ? 'notif-read' : 'notif-unread';
    var severityLabel = getSeverityLabel(notif.severity);
    var statusLabel = getStatusLabel(notif);
    var metadata = notif.metadata || {};

    var html = '<div class="notif-item ' + leidaClass + '">' +
      '<div class="notif-header">' +
      '<div class="notif-title-wrap">' +
      '<h4 class="notif-title">' + (notif.title || 'Alerta') + '</h4>' +
      '<span class="notif-severity" style="background-color: ' + getSeverityColor(notif.severity) + '; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">' + severityLabel + '</span>' +
      '</div>' +
      '<div class="notif-meta">' +
      '<span class="notif-time">' + formatDate(notif.timestamp || notif.createdAt) + '</span>' +
      '<span class="notif-status">' + statusLabel + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="notif-body">' +
      '<p>' + (notif.body || '') + '</p>' +
      '</div>' +
      '<div class="notif-stats">' +
      '<span>📤 Enviadas: <strong>' + (notif.sent || 0) + '</strong></span>' +
      '<span>❌ Fallidas: <strong>' + (notif.failed || 0) + '</strong></span>' +
      '<span>📊 Total: <strong>' + (notif.total || 0) + '</strong></span>';

    if (metadata.sensorGas !== undefined || metadata.sensorLlama !== undefined || metadata.sensorMovimiento !== undefined) {
      html += '<span class="notif-sensors">🔍 Sensores: ';
      if (metadata.sensorLlama === 1) html += 'Llama ';
      if (metadata.sensorGas && metadata.sensorGas > 500) html += 'Gas ';
      if (metadata.sensorMovimiento === 1) html += 'Movimiento ';
      html += '</span>';
    }

    html += '</div>';

    if (!notif.leida) {
      html += '<button class="notif-mark-read" data-notif-id="' + notif.id + '" title="Marcar como leída">Marcar como leída</button>';
    }

    html += '</div>';

    return html;
  }

  function renderHistory() {
    if (loaded.length === 0) {
      notifHistoryList.innerHTML = '<div style="padding: 32px; text-align: center; color: #999;"><p>No hay notificaciones guardadas. Cuando se envíen alertas, aparecerán aquí.</p></div>';
      setStatus('');
      return;
    }

    notifHistoryList.innerHTML = loaded.map(notificationRow).join('');

    // Attach event listeners to mark-as-read buttons
    var markReadBtns = notifHistoryList.querySelectorAll('.notif-mark-read');
    markReadBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var notifId = btn.getAttribute('data-notif-id');
        markNotificationAsRead(notifId);
      });
    });

    var unreadCount = loaded.filter(function (n) { return !n.leida; }).length;
    setStatus('Mostrando ' + loaded.length + ' notificaciones. ' + unreadCount + ' no leídas.');
  }

  function saveFilterState() {
    try {
      var state = {
        severity: notifSeverityFilter ? notifSeverityFilter.value : 'all',
        status: notifStatusFilter ? notifStatusFilter.value : 'all',
        onlyUnread: notifOnlyUnread ? notifOnlyUnread.checked : false,
      };
      localStorage.setItem(LS_NOTIF_FILTERS, JSON.stringify(state));
    } catch (error) {
      console.warn('No se pudo guardar filtros:', error.message);
    }
  }

  function restoreFilterState() {
    try {
      var raw = localStorage.getItem(LS_NOTIF_FILTERS);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (notifSeverityFilter && state.severity) notifSeverityFilter.value = state.severity;
      if (notifStatusFilter && state.status) notifStatusFilter.value = state.status;
      if (notifOnlyUnread && state.onlyUnread !== undefined) notifOnlyUnread.checked = state.onlyUnread;
    } catch (error) {
      console.warn('No se pudo restaurar filtros:', error.message);
    }
  }

  async function fetchJson(url) {
    var response = await fetch(url);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
    return data;
  }

  async function loadNotificationHistory() {
    setStatus('Cargando historial...');
    try {
      var params = ['limit=50'];
      if (notifSeverityFilter && notifSeverityFilter.value !== 'all') {
        params.push('severity=' + encodeURIComponent(notifSeverityFilter.value));
      }
      if (notifStatusFilter && notifStatusFilter.value !== 'all') {
        params.push('status=' + encodeURIComponent(notifStatusFilter.value));
      }
      if (notifOnlyUnread && notifOnlyUnread.checked) {
        params.push('onlyUnread=true');
      }

      var url = '/api/alertas/notificaciones/historial?' + params.join('&');
      var data = await fetchJson(url);

      loaded = Array.isArray(data.notifications) ? data.notifications : [];
      saveFilterState();
      renderHistory();

      // Load stats
      loadNotificationStats();
    } catch (error) {
      setStatus('Error cargando historial: ' + error.message);
      loaded = [];
      renderHistory();
    }
  }

  async function loadNotificationStats() {
    try {
      var data = await fetchJson('/api/alertas/notificaciones/resumen?hours=24');
      if (data.stats && notifResumenStats) {
        notifResumenStats.innerHTML = '<div class="notif-stats-grid">' +
          '<div class="stat-card"><div class="stat-value">' + (data.stats.total || 0) + '</div><div class="stat-label">Total</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + (data.stats.leidas || 0) + '</div><div class="stat-label">Leídas</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + (data.stats.noleidas || 0) + '</div><div class="stat-label">No leídas</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + (data.stats.tasaExito || 0) + '%</div><div class="stat-label">Tasa Éxito</div></div>' +
          '</div>';
      }
    } catch (error) {
      console.warn('Error cargando stats:', error.message);
    }
  }

  async function markNotificationAsRead(notifId) {
    try {
      var response = await fetch('/api/alertas/notificaciones/' + notifId + '/leida', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      var data = await response.json();
      if (data.ok) {
        loadNotificationHistory();
      }
    } catch (error) {
      console.error('Error marcando como leída:', error.message);
    }
  }

  // Event listeners
  if (notifSeverityFilter) {
    notifSeverityFilter.addEventListener('change', function () {
      loadNotificationHistory();
    });
  }

  if (notifStatusFilter) {
    notifStatusFilter.addEventListener('change', function () {
      loadNotificationHistory();
    });
  }

  if (notifOnlyUnread) {
    notifOnlyUnread.addEventListener('change', function () {
      loadNotificationHistory();
    });
  }

  if (notifRefreshBtn) {
    notifRefreshBtn.addEventListener('click', function () {
      loadNotificationHistory();
    });
  }

  if (notifClearBtn) {
    notifClearBtn.addEventListener('click', function () {
      if (confirm('¿Estás seguro de que deseas limpiar el historial?')) {
        // TODO: Implementar endpoint para limpiar historial
        alert('Función no implementada aún');
      }
    });
  }

  // Initial load
  restoreFilterState();
  loadNotificationHistory();

  // Refresh every 60 seconds
  setInterval(function () {
    loadNotificationHistory();
  }, 60000);
})();
