// public/gas-chart.js
// Reads pre-serialized sensor data from data-* attributes on the canvas element
// so that no inline script is required (keeps Content-Security-Policy 'self' compliant).
(function () {
  'use strict';

  const canvas = document.getElementById('gasChart');
  if (!canvas) return;

  const rawLabels = JSON.parse(canvas.dataset.labels || '[]');
  const rawGas    = JSON.parse(canvas.dataset.gas    || '[]');
  const rawRiesgo = JSON.parse(canvas.dataset.riesgo || '[]');

  // Color each data point by its risk level so anomalies stand out immediately.
  const pointColors = rawRiesgo.map(function (r) {
    if (r === 'alto')  return '#c0392b';
    if (r === 'medio') return '#b7770d';
    return '#1e8449';
  });

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: rawLabels,
      datasets: [{
        label: 'Gas (ADC)',
        data: rawGas,
        borderColor: '#3c6bce',
        backgroundColor: 'rgba(60,107,206,0.08)',
        pointBackgroundColor: pointColors,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.3,
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
              return 'Riesgo: ' + rawRiesgo[ctx.dataIndex];
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
}());
