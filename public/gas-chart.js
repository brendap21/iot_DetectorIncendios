// public/gas-chart.js
// Graph helpers for the dashboard: gas, fuego binario y movimiento binario.
// El cliente puede actualizar los tres graficos en vivo usando las funciones
// expuestas en window.
(function () {
  'use strict';

  if (window.Chart && window.Chart.register && window['chartjs-plugin-zoom']) {
    try {
      window.Chart.register(window['chartjs-plugin-zoom']);
    } catch (error) {
      // Plugin may already be registered.
    }
  }

  var gasChart = null;
  var fireChart = null;
  var movementChart = null;
  var chartDataState = {
    labels: [],
    gasValues: [],
    riesgoValues: [],
    fireValues: [],
    movementValues: [],
  };
  var viewWindowSize = 30;
  var viewWindowOffset = 0;

  function createChart(canvas, config) {
    if (!canvas) return null;
    return new Chart(canvas, config);
  }

  function buildGasChart(canvas, labels, gasData, riesgoData) {
    var pointColors = riesgoData.map(function (r) {
      if (r === 'alto') return '#c0392b';
      if (r === 'medio') return '#b7770d';
      return '#1e8449';
    });

    return createChart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Gas (ADC)',
          data: gasData,
          borderColor: '#3c6bce',
          backgroundColor: 'rgba(60,107,206,0.12)',
          pointBackgroundColor: pointColors,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            },
          },
          tooltip: {
            callbacks: {
              afterLabel: function (ctx) {
                return 'Riesgo: ' + riesgoData[ctx.dataIndex];
              },
            },
          },
        },
        scales: {
          x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
          y: { beginAtZero: false, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  function buildBinaryChart(canvas, labels, values, labelText, color) {
    return createChart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: labelText,
          data: values,
          backgroundColor: values.map(function (value) {
            return value === 1 ? color : '#dbe2ef';
          }),
          borderColor: values.map(function (value) {
            return value === 1 ? color : '#dbe2ef';
          }),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return labelText + ': ' + (ctx.parsed.y === 1 ? 'Sí' : 'No');
              },
            },
          },
        },
        scales: {
          x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              callback: function (value) {
                return value === 1 ? 'Sí' : 'No';
              },
            },
          },
        },
      },
    });
  }

  function loadInitialChartData(canvasId, datasetName) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    var labels = JSON.parse(canvas.dataset.labels || '[]');
    var dataset = JSON.parse(canvas.dataset[datasetName] || '[]');
    return { canvas: canvas, labels: labels, dataset: dataset };
  }

  function updateChart(chart, labels, data, extra) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    if (extra && chart.data.datasets[0].pointBackgroundColor) {
      chart.data.datasets[0].pointBackgroundColor = extra;
    }

    if (chart.config.type === 'bar') {
      var activeColor = '#1e8449';
      if (chart.data.datasets[0].label === 'Incendio') {
        activeColor = '#c0392b';
      }

      chart.data.datasets[0].backgroundColor = data.map(function (value) {
        return value === 1 ? activeColor : '#dbe2ef';
      });
      chart.data.datasets[0].borderColor = data.map(function (value) {
        return value === 1 ? activeColor : '#dbe2ef';
      });
    }

    chart.update('none');
  }

  function getVisibleSlice(total) {
    if (viewWindowSize === 'all' || !Number.isFinite(Number(viewWindowSize))) {
      return { start: 0, end: total };
    }

    var size = Math.max(5, Number(viewWindowSize));
    var maxOffset = Math.max(0, total - size);
    var safeOffset = Math.min(Math.max(0, viewWindowOffset), maxOffset);
    var end = total - safeOffset;
    var start = Math.max(0, end - size);

    return { start: start, end: end };
  }

  function applyChartsWindow() {
    var total = chartDataState.labels.length;
    var slice = getVisibleSlice(total);

    var labels = chartDataState.labels.slice(slice.start, slice.end);
    var gasValues = chartDataState.gasValues.slice(slice.start, slice.end);
    var riesgoValues = chartDataState.riesgoValues.slice(slice.start, slice.end);
    var fireValues = chartDataState.fireValues.slice(slice.start, slice.end);
    var movementValues = chartDataState.movementValues.slice(slice.start, slice.end);

    window.updateGasChart(labels, gasValues, riesgoValues);
    window.updateFireChart(labels, fireValues);
    window.updateMovementChart(labels, movementValues);

    var status = document.getElementById('chartViewportLabel');
    if (status) {
      status.textContent = labels.length + ' de ' + total + ' puntos visibles';
    }
  }

  function setupChartControls() {
    var sizeSelect = document.getElementById('chartWindowSize');
    var olderBtn = document.getElementById('chartOlderBtn');
    var newerBtn = document.getElementById('chartNewerBtn');
    var resetZoomBtn = document.getElementById('chartResetZoomBtn');

    if (sizeSelect) {
      sizeSelect.addEventListener('change', function () {
        var value = sizeSelect.value;
        window.setChartWindow(value === 'all' ? 'all' : Number(value));
      });
    }

    if (olderBtn) {
      olderBtn.addEventListener('click', function () {
        window.panChartWindow('older');
      });
    }

    if (newerBtn) {
      newerBtn.addEventListener('click', function () {
        window.panChartWindow('newer');
      });
    }

    if (resetZoomBtn) {
      resetZoomBtn.addEventListener('click', function () {
        window.resetChartZoom();
      });
    }
  }

  function initCharts() {
    var gasMeta = loadInitialChartData('gasChart', 'gas');
    if (gasMeta) {
      var riesgoData = JSON.parse(document.getElementById('gasChart').dataset.riesgo || '[]');
      chartDataState.labels = gasMeta.labels.slice();
      chartDataState.gasValues = gasMeta.dataset.slice();
      chartDataState.riesgoValues = riesgoData.slice();
      gasChart = buildGasChart(gasMeta.canvas, gasMeta.labels, gasMeta.dataset, riesgoData);
    }

    var fireMeta = loadInitialChartData('fireChart', 'fire');
    if (fireMeta) {
      chartDataState.fireValues = fireMeta.dataset.slice();
      fireChart = buildBinaryChart(fireMeta.canvas, fireMeta.labels, fireMeta.dataset, 'Incendio', '#c0392b');
    }

    var movementMeta = loadInitialChartData('movementChart', 'movement');
    if (movementMeta) {
      chartDataState.movementValues = movementMeta.dataset.slice();
      movementChart = buildBinaryChart(movementMeta.canvas, movementMeta.labels, movementMeta.dataset, 'Movimiento', '#1e8449');
    }

    if (chartDataState.labels.length === 0) {
      chartDataState.labels = (fireMeta && fireMeta.labels) ? fireMeta.labels.slice() : (movementMeta && movementMeta.labels ? movementMeta.labels.slice() : []);
    }
  }

  window.updateGasChart = function (labels, gasValues, riesgoValues) {
    var colors = riesgoValues.map(function (r) {
      if (r === 'alto') return '#c0392b';
      if (r === 'medio') return '#b7770d';
      return '#1e8449';
    });
    updateChart(gasChart, labels, gasValues, colors);
  };

  window.updateFireChart = function (labels, fireValues) {
    updateChart(fireChart, labels, fireValues);
  };

  window.updateMovementChart = function (labels, movementValues) {
    updateChart(movementChart, labels, movementValues);
  };

  window.updateDashboardCharts = function (labels, gasValues, riesgoValues, fireValues, movementValues) {
    chartDataState.labels = Array.isArray(labels) ? labels.slice() : [];
    chartDataState.gasValues = Array.isArray(gasValues) ? gasValues.slice() : [];
    chartDataState.riesgoValues = Array.isArray(riesgoValues) ? riesgoValues.slice() : [];
    chartDataState.fireValues = Array.isArray(fireValues) ? fireValues.slice() : [];
    chartDataState.movementValues = Array.isArray(movementValues) ? movementValues.slice() : [];

    applyChartsWindow();
  };

  window.setChartWindow = function (size) {
    if (size === 'all') {
      viewWindowSize = 'all';
    } else {
      var parsed = Number(size);
      viewWindowSize = Number.isFinite(parsed) ? Math.max(5, parsed) : 30;
    }

    viewWindowOffset = 0;
    applyChartsWindow();
  };

  window.panChartWindow = function (direction) {
    var total = chartDataState.labels.length;
    if (viewWindowSize === 'all' || total <= Number(viewWindowSize || 0)) {
      return;
    }

    var step = Math.max(1, Math.floor(Number(viewWindowSize) / 3));
    if (direction === 'older') {
      viewWindowOffset += step;
    } else {
      viewWindowOffset -= step;
    }

    var maxOffset = Math.max(0, total - Number(viewWindowSize));
    viewWindowOffset = Math.min(Math.max(0, viewWindowOffset), maxOffset);
    applyChartsWindow();
  };

  window.resetChartZoom = function () {
    [gasChart, fireChart, movementChart].forEach(function (chart) {
      if (chart && typeof chart.resetZoom === 'function') {
        chart.resetZoom();
      }
    });
  };

  initCharts();
  setupChartControls();

  window.updateDashboardCharts(
    chartDataState.labels,
    chartDataState.gasValues,
    chartDataState.riesgoValues,
    chartDataState.fireValues,
    chartDataState.movementValues
  );
}());
