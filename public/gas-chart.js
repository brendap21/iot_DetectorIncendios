// public/gas-chart.js
// Graph helpers for the dashboard: gas, fuego binario y movimiento binario.
// El cliente puede actualizar los tres graficos en vivo usando las funciones
// expuestas en window.
(function () {
  'use strict';

  var gasChart = null;
  var fireChart = null;
  var movementChart = null;

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
    chart.update('none');
  }

  function initCharts() {
    var gasMeta = loadInitialChartData('gasChart', 'gas');
    if (gasMeta) {
      var riesgoData = JSON.parse(document.getElementById('gasChart').dataset.riesgo || '[]');
      gasChart = buildGasChart(gasMeta.canvas, gasMeta.labels, gasMeta.dataset, riesgoData);
    }

    var fireMeta = loadInitialChartData('fireChart', 'fire');
    if (fireMeta) {
      fireChart = buildBinaryChart(fireMeta.canvas, fireMeta.labels, fireMeta.dataset, 'Incendio', '#c0392b');
    }

    var movementMeta = loadInitialChartData('movementChart', 'movement');
    if (movementMeta) {
      movementChart = buildBinaryChart(movementMeta.canvas, movementMeta.labels, movementMeta.dataset, 'Movimiento', '#1e8449');
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
    window.updateGasChart(labels, gasValues, riesgoValues);
    window.updateFireChart(labels, fireValues);
    window.updateMovementChart(labels, movementValues);
  };

  initCharts();
}());
