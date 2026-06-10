(function () {
  'use strict';

  var tableBody = document.getElementById('historyTableBody');
  var statusEl = document.getElementById('historyStatus');
  var sentinel = document.getElementById('historySentinel');

  var riskFilter = document.getElementById('historyRiskFilter');
  var movFilter = document.getElementById('historyMovimientoFilter');
  var flameFilter = document.getElementById('historyLlamaFilter');
  var anomalyFilter = document.getElementById('historyAnomaliaFilter');
  var downloadPdfBtn = document.getElementById('downloadHistoryPdfBtn');

  if (!tableBody || !sentinel) {
    return;
  }

  var PAGE_SIZE = 25;
  var loaded = [];
  var nextBefore = null;
  var hasMore = true;
  var loading = false;

  function setStatus(message) {
    if (statusEl) {
      statusEl.textContent = message || '';
    }
  }

  async function fetchJson(url, options) {
    var response = await fetch(url, options);
    var data = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      throw new Error(data.error || ('HTTP ' + response.status));
    }

    return data;
  }

  function formatDate(value) {
    if (!value) {
      return 'Sin fecha';
    }

    var d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return 'Sin fecha';
    }

    return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  }

  function riesgoTag(riesgo) {
    if (riesgo === 'alto') {
      return '<span class="tag tag-alto">Alto</span>';
    }

    if (riesgo === 'medio') {
      return '<span class="tag tag-medio">Medio</span>';
    }

    return '<span class="tag tag-normal">Normal</span>';
  }

  function rowHtml(item) {
    var llamaTxt = item.llama === 1 ? 'Si' : 'No';
    var movTxt = item.movimiento === 1 ? 'Si' : 'No';
    var anomaliaTxt = item.anomalia === true ? 'Si' : item.anomalia === false ? 'No' : '-';
    var tendencia = item.prediccion_gas || '-';

    return '<tr>' +
      '<td>' + formatDate(item.fecha) + '</td>' +
      '<td class="' + (item.llama === 1 ? 'val-alerta' : '') + '">' + llamaTxt + '</td>' +
      '<td>' + (item.gas ?? '-') + '</td>' +
      '<td>' + movTxt + '</td>' +
      '<td>' + riesgoTag(item.riesgo || 'normal') + '</td>' +
      '<td class="' + (item.anomalia === true ? 'val-alerta' : '') + '">' + anomaliaTxt + '</td>' +
      '<td>' + tendencia + '</td>' +
    '</tr>';
  }

  function passesFilters(item) {
    if (riskFilter && riskFilter.value !== 'all' && (item.riesgo || 'normal') !== riskFilter.value) {
      return false;
    }

    if (movFilter && movFilter.value !== 'all' && String(item.movimiento) !== movFilter.value) {
      return false;
    }

    if (flameFilter && flameFilter.value !== 'all' && String(item.llama) !== flameFilter.value) {
      return false;
    }

    if (anomalyFilter && anomalyFilter.value !== 'all') {
      var val = anomalyFilter.value === 'true';
      if (Boolean(item.anomalia) !== val) {
        return false;
      }
    }

    return true;
  }

  function renderHistory() {
    var filtered = loaded.filter(passesFilters);

    if (filtered.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:24px;">No hay lecturas para el filtro actual.</td></tr>';
    } else {
      tableBody.innerHTML = filtered.map(rowHtml).join('');
    }

    var base = 'Mostrando ' + filtered.length + ' de ' + loaded.length + ' lecturas cargadas.';
    var tail = hasMore ? ' Desplazate hacia abajo para cargar mas.' : ' Ya no hay mas registros.';
    setStatus(base + tail);
  }

  async function loadNextPage() {
    if (loading || !hasMore) {
      return;
    }

    loading = true;
    setStatus('Cargando historial...');

    try {
      var url = '/api/sensores/ultimas?limit=' + PAGE_SIZE;
      if (nextBefore) {
        url += '&before=' + encodeURIComponent(nextBefore);
      }

      var data = await fetchJson(url);
      var lecturas = Array.isArray(data.lecturas) ? data.lecturas : [];
      var page = data.page || {};

      loaded = loaded.concat(lecturas);
      nextBefore = page.nextBefore || null;
      hasMore = Boolean(page.hasMore && nextBefore);

      renderHistory();
    } catch (error) {
      setStatus('No fue posible cargar historial: ' + error.message);
    } finally {
      loading = false;
    }
  }

  async function fetchAllHistory() {
    var cursor = null;
    var all = [];

    while (true) {
      var url = '/api/sensores/ultimas?limit=100';
      if (cursor) {
        url += '&before=' + encodeURIComponent(cursor);
      }

      var data = await fetchJson(url);
      var batch = Array.isArray(data.lecturas) ? data.lecturas : [];
      all = all.concat(batch);

      var page = data.page || {};
      if (!(page.hasMore && page.nextBefore)) {
        break;
      }

      cursor = page.nextBefore;
    }

    return all;
  }

  function toPdfLine(item) {
    var fecha = formatDate(item.fecha);
    var llama = item.llama === 1 ? 'SI' : 'NO';
    var mov = item.movimiento === 1 ? 'SI' : 'NO';
    var riesgo = (item.riesgo || 'normal').toUpperCase();
    var an = item.anomalia === true ? 'SI' : 'NO';
    var gas = Number.isFinite(Number(item.gas)) ? Number(item.gas) : '-';
    var tendencia = item.prediccion_gas || '-';

    return fecha + ' | Llama:' + llama + ' | Gas:' + gas + ' | Mov:' + mov + ' | Riesgo:' + riesgo + ' | Anom:' + an + ' | Tend:' + tendencia;
  }

  async function downloadPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('No se pudo cargar la libreria PDF.');
      return;
    }

    if (downloadPdfBtn) {
      downloadPdfBtn.disabled = true;
      downloadPdfBtn.textContent = 'Generando PDF...';
    }

    try {
      var allData = await fetchAllHistory();
      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      var marginX = 10;
      var y = 12;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Historial completo de lecturas IoT', marginX, y);

      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Generado: ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }), marginX, y);

      y += 6;
      doc.text('Total registros: ' + allData.length, marginX, y);
      y += 6;

      doc.setFontSize(8);
      allData.forEach(function (item, index) {
        var line = (index + 1) + '. ' + toPdfLine(item);
        var wrapped = doc.splitTextToSize(line, 275);

        if (y + wrapped.length * 4 > 200) {
          doc.addPage();
          y = 12;
        }

        doc.text(wrapped, marginX, y);
        y += wrapped.length * 4;
      });

      doc.save('historial_iot_completo.pdf');
    } catch (error) {
      alert('No fue posible generar PDF: ' + error.message);
    } finally {
      if (downloadPdfBtn) {
        downloadPdfBtn.disabled = false;
        downloadPdfBtn.textContent = 'Descargar todo en PDF';
      }
    }
  }

  function setupObserver() {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          loadNextPage().catch(function () { return null; });
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px 350px 0px',
      threshold: 0,
    });

    observer.observe(sentinel);
  }

  function setupFilters() {
    [riskFilter, movFilter, flameFilter, anomalyFilter].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', function () {
        renderHistory();
      });
    });

    if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener('click', function () {
        downloadPdf().catch(function (error) {
          alert('No fue posible generar PDF: ' + error.message);
        });
      });
    }
  }

  async function init() {
    setupFilters();
    setupObserver();
    await loadNextPage();
  }

  init().catch(function (error) {
    setStatus('Error inicializando historial: ' + error.message);
  });
}());
