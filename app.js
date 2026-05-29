// app.js - build and export Express application (middleware, routes, error handlers)
require('dotenv').config();const path    = require('path');const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const sensoresRoutes = require('./routes/sensores.routes');
const logger = require('./logger');
const { db, isFirebaseConfigured, firebaseInitError } = require('./firebase');

const app = express();

// Security headers — CSP permits the jsDelivr CDN (for Chart.js) and same-origin
// scripts only. No unsafe-inline or unsafe-eval allowed.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// Serve the static chart helper from /public
app.use(express.static(path.join(__dirname, 'public')));

// CORS
app.use(cors());

// JSON body parser
app.use(express.json());

// Simple request logger (method, path, small body preview)
app.use((req, res, next) => {
  const bodyPreview = req.body && Object.keys(req.body).length ? JSON.stringify(req.body).slice(0, 200) : '';
  const remote = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  const hdrs = { host: req.headers.host, 'x-forwarded-for': req.headers['x-forwarded-for'] };
  logger.info('Incoming request', req.method, req.originalUrl, { remote, headers: hdrs, bodyPreview });
  next();
});

// Rate limiting
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: {
      ok: false,
      error: 'Demasiadas peticiones'
    }
  })
);

// Health routes
app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'IoT Detector Incendios',
    status: 'online',
    pid: process.pid,
    uptime: process.uptime(),
    firebaseConfigured: Boolean(isFirebaseConfigured),
    firebaseError: firebaseInitError ? (firebaseInitError.message || String(firebaseInitError)) : null,
    resultadosUrl: '/resultados'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/**
 * Returns the CSS class and display text for a risk level string.
 * @param {string|null} riesgo
 * @returns {{ cls: string, texto: string }}
 */
function riesgoMeta(riesgo) {
  switch (riesgo) {
    case 'alto':  return { cls: 'tag-alto',   texto: 'Alto' };
    case 'medio': return { cls: 'tag-medio',  texto: 'Medio' };
    default:      return { cls: 'tag-normal', texto: 'Normal' };
  }
}

/**
 * Produces a one-sentence human-readable interpretation of the latest reading.
 * Shown prominently above the table so the state is immediately understandable.
 *
 * @param {{ llama:number, gas:number, movimiento:number, riesgo:string, anomalia:boolean, prediccion_gas:string }|undefined} ultima
 * @returns {string} HTML string
 */
function interpretarEstado(ultima) {
  if (!ultima) return '<p class="interp">Sin datos todavia.</p>';

  const partes = [];

  if (ultima.llama === 1) {
    partes.push('Se detecto llama.');
  } else {
    partes.push('No se detecta llama.');
  }

  partes.push(`Gas: ${ultima.gas} ADC.`);

  if (ultima.prediccion_gas === 'subiendo') {
    partes.push('La concentracion de gas va en aumento.');
  } else if (ultima.prediccion_gas === 'bajando') {
    partes.push('La concentracion de gas esta bajando.');
  } else {
    partes.push('Nivel de gas estable.');
  }

  // movimiento=0 means motion detected (inverted PIR from main.cpp)
  if (ultima.movimiento === 0) {
    partes.push('Hay movimiento en el area.');
  }

  if (ultima.anomalia) {
    partes.push('La lectura es estadisticamente anomala respecto al historico.');
  }

  const { cls, texto } = riesgoMeta(ultima.riesgo);
  return `
    <div class="interp-wrap">
      <span class="tag ${cls}">${texto}</span>
      <p class="interp">${partes.join(' ')}</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Page renderer
// ---------------------------------------------------------------------------

function renderResultadosPage(lecturas, meta) {
  const ultima = lecturas[0];

  const rows = lecturas.map((lectura) => {
    const { cls, texto } = riesgoMeta(lectura.riesgo);
    const movDetectado   = lectura.movimiento === 0 ? 'Si' : 'No';
    const anomalia       = lectura.anomalia === true ? 'Si' : lectura.anomalia === false ? 'No' : '-';
    const tendencia      = lectura.prediccion_gas ?? '-';
    const fecha          = lectura.fecha ? new Date(lectura.fecha).toLocaleString('es-MX') : 'Sin fecha';

    return `
    <tr>
      <td>${fecha}</td>
      <td class="${lectura.llama === 1 ? 'val-alerta' : ''}">${lectura.llama === 1 ? 'Si' : 'No'}</td>
      <td>${lectura.gas ?? '-'}</td>
      <td>${movDetectado}</td>
      <td><span class="tag ${cls}">${texto}</span></td>
      <td class="${lectura.anomalia === true ? 'val-alerta' : ''}">${anomalia}</td>
      <td>${tendencia}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="10" />
  <title>Monitor IoT - Detector de Incendios</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
      min-height: 100vh;
    }

    /* ---- header ---- */
    header {
      background: #1a1a2e;
      color: #fff;
      padding: 18px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    header h1 { font-size: 20px; font-weight: 600; letter-spacing: 0.02em; }
    header span { font-size: 13px; color: #aab; }

    /* ---- layout ---- */
    main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 48px; }

    /* ---- section titles ---- */
    h2 { font-size: 14px; font-weight: 600; text-transform: uppercase;
         letter-spacing: 0.08em; color: #555; margin: 28px 0 12px; }

    /* ---- sensor cards ---- */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
    }
    .card {
      background: #fff;
      border: 1px solid #e0e0e8;
      border-radius: 10px;
      padding: 16px 20px;
    }
    .card .c-label { font-size: 12px; color: #888; margin-bottom: 6px; }
    .card .c-value { font-size: 26px; font-weight: 700; color: #1a1a2e; }
    .card .c-unit  { font-size: 12px; color: #aaa; margin-top: 2px; }
    .card.alerta   { border-color: #e74c3c; background: #fff5f5; }
    .card.alerta .c-value { color: #c0392b; }

    /* ---- interpretacion ---- */
    .interp-wrap {
      background: #fff;
      border: 1px solid #e0e0e8;
      border-radius: 10px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }
    .interp { font-size: 15px; color: #333; line-height: 1.6; }

    /* ---- tags ---- */
    .tag {
      display: inline-block;
      padding: 3px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    .tag-normal { background: #e8f8f0; color: #1e8449; border: 1px solid #a9dfbf; }
    .tag-medio  { background: #fef9e7; color: #b7770d; border: 1px solid #f9e79f; }
    .tag-alto   { background: #fdf2f2; color: #c0392b; border: 1px solid #f5b7b1; }

    /* ---- table ---- */
    .table-wrap {
      background: #fff;
      border: 1px solid #e0e0e8;
      border-radius: 10px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; min-width: 680px; }
    thead tr { background: #f7f8fa; }
    th {
      padding: 11px 16px;
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #777;
      border-bottom: 1px solid #e8e8ee;
    }
    td {
      padding: 11px 16px;
      font-size: 14px;
      color: #333;
      border-bottom: 1px solid #f0f0f5;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafbff; }
    td.val-alerta { color: #c0392b; font-weight: 600; }

    /* ---- chart ---- */
    .chart-wrap {
      background: #fff;
      border: 1px solid #e0e0e8;
      border-radius: 10px;
      padding: 20px 20px 16px;
    }
    .chart-wrap canvas { display: block; width: 100% !important; height: 220px !important; }

    /* ---- footer ---- */
    footer {
      margin-top: 32px;
      font-size: 13px;
      color: #888;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    footer a { color: #3c6bce; text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>Monitor IoT — Detector de Incendios</h1>
    <span>Actualiza cada 10 s &nbsp;|&nbsp; ${new Date().toLocaleString('es-MX')}</span>
  </header>

  <main>

    <h2>Ultima lectura</h2>
    <div class="cards">
      <div class="card ${ultima && ultima.llama === 1 ? 'alerta' : ''}">
        <div class="c-label">Llama</div>
        <div class="c-value">${ultima ? (ultima.llama === 1 ? 'Si' : 'No') : '-'}</div>
        <div class="c-unit">KY-026</div>
      </div>
      <div class="card">
        <div class="c-label">Gas</div>
        <div class="c-value">${ultima ? ultima.gas : '-'}</div>
        <div class="c-unit">ADC (0-4095)</div>
      </div>
      <div class="card">
        <div class="c-label">Movimiento</div>
        <div class="c-value">${ultima ? (ultima.movimiento === 0 ? 'Si' : 'No') : '-'}</div>
        <div class="c-unit">PIR</div>
      </div>
      <div class="card">
        <div class="c-label">Lecturas cargadas</div>
        <div class="c-value">${meta.count}</div>
        <div class="c-unit">ultimas 20</div>
      </div>
    </div>

    <h2>Analisis ML</h2>
    ${interpretarEstado(ultima)}

    <h2>Gas en el tiempo</h2>
    <div class="chart-wrap">
      <canvas id="gasChart"
        data-labels='${JSON.stringify(lecturas.slice().reverse().map(l => l.fecha ? new Date(l.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""))}'
        data-gas='${JSON.stringify(lecturas.slice().reverse().map(l => l.gas ?? null))}'
        data-riesgo='${JSON.stringify(lecturas.slice().reverse().map(l => l.riesgo ?? "normal"))}'
      ></canvas>
    </div>

    <h2>Historial</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Llama</th>
            <th>Gas (ADC)</th>
            <th>Movimiento</th>
            <th>Nivel de riesgo</th>
            <th>Anomalia</th>
            <th>Tendencia gas</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:24px;">Sin lecturas guardadas.</td></tr>'}
        </tbody>
      </table>
    </div>

  </main>

  <footer>
    <span>Proyecto IoT — CETI 7mo semestre</span>
    <a href="/api/sensores/ultimas" target="_blank" rel="noreferrer">Ver JSON completo</a>
  </footer>
  <!-- Chart.js from jsDelivr (allowed by CSP) and the chart init script served from /public -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="/gas-chart.js"></script>
</body>
</html>`;
}

app.get('/resultados', async (req, res, next) => {
  try {
    if (!isFirebaseConfigured || !db) {
      return res.status(503).send('<pre>Firebase no está configurado en este entorno</pre>');
    }

    const snapshot = await db.collection('lecturas')
      .orderBy('fecha', 'desc')
      .limit(20)
      .get();

    const lecturas = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const fecha = data.fecha && typeof data.fecha.toDate === 'function'
        ? data.fecha.toDate().toISOString()
        : (data.fecha ? new Date(data.fecha).toISOString() : null);

      return {
        id: doc.id,
        llama: data.llama,
        gas: data.gas,
        movimiento: data.movimiento,
        fecha,
        riesgo:        data.riesgo        ?? null,
        anomalia:      data.anomalia      ?? null,
        prediccion_gas: data.prediccion_gas ?? null,
      };
    });

    res.status(200).send(renderResultadosPage(lecturas, { count: lecturas.length }));
  } catch (err) {
    next(err);
  }
});

// API routes
app.use('/api/sensores', sensoresRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  const reqCtx = {
    method: req.method,
    url: req.originalUrl,
    remote: req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip,
    headers: {
      host: req.headers.host,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-railway-request-id': req.headers['x-railway-request-id'] || req.headers['x-request-id']
    }
  };

  logger.error('Unhandled error in request', {
    message: err && err.message,
    stack: err && err.stack,
    request: reqCtx
  });

  // Respond with generic message but include source so we can differentiate
  res.status(500).json({ ok: false, error: 'Error interno', source: 'app:error-handler' });
});

module.exports = app;
