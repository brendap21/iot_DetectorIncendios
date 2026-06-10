// app.js - build and export Express application (middleware, routes, error handlers)
require('dotenv').config();const path    = require('path');const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const sensoresRoutes = require('./routes/sensores.routes');
const alertasRoutes = require('./routes/alertas.routes');
const logger = require('./logger');
const { db, isFirebaseConfigured, firebaseInitError } = require('./firebase');
const runtimeStore = require('./services/runtime-store.service');

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
      connectSrc:  ["'self'", 'https://cdn.jsdelivr.net'],
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

  // Estandar de todo el sistema: 1 = movimiento detectado.
  if (ultima.movimiento === 1) {
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
    const movDetectado   = lectura.movimiento === 1 ? 'Si' : 'No';
    const anomalia       = lectura.anomalia === true ? 'Si' : lectura.anomalia === false ? 'No' : '-';
    const tendencia      = lectura.prediccion_gas ?? '-';
    const fecha          = lectura.fecha ? new Date(lectura.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Sin fecha';

    return `
    <tr>
      <td data-label="Fecha">${fecha}</td>
      <td data-label="Llama" class="${lectura.llama === 1 ? 'val-alerta' : ''}">${lectura.llama === 1 ? 'Si' : 'No'}</td>
      <td data-label="Gas (ADC)">${lectura.gas ?? '-'}</td>
      <td data-label="Movimiento">${movDetectado}</td>
      <td data-label="Nivel de riesgo"><span class="tag ${cls}">${texto}</span></td>
      <td data-label="Anomalia" class="${lectura.anomalia === true ? 'val-alerta' : ''}">${anomalia}</td>
      <td data-label="Tendencia gas">${tendencia}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#1a1a2e" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>Monitor IoT - Detector de Incendios</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f4f7fc;
      --ink: #1a1a2e;
      --muted: #5f6780;
      --panel: #ffffff;
      --line: #dbe2ef;
      --primary: #2f5fbf;
      --shadow: 0 8px 22px rgba(20, 35, 70, 0.08);
      --radius: 12px;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background:
        radial-gradient(1200px 420px at 10% -10%, rgba(47,95,191,0.15), transparent 70%),
        radial-gradient(900px 300px at 100% 0, rgba(20,30,60,0.1), transparent 70%),
        var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }

    /* ---- header ---- */
    header {
      background: linear-gradient(110deg, #17243f 0%, #1f2f57 100%);
      color: #fff;
      padding: 16px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      box-shadow: var(--shadow);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    header h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.01em; }
    header span { font-size: 12px; color: #d3dcf1; }

    .header-left {
      display: grid;
      gap: 2px;
    }
    .header-right {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      position: relative;
    }
    .notif-wrap {
      position: relative;
    }
    .notif-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      width: min(380px, 90vw);
      max-height: 420px;
      overflow: auto;
      background: #fff;
      border: 1px solid #d5ddf0;
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 10px;
      display: none;
      z-index: 30;
    }
    .notif-menu.open {
      display: block;
    }
    .notif-menu h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #4d587a;
      margin-bottom: 8px;
    }
    .notif-menu ul {
      list-style: none;
      display: grid;
      gap: 8px;
    }
    .notif-menu li {
      border-left: 4px solid #d0d6e6;
      background: #f8faff;
      padding: 10px 12px;
      border-radius: 6px;
      color: #23304f;
    }
    .notif-menu li.high { border-left-color: #d68910; }
    .notif-menu li.critical { border-left-color: #c0392b; }
    .notif-menu .meta {
      color: #667;
      font-size: 12px;
      margin-top: 4px;
    }
    .notif-status {
      font-size: 12px;
      color: #6a7390;
      margin-bottom: 8px;
    }

    /* ---- layout ---- */
    main { max-width: 1120px; margin: 0 auto; padding: 24px 18px 52px; }

    .section-nav {
      position: sticky;
      top: 72px;
      z-index: 15;
      margin: 14px auto 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(8px);
      border: 1px solid #d7deef;
      border-radius: 999px;
      padding: 8px;
      box-shadow: var(--shadow);
      width: fit-content;
      max-width: 100%;
    }
    .section-link {
      text-decoration: none;
      color: #2b3a62;
      border: 1px solid #d6def1;
      background: #f4f7ff;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .section-link:hover {
      background: #e9f0ff;
    }
    .section {
      scroll-margin-top: 136px;
    }
    .section-hint {
      font-size: 12px;
      color: #667;
      margin: -6px 0 10px;
    }

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
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px 20px;
      box-shadow: var(--shadow);
    }
    .card .c-label { font-size: 12px; color: #888; margin-bottom: 6px; }
    .card .c-value { font-size: 26px; font-weight: 700; color: #1a1a2e; }
    .card .c-unit  { font-size: 12px; color: #aaa; margin-top: 2px; }
    .card.alerta   { border-color: #e74c3c; background: #fff5f5; }
    .card.alerta .c-value { color: #c0392b; }

    /* ---- interpretacion ---- */
    .interp-wrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
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
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow-x: auto;
      box-shadow: var(--shadow);
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
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 20px 20px 16px;
      box-shadow: var(--shadow);
    }
    .chart-wrap canvas { display: block; width: 100% !important; height: 220px !important; }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    .actions-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filters-row {
      margin-top: 10px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter {
      background: #fff;
      border: 1px solid #d9deec;
      border-radius: 8px;
      padding: 8px 10px;
      color: #223;
      font-size: 13px;
    }
    .filter-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #334;
      background: #fff;
      border: 1px solid #d9deec;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .btn {
      border: none;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-secondary { background: #efeff5; color: #1a1a2e; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn:disabled:hover { transform: none; }

    .btn-notif {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.24);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .notif-badge {
      min-width: 18px;
      height: 18px;
      border-radius: 999px;
      padding: 0 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      line-height: 1;
      background: #d92b2b;
      color: #fff;
      font-weight: 800;
    }

    .alerts-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px 18px;
      box-shadow: var(--shadow);
    }
    .alerts-panel ul { list-style: none; display: grid; gap: 8px; }
    .alerts-panel li {
      border-left: 4px solid #d0d6e6;
      background: #fafbff;
      padding: 10px 12px;
      border-radius: 6px;
    }
    .alerts-panel li.high { border-left-color: #d68910; }
    .alerts-panel li.critical { border-left-color: #c0392b; }
    .alerts-panel .meta { color: #667; font-size: 12px; }
    .alert-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }
    .badge-state {
      display: inline-block;
      font-size: 11px;
      border-radius: 999px;
      padding: 3px 9px;
      border: 1px solid #d5d9e8;
      color: #556;
      background: #f4f6fb;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-state.read {
      background: #e8f8f0;
      color: #1e8449;
      border-color: #a9dfbf;
    }
    .btn-mark-read {
      border: 1px solid #cbd3e6;
      background: #fff;
      color: #2e3a59;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-mark-read:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .history-tools {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin: 10px 0 14px;
      align-items: end;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 12px;
    }
    .history-tools .wide { grid-column: span 2; }
    .history-tools .btn { width: 100%; }
    .history-status {
      font-size: 12px;
      color: #667;
      margin-top: 10px;
      min-height: 18px;
    }
    .history-sentinel {
      height: 10px;
    }

    @media (max-width: 740px) {
      body {
        font-size: 15px;
      }

      header {
        padding: 12px;
        gap: 10px;
      }
      header h1 {
        font-size: 17px;
      }
      header span {
        font-size: 11px;
      }

      .header-left,
      .header-right {
        width: 100%;
      }
      .header-right {
        justify-content: space-between;
      }

      .btn,
      .filter,
      .filter-check {
        min-height: 42px;
      }

      .btn-notif {
        flex: 1;
        justify-content: center;
      }

      main {
        padding: 14px 10px 36px;
      }

      .section-nav {
        top: 110px;
        width: 100%;
        overflow-x: auto;
        flex-wrap: nowrap;
        justify-content: flex-start;
        border-radius: 12px;
        scrollbar-width: thin;
      }
      .section-link {
        white-space: nowrap;
        flex: 0 0 auto;
      }

      .cards {
        grid-template-columns: 1fr;
      }
      .card {
        padding: 14px;
      }
      .card .c-value {
        font-size: 24px;
      }

      .actions,
      .actions-row,
      .filters-row,
      .history-tools {
        width: 100%;
      }
      .actions-row,
      .filters-row {
        flex-direction: column;
        align-items: stretch;
      }
      .actions-row .btn,
      .filters-row .filter,
      .history-tools .btn,
      .history-tools select {
        width: 100%;
      }

      .history-tools {
        grid-template-columns: 1fr;
      }
      .history-tools .wide {
        grid-column: span 1;
      }

      .notif-menu {
        right: auto;
        left: 0;
        width: min(94vw, 430px);
        max-height: 60vh;
      }

      .table-wrap {
        overflow: visible;
      }
      table {
        min-width: 0;
      }
      thead {
        display: none;
      }
      tbody,
      tr,
      td {
        display: block;
        width: 100%;
      }
      tr {
        border: 1px solid #d9e1f1;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 4px 12px rgba(20, 35, 70, 0.06);
        margin-bottom: 10px;
        padding: 8px 10px;
      }
      td {
        border: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        font-size: 13px;
      }
      td::before {
        content: attr(data-label);
        color: #55607f;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      td .tag {
        margin-left: auto;
      }
    }

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
    <div class="header-left">
      <h1>Monitor IoT — Detector de Incendios</h1>
      <span>Actualiza cada 10 s · ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span>
    </div>
    <div class="header-right">
      <button id="navbarEnablePushBtn" class="btn btn-primary">Activar notificaciones</button>
      <div class="notif-wrap">
        <button id="notifBellBtn" class="btn btn-notif" aria-label="Abrir notificaciones">
          Notificaciones
          <span id="notifBadge" class="notif-badge">0</span>
        </button>
        <div id="navbarNotifMenu" class="notif-menu" role="dialog" aria-label="Panel de notificaciones">
          <h3>Notificaciones</h3>
          <div id="notifStatus" class="notif-status">Sin novedades</div>
          <ul id="navbarNotifList"></ul>
        </div>
      </div>
    </div>
  </header>

  <main>
    <nav class="section-nav" aria-label="Navegacion de secciones">
      <a class="section-link" href="#sec-resumen">Resumen</a>
      <a class="section-link" href="#sec-alertas">Alertas</a>
      <a class="section-link" href="#sec-grafica">Grafica</a>
      <a class="section-link" href="#sec-historial">Historial</a>
    </nav>

    <section id="sec-resumen" class="section">
    <h2>Ultima lectura</h2>
    <p class="section-hint">Vista rapida del estado actual de sensores.</p>
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
        <div class="c-value">${ultima ? (ultima.movimiento === 1 ? 'Si' : 'No') : '-'}</div>
        <div class="c-unit">PIR</div>
      </div>
      <div class="card">
        <div class="c-label">Lecturas cargadas</div>
        <div class="c-value">${meta.count}</div>
        <div class="c-unit">ultimas 20</div>
      </div>
    </div>

    <h2>Analisis ML</h2>
    <p class="section-hint">Interpretacion automatica y acciones de monitoreo.</p>
    ${interpretarEstado(ultima)}
    <div class="actions">
      <div class="actions-row">
        <button id="installAppBtn" class="btn btn-secondary" disabled>Instalar Web App</button>
      </div>
      <div class="filters-row">
        <select id="severityFilter" class="filter" aria-label="Filtrar severidad">
          <option value="all">Todas las severidades</option>
          <option value="critical">Solo criticas</option>
          <option value="high">Solo altas</option>
          <option value="medium">Solo medias</option>
        </select>
        <label class="filter-check" for="onlyUnreadAlerts">
          <input id="onlyUnreadAlerts" type="checkbox" />
          Solo no leidas
        </label>
      </div>
    </div>
    </section>

    <section id="sec-alertas" class="section">
    <h2>Alertas recientes</h2>
    <p class="section-hint">Lista de eventos recientes. Puedes marcarlos como leidos.</p>
    <div class="alerts-panel">
      <ul id="alertsList">
        <li><strong>Sin alertas nuevas</strong><div class="meta">Activa notificaciones para recibir eventos en tu celular.</div></li>
      </ul>
    </div>
    </section>

    <section id="sec-grafica" class="section">
    <h2>Gas en el tiempo</h2>
    <p class="section-hint">Evolucion de gas en las ultimas lecturas.</p>
    <div class="chart-wrap">
      <canvas id="gasChart"
        data-labels='${JSON.stringify(lecturas.slice().reverse().map(l => l.fecha ? new Date(l.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" }) : ""))}'
        data-gas='${JSON.stringify(lecturas.slice().reverse().map(l => l.gas ?? null))}'
        data-riesgo='${JSON.stringify(lecturas.slice().reverse().map(l => l.riesgo ?? "normal"))}'
      ></canvas>
    </div>
    </section>

    <section id="sec-historial" class="section">
    <h2>Historial</h2>
    <p class="section-hint">Filtra, revisa y exporta todas las lecturas.</p>
    <div class="history-tools">
      <select id="historyRiskFilter" class="filter" aria-label="Filtrar riesgo en historial">
        <option value="all">Riesgo: todos</option>
        <option value="normal">Riesgo normal</option>
        <option value="medio">Riesgo medio</option>
        <option value="alto">Riesgo alto</option>
      </select>
      <select id="historyMovimientoFilter" class="filter" aria-label="Filtrar movimiento en historial">
        <option value="all">Movimiento: todos</option>
        <option value="1">Con movimiento</option>
        <option value="0">Sin movimiento</option>
      </select>
      <select id="historyLlamaFilter" class="filter" aria-label="Filtrar llama en historial">
        <option value="all">Llama: todos</option>
        <option value="1">Con llama</option>
        <option value="0">Sin llama</option>
      </select>
      <select id="historyAnomaliaFilter" class="filter" aria-label="Filtrar anomalia en historial">
        <option value="all">Anomalia: todas</option>
        <option value="true">Solo anomalia</option>
        <option value="false">Sin anomalia</option>
      </select>
      <button id="downloadHistoryPdfBtn" class="btn btn-secondary wide">Descargar todo en PDF</button>
    </div>
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
        <tbody id="historyTableBody">
          ${rows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:24px;">Sin lecturas guardadas.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="historyStatus" class="history-status"></div>
    <div id="historySentinel" class="history-sentinel" aria-hidden="true"></div>
    </section>

  </main>

  <footer>
    <span>Proyecto IoT — CETI 7mo semestre</span>
    <a href="/api/sensores/ultimas" target="_blank" rel="noreferrer">Ver JSON completo</a>
  </footer>
  <!-- Chart.js from jsDelivr (allowed by CSP) and the chart init script served from /public -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
  <script src="/gas-chart.js"></script>
  <script src="/pwa-client.js"></script>
  <script src="/history-view.js"></script>
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
    const msg = err && err.message ? String(err.message) : '';
    const quotaExceeded = msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded');

    if (quotaExceeded) {
      logger.warn('Firestore quota exceeded on /resultados. Serving runtime cache fallback.');
      const fallback = runtimeStore.listLecturas({
        limit: 20,
        before: null,
        filters: {
          riesgo: null,
          movimiento: null,
          llama: null,
          anomalia: null,
        },
      });

      return res.status(200).send(renderResultadosPage(fallback.lecturas, {
        count: fallback.lecturas.length,
      }));
    }

    next(err);
  }
});

// API routes
app.use('/api/sensores', sensoresRoutes);
app.use('/api/alertas', alertasRoutes);

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
