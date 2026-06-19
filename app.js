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
const { obtenerEstadisticasLecturas } = require('./services/data.service');
const {
  isAdafruitConfigured,
  getConfig: getAdafruitConfig,
  obtenerLecturasAdafruit,
  obtenerEstadisticasAdafruit,
} = require('./services/adafruit-io.service');

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
    max: Number(process.env.RATE_LIMIT_PER_MINUTE || 600),
    skip: (req) => {
      return req.path === '/api/sensores/ultimas'
        || req.path === '/api/alertas/ultimas'
        || req.path.startsWith('/api/alertas/');
    },
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
    adafruitConfigured: isAdafruitConfigured(),
    adafruitFeed: isAdafruitConfigured() ? getAdafruitConfig().feedKey : null,
    resultadosUrl: '/resultados'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
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

  const evidencia = [];
  const probabilidad = Number(ultima.probabilidad || 0);

  if (ultima.llama === 1) {
    evidencia.push('llama detectada');
  } else {
    evidencia.push('sin llama');
  }

  evidencia.push(`gas ${ultima.gas} ADC`);

  if (ultima.prediccion_gas === 'subiendo') {
    evidencia.push('gas subiendo');
  } else if (ultima.prediccion_gas === 'bajando') {
    evidencia.push('gas bajando');
  } else {
    evidencia.push('gas estable');
  }

  // Estandar de todo el sistema: 1 = movimiento detectado.
  if (ultima.movimiento === 1) {
    evidencia.push('movimiento detectado');
  } else {
    evidencia.push('sin movimiento');
  }

  if (ultima.anomalia) {
    evidencia.push('anomalia ML');
  }

  const { cls, texto } = riesgoMeta(ultima.riesgo);
  const accion = ultima.riesgo === 'alto'
    ? 'Revisa el area de inmediato y corta fuentes de ignicion si es seguro hacerlo.'
    : ultima.riesgo === 'medio'
      ? 'Mantente atento y verifica ventilacion, gas y presencia cercana.'
      : 'Mantener monitoreo.';

  return `
    <div class="interp-wrap">
      <span class="tag ${cls}">${texto}</span>
      <div class="interp">
        <strong>Lectura interpretada:</strong> ${evidencia.join(' · ')}.
        <br><strong>Probabilidad ML:</strong> ${Math.round(probabilidad * 100)}%.
        <br><strong>Accion sugerida:</strong> ${accion}
      </div>
    </div>`;
}

function prioridadResumen(ultima) {
  if (!ultima) {
    return {
      cls: 'priority-normal',
      titulo: 'Sin datos recientes',
      mensaje: 'En cuanto llegue una lectura nueva, el panel mostrara el nivel de prioridad.',
    };
  }

  const prob = Number(ultima.probabilidad || 0);
  const gas = Number(ultima.gas || 0);

  if (String(ultima.riesgo || '').toLowerCase() === 'alto' || Number(ultima.llama) === 1 || prob >= 0.75 || gas >= 1800) {
    return {
      cls: 'priority-critical',
      titulo: 'Prioridad maxima: revisar de inmediato',
      mensaje: 'Se detecto una condicion de amenaza. Verifica el area ahora y sigue el protocolo de seguridad.',
    };
  }

  if (String(ultima.riesgo || '').toLowerCase() === 'medio' || prob >= 0.55 || gas >= 1100) {
    return {
      cls: 'priority-warning',
      titulo: 'Atencion requerida',
      mensaje: 'Hay una senal que puede evolucionar a riesgo alto. Mantente atento y valida ventilacion y entorno.',
    };
  }

  return {
    cls: 'priority-normal',
    titulo: 'Estado estable',
    mensaje: 'No se detectan amenazas inmediatas. Continua el monitoreo normal.',
  };
}

function renderMlEvaluationModal() {
  return `
  <div id="mlResultsModal" class="ml-modal" aria-hidden="true">
    <div class="ml-modal__backdrop" data-ml-close></div>
    <section class="ml-modal__panel" role="dialog" aria-modal="true" aria-labelledby="mlResultsTitle">
      <div class="ml-modal__header">
        <div>
          <p class="ml-kicker">Evaluacion con lecturas reales</p>
          <h3 id="mlResultsTitle">Análisis de Machine Learning - 3 Niveles de Validación</h3>
        </div>
        <button type="button" class="ml-modal__close" data-ml-close aria-label="Cerrar resultados ML">Cerrar</button>
      </div>

      <div class="ml-tabs">
        <div class="ml-tabs__nav" role="tablist">
          <button class="ml-tab-btn ml-tab-btn--active" data-tab="baseline" role="tab" aria-selected="true" aria-controls="baseline-panel">
            Baseline (Entrenamiento)
          </button>
          <button class="ml-tab-btn" data-tab="pseudo" role="tab" aria-selected="false" aria-controls="pseudo-panel">
            Pseudo-Evaluación (Tiempo Real)
          </button>
          <button class="ml-tab-btn" data-tab="real" role="tab" aria-selected="false" aria-controls="real-panel">
            Validación Real (Confirmaciones)
          </button>
        </div>

        <div class="ml-tabs__content">
          <!-- Tab 1: Baseline -->
          <div id="baseline-panel" class="ml-tab-panel ml-tab-panel--active" role="tabpanel" aria-labelledby="baseline-tab">
            <div id="mlBaselineContent"></div>
          </div>

          <!-- Tab 2: Pseudo-Evaluación -->
          <div id="pseudo-panel" class="ml-tab-panel" role="tabpanel" aria-labelledby="pseudo-tab">
            <div id="mlPseudoContent"></div>
          </div>

          <!-- Tab 3: Validación Real -->
          <div id="real-panel" class="ml-tab-panel" role="tabpanel" aria-labelledby="real-tab">
            <div id="mlRealContent"></div>
          </div>
        </div>
      </div>

      <div class="ml-modal__body">
        <section class="ml-block">
          <h4>Que analiza el modelo</h4>
          <p>El sistema usa las lecturas de llama, gas y movimiento para estimar el riesgo de incendio. La salida se resume en tres niveles: normal, medio y alto.</p>
          <ul>
            <li><strong>Llama:</strong> si se detecta llama, el riesgo sube inmediatamente.</li>
            <li><strong>Gas:</strong> valores altos indican posible humo, combustion o fuga.</li>
            <li><strong>Movimiento:</strong> ayuda a contextualizar si hay actividad cerca del sensor.</li>
          </ul>
        </section>

        <section class="ml-block">
          <h4>Componentes de ML usados</h4>
          <div class="ml-methods">
            <div>
              <strong>Clasificador de riesgo</strong>
              <p>Clasifica la lectura en riesgo normal, medio o alto. Si el modelo entrenado no esta disponible, usa reglas de respaldo para mantener el monitoreo activo.</p>
            </div>
            <div>
              <strong>Deteccion de anomalias</strong>
              <p>Compara la lectura actual contra los parametros del entrenamiento usando Z-score. Si una variable se aleja demasiado, se marca como anomalia.</p>
            </div>
            <div>
              <strong>Tendencia de gas</strong>
              <p>Calcula una recta sobre las ultimas lecturas de gas. Si la pendiente sube o baja mas de 10 ADC por lectura, reporta subiendo o bajando.</p>
            </div>
          </div>
        </section>

        <section class="ml-block">
          <h4>Matriz de confusion</h4>
          <div id="mlConfusionGrid" class="confusion-grid" aria-label="Matriz de confusion del modelo"></div>
        </section>

        <section class="ml-block">
          <h4>Lecturas reales usadas</h4>
          <p>Las metricas se calculan automaticamente con lecturas del prototipo. Se considera incendio observado cuando hay llama o el gas supera el umbral alto.</p>
          <div id="mlValidationStatus" class="ml-note">Cargando evaluacion...</div>
          <div id="mlValidationList" class="ml-validation-list"></div>
        </section>

        <section class="ml-block ml-confirmation-panel" id="mlConfirmationPanel" style="display: none; background: #f8f9fa; border: 1px solid #e0e3e8; border-radius: 8px; padding: 16px;">
          <h4 style="margin-bottom: 12px;">Validar Predicción Actual</h4>
          <div id="mlConfirmationInfo" style="margin-bottom: 16px; padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #1e5dd2;">
            <p style="margin: 0; font-size: 13px; color: #556b7f;">
              <strong>Lectura ID:</strong> <span id="mlConfirmLecturaId">-</span><br>
              <strong>Predicción del modelo:</strong> <span id="mlConfirmPredicion">-</span>
            </p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-success" id="mlConfirmCorrectBtn" style="flex: 1;">
              ✓ La predicción fue correcta
            </button>
            <button type="button" class="btn btn-danger" id="mlConfirmIncorrectBtn" style="flex: 1;">
              ✗ La predicción fue incorrecta
            </button>
          </div>
          <div id="mlConfirmationMsg" style="margin-top: 8px; padding: 8px; border-radius: 4px; display: none; font-size: 12px;"></div>
        </section>
      </div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Page renderer
// ---------------------------------------------------------------------------

function renderResultadosPage(lecturas, meta) {
  const ultima = lecturas[0];
  const prioridad = prioridadResumen(ultima);

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
  <link rel="icon" type="image/svg+xml" href="/icons/icon-192.svg" />
  <link rel="stylesheet" href="/notification-history.css" />
  <title>Monitor IoT - Detector de Incendios</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f5f7fa;
      --ink: #0f1a2e;
      --muted: #556b7f;
      --panel: #ffffff;
      --line: #d4dce8;
      --primary: #1e5dd2;
      --shadow: 0 4px 16px rgba(15, 26, 46, 0.08);
      --shadow-lg: 0 12px 32px rgba(15, 26, 46, 0.1);
      --radius: 10px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #f0f4fa 100%);
      color: var(--ink);
      min-height: 100vh;
    }

    /* ---- header ---- */
    header {
      background: linear-gradient(135deg, #1e5dd2 0%, #1844a0 100%);
      color: #fff;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 8px 24px rgba(30, 93, 210, 0.15);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    header h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    header span { font-size: 12px; color: rgba(255, 255, 255, 0.8); font-weight: 500; }
    .header-left { display: grid; gap: 4px; }
    .header-right { display: flex; gap: 12px; align-items: center; }

    /* ---- nav ---- */
    main { max-width: 1400px; margin: 0 auto; padding: 20px 16px 50px; }

    .section-nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid #e2e6f2;
      border-radius: 12px;
      padding: 8px 12px;
      box-shadow: 0 4px 12px rgba(15, 26, 46, 0.08);
      position: sticky;
      top: 68px;
      z-index: 15;
      margin-bottom: 16px;
    }
    .section-link {
      text-decoration: none;
      color: var(--ink);
      border: 2px solid transparent;
      background: transparent;
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: all 0.3s ease;
    }
    .section-link:hover { 
      background: #f0f4fa;
      color: var(--primary);
    }
    .section-link.active {
      background: var(--primary);
      color: #fff;
      box-shadow: 0 4px 12px rgba(30, 93, 210, 0.25);
    }

    /* ---- sections ---- */
    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(15, 26, 46, 0.06);
      padding: 20px;
      margin-bottom: 16px;
      scroll-margin-top: 160px;
      transition: all 0.3s ease;
    }
    .section:hover {
      box-shadow: 0 4px 16px rgba(15, 26, 46, 0.1);
    }
    h2 { font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink); margin-bottom: 12px; }
    .section-hint { font-size: 13px; color: var(--muted); margin: -8px 0 14px; line-height: 1.5; }

    /* ---- priority banner ---- */
    .priority-banner {
      background: linear-gradient(135deg, #f0f4fa 0%, #e8ecf5 100%);
      border: 2px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
      display: grid;
      gap: 6px;
    }
    .priority-banner strong { font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 800; }
    .priority-banner span { font-size: 13px; line-height: 1.5; }
    .priority-banner.priority-normal { 
      background: linear-gradient(135deg, #ecf8f1 0%, #dff4ea 100%);
      border-color: #a8dfc5;
      color: #166d3e;
    }
    .priority-banner.priority-warning { 
      background: linear-gradient(135deg, #fef9e3 0%, #fef1c5 100%);
      border-color: #f0d879;
      color: #8b6500;
    }
    .priority-banner.priority-critical { 
      background: linear-gradient(135deg, #fce8e8 0%, #f9d0ce 100%);
      border-color: #f0a89f;
      color: #a6251a;
      animation: criticalPulse 1.4s ease-in-out infinite; 
    }

    @keyframes criticalPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(166, 37, 26, 0.2); }
      50% { box-shadow: 0 0 0 8px rgba(166, 37, 26, 0.05); }
    }

    /* ---- cards grid ---- */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      margin-bottom: 14px;
    }
    .card {
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 2px 6px rgba(15, 26, 46, 0.04);
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(15, 26, 46, 0.12);
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: transparent;
    }
    .card.alerta { border-color: #f5a89f; background: linear-gradient(135deg, #fef9f8 0%, #fef3f0 100%); }
    .card.alerta::before { background: linear-gradient(90deg, #d92e23 0%, #e8594f 100%); }
    .card.alerta .c-value { color: #c8341e; }
    .card.warning { border-color: #f0d879; background: linear-gradient(135deg, #fffbf0 0%, #fffdf4 100%); }
    .card.warning::before { background: linear-gradient(90deg, #e8a800 0%, #f1b900 100%); }
    .card.warning .c-value { color: #b88a00; }

    .c-label { font-size: 12px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
    .c-value { font-size: 24px; font-weight: 800; color: var(--primary); }
    .c-unit { font-size: 12px; color: var(--muted); margin-top: 4px; font-weight: 600; }
    .c-help { font-size: 12px; color: var(--muted); margin-top: 8px; line-height: 1.4; }

    /* ---- legend ---- */
    .reading-legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .reading-legend article {
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
      transition: all 0.3s ease;
    }
    .reading-legend article:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(15, 26, 46, 0.1);
    }
    .reading-legend strong { 
      display: block; 
      color: var(--ink); 
      font-size: 12px; 
      margin-bottom: 4px; 
      text-transform: uppercase; 
      letter-spacing: 0.05em; 
    }
    .reading-legend span { 
      color: var(--muted); 
      font-size: 12px; 
      line-height: 1.4; 
    }

    /* ---- tags ---- */
    .tag {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .tag-normal { background: linear-gradient(135deg, #ecf8f1 0%, #dff4ea 100%); color: #166d3e; }
    .tag-medio { background: linear-gradient(135deg, #fef9e3 0%, #fef1c5 100%); color: #8b6500; }
    .tag-alto { background: linear-gradient(135deg, #fce8e8 0%, #f9d0ce 100%); color: #a6251a; }

    /* ---- interpretación ---- */
    .interp-wrap {
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .interp { 
      font-size: 13px; 
      color: var(--ink); 
      line-height: 1.6; 
    }

    .status-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 14px;
      margin-top: 12px;
    }
    .status-card {
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: 0 2px 6px rgba(15, 26, 46, 0.04);
      transition: all 0.3s ease;
    }
    .status-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(15, 26, 46, 0.1);
    }
    .status-card.priority-normal { 
      border-color: #a8dfc5;
      background: linear-gradient(135deg, #f3fbf6 0%, #ecf8f1 100%);
    }
    .status-card.priority-warning { 
      border-color: #f0d879;
      background: linear-gradient(135deg, #fffbf0 0%, #fef9e3 100%);
    }
    .status-card.priority-critical { 
      border-color: #f0a89f;
      background: linear-gradient(135deg, #fef9f9 0%, #fce8e8 100%);
    }

    .status-label { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .status-value { font-size: 20px; font-weight: 800; color: var(--primary); }

    /* ---- chart ---- */
    .chart-data-info {
      background: linear-gradient(135deg, #f0f4fa 0%, #e8ecf5 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 12px;
      color: var(--ink);
      margin-bottom: 14px;
      font-weight: 600;
    }
    .charts-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr;
      gap: 14px;
    }
    .chart-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 2px 6px rgba(15, 26, 46, 0.04);
      padding: 14px;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    .chart-card:hover {
      box-shadow: 0 4px 12px rgba(15, 26, 46, 0.1);
    }
    .chart-header { 
      font-size: 12px; 
      font-weight: 800; 
      text-transform: uppercase; 
      letter-spacing: 0.06em; 
      color: var(--ink); 
      margin-bottom: 8px; 
    }
    .chart-card canvas { display: block; width: 100% !important; height: 140px !important; }

    .chart-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 12px;
      align-items: center;
    }
    .chart-controls .filter { min-width: 140px; }
    .chart-viewport-label { margin-left: auto; font-size: 12px; color: var(--muted); font-weight: 700; }

    .chart-help {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 8px;
      line-height: 1.5;
    }

    /* ---- actions ---- */
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 8px;
    }
    .actions-row, .filters-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      align-items: center;
    }

    .filter, .filter-check {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .filter:hover, .filter-check:hover { 
      border-color: var(--primary);
      background: #f8fbff;
    }
    .filter:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(30, 93, 210, 0.1);
    }

    .btn {
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: all 0.3s ease;
    }
    .btn-primary { 
      background: linear-gradient(135deg, var(--primary) 0%, #1844a0 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(30, 93, 210, 0.25);
    }
    .btn-primary:hover { 
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(30, 93, 210, 0.35);
    }
    .btn-primary:active {
      transform: translateY(0);
    }
    .btn-secondary { 
      background: linear-gradient(135deg, #f0f4fa 0%, #e8ecf5 100%);
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .btn-secondary:hover { 
      background: linear-gradient(135deg, #e8ecf5 0%, #dfe5f0 100%);
      border-color: var(--primary);
    }

    /* ---- table ---- */
    .table-wrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow-x: auto;
      box-shadow: 0 2px 8px rgba(15, 26, 46, 0.06);
    }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: linear-gradient(135deg, #f5f7fa 0%, #f0f4fa 100%); }
    th {
      padding: 12px 16px;
      text-align: left;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ink);
      border-bottom: 2px solid var(--line);
    }
    td {
      padding: 12px 16px;
      font-size: 13px;
      color: var(--ink);
      border-bottom: 1px solid #f0f4fa;
    }
    tr:hover td { background: linear-gradient(90deg, transparent 0%, #f8fbff 50%, transparent 100%); }
    td.val-alerta { color: #d92e23; font-weight: 800; }

    /* ---- alerts ---- */
    .alerts-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(15, 26, 46, 0.06);
    }
    .alerts-panel ul { list-style: none; display: grid; gap: 8px; }
    .alerts-panel li {
      border-left: 4px solid var(--line);
      background: linear-gradient(135deg, #fafbff 0%, #f5f7fa 100%);
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 13px;
      transition: all 0.3s ease;
    }
    .alerts-panel li:hover {
      transform: translateX(4px);
      box-shadow: 0 2px 6px rgba(15, 26, 46, 0.08);
    }
    .alerts-panel li.critical { 
      border-left-color: #d92e23;
      background: linear-gradient(135deg, #fef9f8 0%, #fef3f0 100%);
    }
    .alerts-panel li.high { 
      border-left-color: #e8a800;
      background: linear-gradient(135deg, #fffbf0 0%, #fffdf4 100%);
    }

    .alert-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 3px;
      flex-wrap: wrap;
    }
    .badge-state {
      display: inline-block;
      font-size: 10px;
      border-radius: 6px;
      padding: 2px 6px;
      border: 1px solid #d4dce8;
      color: #556b7f;
      background: #f5f7fa;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-weight: 700;
    }
    .badge-state.read { background: #ecf8f1; color: #166d3e; border-color: #a8dfc5; }

    /* ---- notifications ---- */
    .notif-wrap { position: relative; }
    .notif-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      width: min(360px, 90vw);
      max-height: 400px;
      overflow: auto;
      background: #fff;
      border: 1px solid #d4dce8;
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      padding: 8px;
      display: none;
      z-index: 30;
    }
    .notif-menu.open { display: block; }
    .notif-menu h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #556b7f; margin-bottom: 6px; font-weight: 700; }
    .notif-menu ul { list-style: none; display: grid; gap: 6px; }
    .notif-menu li { border-left: 3px solid #d4dce8; background: #fafbff; padding: 8px 10px; border-radius: 6px; font-size: 11px; }
    .notif-menu li.critical { border-left-color: #d92e23; }
    .notif-menu li.high { border-left-color: #e8a800; }
    .notif-status { font-size: 11px; color: #556b7f; margin-bottom: 6px; }

    .btn-notif {
      background: rgba(255,255,255,0.12);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.2);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-notif:hover { background: rgba(255,255,255,0.2); }

    .notif-badge {
      min-width: 16px;
      height: 16px;
      border-radius: 999px;
      padding: 0 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      line-height: 1;
      background: #d92e23;
      color: #fff;
      font-weight: 700;
    }

    /* ---- modal ---- */
    .ml-modal {
      position: fixed;
      inset: 0;
      display: none;
      place-items: center;
      padding: 12px;
      z-index: 80;
      background: rgba(15, 26, 46, 0.5);
    }
    .ml-modal.open { display: grid; }
    .ml-modal__backdrop { position: absolute; inset: 0; }
    .ml-modal__panel {
      position: relative;
      width: min(900px, 100%);
      max-height: min(85vh, 800px);
      overflow: auto;
      background: #fff;
      border: 1px solid #d4dce8;
      border-radius: 10px;
      box-shadow: var(--shadow-lg);
    }
    .ml-modal__header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #fff;
      border-bottom: 1px solid #e2e6f2;
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .ml-modal__close {
      border: 1px solid #d4dce8;
      background: #f5f7fa;
      color: #1f2d47;
      border-radius: 6px;
      padding: 6px 10px;
      font-weight: 700;
      font-size: 11px;
      cursor: pointer;
    }

    /* ---- Tabs ---- */
    .ml-tabs {
      padding: 16px;
      background: #f9fbfd;
      border-bottom: 1px solid #d4dce8;
    }
    .ml-tabs__nav {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 2px solid #d4dce8;
      overflow-x: auto;
      padding-bottom: 0;
    }
    .ml-tab-btn {
      background: none;
      border: none;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #556b7f;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.2s ease;
      white-space: nowrap;
      text-decoration: none;
    }
    .ml-tab-btn:hover {
      color: #1e5dd2;
      border-bottom-color: #1e5dd2;
    }
    .ml-tab-btn--active {
      color: #1e5dd2;
      border-bottom-color: #1e5dd2;
    }
    .ml-tabs__content {
      position: relative;
      min-height: 200px;
    }
    .ml-tab-panel {
      display: none;
      padding: 16px;
      animation: fadeIn 0.2s ease;
    }
    .ml-tab-panel--active {
      display: block;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ---- Metric Cards in Tabs ---- */
    .ml-metric-card {
      background: #fff;
      border: 1px solid #d4dce8;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .ml-metric-label {
      font-size: 12px;
      color: #556b7f;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .ml-metric-value {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .ml-metric-description {
      font-size: 12px;
      color: #556b7f;
      margin-top: 8px;
      font-style: italic;
    }


    @media (max-width: 800px) {
      body { font-size: 14px; }
      header { padding: 10px 12px; }
      header h1 { font-size: 16px; }

      main { padding: 10px 8px 30px; }

      .section-nav { top: 56px; }
      .section-link { padding: 5px 9px; font-size: 10px; }

      .section { padding: 10px; }

      .cards { grid-template-columns: 1fr; }
      .card { padding: 10px; }
      .c-value { font-size: 20px; }

      .status-row { grid-template-columns: 1fr; }

      .charts-grid { grid-template-columns: 1fr; }
      .chart-card canvas, .chart-card:not(:first-child) canvas { height: 150px !important; }

      .actions { grid-template-columns: 1fr; }
      .actions-row, .filters-row { flex-direction: column; }
      .actions-row .btn, .filters-row .filter { width: 100%; }

      .history-tools {
        display: grid;
        grid-template-columns: 1fr;
      }
      .history-tools .btn { width: 100%; }

      table { min-width: 0; }
      thead { display: none; }
      tbody, tr, td { display: block; width: 100%; }
      tr {
        border: 1px solid #d4dce8;
        border-radius: 8px;
        background: #fff;
        box-shadow: var(--shadow);
        margin-bottom: 8px;
        padding: 6px;
      }
      td {
        border: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        font-size: 12px;
      }
      td::before {
        content: attr(data-label);
        color: #556b7f;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .notif-menu { right: auto; left: 0; width: min(92vw, 400px); }
      .ml-modal__panel { max-height: 90vh; }
    }

    footer {
      margin-top: 24px;
      font-size: 11px;
      color: #778;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 6px;
    }
    footer a { color: var(--primary); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

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
    .section-link.active {
      background: #2f5fbf;
      border-color: #2f5fbf;
      color: #fff;
    }
    .section {
      scroll-margin-top: 136px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
      margin-top: 14px;
    }
    .section-hint {
      font-size: 13px;
      color: #55607f;
      margin: -4px 0 12px;
      line-height: 1.45;
    }
    /* ---- section titles ---- */
        h2 { font-size: 14px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.08em; color: #555; margin: 4px 0 12px; }

    /* ---- sensor cards ---- */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
    .card .c-help  { font-size: 12px; color: #5f6780; margin-top: 8px; line-height: 1.35; }
    .card.alerta   { border-color: #e74c3c; background: #fff5f5; }
    .card.alerta .c-value { color: #c0392b; }
    .card.warning  { border-color: #f1c40f; background: #fffdf4; }
    .card.warning .c-value { color: #9a6b00; }

    .reading-legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
      margin: 12px 0 4px;
    }
    .reading-legend article {
      background: #f8faff;
      border: 1px solid #d8e1f3;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .reading-legend strong {
      display: block;
      color: #243252;
      font-size: 12px;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .reading-legend span {
      color: #526083;
      font-size: 12px;
      line-height: 1.4;
    }

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

    .priority-banner {
      border-radius: 12px;
      padding: 12px 14px;
      margin: 8px 0 14px;
      border: 1px solid #d7dfef;
      background: #f8faff;
      display: grid;
      gap: 4px;
      box-shadow: var(--shadow);
    }
    .priority-banner strong {
      font-size: 13px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .priority-banner span {
      font-size: 13px;
      line-height: 1.45;
    }
    .priority-banner.priority-normal {
      background: #edf8f2;
      border-color: #b8e1c7;
      color: #1e8449;
    }
    .priority-banner.priority-warning {
      background: #fff8e9;
      border-color: #f2d28e;
      color: #9a6b00;
    }
    .priority-banner.priority-critical {
      background: #fdeeee;
      border-color: #efb1ae;
      color: #b33025;
      animation: priorityPulse 1.6s ease-in-out infinite;
    }

    .status-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    .status-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 12px 14px;
    }
    .status-card.priority-normal {
      border-color: #b8e1c7;
      background: #f3fbf6;
    }
    .status-card.priority-warning {
      border-color: #f2d28e;
      background: #fffbf1;
    }
    .status-card.priority-critical {
      border-color: #efb1ae;
      background: #fff4f4;
    }
    .status-label {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #526083;
      margin-bottom: 8px;
    }
    .status-value {
      font-size: 21px;
      font-weight: 800;
      color: #253457;
    }

    @keyframes priorityPulse {
      0% { box-shadow: 0 0 0 0 rgba(195, 57, 43, 0.26); }
      70% { box-shadow: 0 0 0 11px rgba(195, 57, 43, 0.0); }
      100% { box-shadow: 0 0 0 0 rgba(195, 57, 43, 0.0); }
    }

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

    /* ---- graficas ---- */
    .chart-wrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 20px 20px 16px;
      box-shadow: var(--shadow);
    }
    .chart-wrap canvas { display: block; width: 100% !important; height: 220px !important; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-items: stretch;
    }
    .chart-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px;
      overflow: hidden;
      min-height: 0;
    }
    .chart-card:first-child {
      grid-column: 1 / -1;
    }
    .chart-header {
      color: #2e3a59;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.03em;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .chart-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      background: #f8faff;
      border: 1px solid #d9deec;
      border-radius: 10px;
      padding: 10px;
    }
    .chart-controls .filter {
      min-width: 140px;
    }
    .chart-controls .btn {
      padding: 8px 10px;
      font-size: 12px;
      border-radius: 8px;
    }
    .chart-help {
      font-size: 12px;
      color: #526083;
      margin-bottom: 10px;
      line-height: 1.45;
    }
    .chart-viewport-label {
      margin-left: auto;
      font-size: 12px;
      color: #4a5678;
      font-weight: 700;
    }
    .chart-card canvas {
      display: block;
      width: 100% !important;
      height: 220px !important;
      max-height: 220px;
    }
    .chart-card:not(:first-child) canvas {
      height: 150px !important;
      max-height: 150px;
    }

    .actions {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 10px;
      margin-top: 8px;
    }
    .actions-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      background: #f8faff;
      border: 1px solid #d9deec;
      border-radius: 10px;
      padding: 10px;
    }
    .filters-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      background: #f8faff;
      border: 1px solid #d9deec;
      border-radius: 10px;
      padding: 10px;
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

    .ml-modal {
      position: fixed;
      inset: 0;
      display: none;
      place-items: center;
      padding: 18px;
      z-index: 80;
    }
    .ml-modal.open {
      display: grid;
    }
    .ml-modal__backdrop {
      position: absolute;
      inset: 0;
      background: rgba(13, 22, 42, 0.58);
    }
    .ml-modal__panel {
      position: relative;
      width: min(940px, 100%);
      max-height: min(86vh, 820px);
      overflow: auto;
      background: #fff;
      border: 1px solid #d8dfef;
      border-radius: 12px;
      box-shadow: 0 22px 70px rgba(13, 22, 42, 0.28);
    }
    .ml-modal__header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #fff;
      border-bottom: 1px solid #e2e7f3;
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }
    .ml-modal__header h3 {
      font-size: 20px;
      color: #17243f;
      margin-top: 3px;
    }
    .ml-kicker,
    .ml-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #65718f;
      font-weight: 800;
    }
    .ml-modal__close {
      border: 1px solid #d6deee;
      background: #f6f8fc;
      color: #263553;
      border-radius: 8px;
      padding: 9px 12px;
      font-weight: 800;
      cursor: pointer;
    }
    .ml-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      padding: 16px 20px 0;
    }
    .ml-summary-grid article {
      border: 1px solid #dfe5f2;
      border-radius: 8px;
      padding: 12px;
      background: #f8faff;
    }
    .ml-summary-grid strong {
      display: block;
      font-size: 28px;
      color: #1f5fbf;
      margin: 4px 0;
    }
    .ml-summary-grid small {
      color: #5f6780;
      line-height: 1.35;
    }
    .ml-modal__body {
      display: grid;
      gap: 14px;
      padding: 16px 20px 22px;
    }
    .ml-block {
      border: 1px solid #e0e6f2;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }
    .ml-block h4 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #2e3a59;
      margin-bottom: 8px;
    }
    .ml-block p,
    .ml-block li {
      color: #3d465f;
      line-height: 1.55;
      font-size: 14px;
    }
    .ml-block ul {
      margin: 10px 0 0 18px;
      display: grid;
      gap: 5px;
    }
    .ml-methods {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .ml-methods div {
      background: #f8faff;
      border: 1px solid #e0e6f2;
      border-radius: 8px;
      padding: 12px;
    }
    .ml-methods strong {
      display: block;
      margin-bottom: 6px;
      color: #17243f;
    }
    .confusion-grid {
      display: grid;
      grid-template-columns: 150px repeat(2, minmax(0, 1fr));
      border: 1px solid #dfe5f2;
      border-radius: 8px;
      overflow: hidden;
    }
    .confusion-grid > div {
      min-height: 76px;
      padding: 12px;
      border-right: 1px solid #dfe5f2;
      border-bottom: 1px solid #dfe5f2;
      background: #fff;
      display: grid;
      align-content: center;
      gap: 4px;
    }
    .confusion-grid > div:nth-child(3n) {
      border-right: none;
    }
    .confusion-grid > div:nth-last-child(-n + 3) {
      border-bottom: none;
    }
    .confusion-grid .axis {
      background: #f4f7fc;
      color: #2e3a59;
      font-weight: 800;
    }
    .confusion-grid .hit {
      background: #edf8f2;
    }
    .confusion-grid span {
      color: #5f6780;
      font-size: 12px;
      line-height: 1.35;
    }
    .ml-note {
      margin-top: 10px;
      color: #6c5870 !important;
      background: #fbf6ff;
      border: 1px solid #eadcf5;
      border-radius: 8px;
      padding: 10px;
    }
    .ml-validation-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .ml-validation-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      border: 1px solid #e0e6f2;
      border-radius: 8px;
      padding: 10px;
      background: #f8faff;
    }
    .ml-validation-item strong {
      color: #17243f;
    }
    .ml-validation-item span {
      display: block;
      color: #65718f;
      font-size: 12px;
      margin-top: 3px;
    }
    .ml-validation-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .ml-validation-actions button {
      border: 1px solid #cbd3e6;
      border-radius: 6px;
      background: #fff;
      color: #263553;
      padding: 7px 9px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }
    .ml-validation-actions button.active {
      background: #e8f8f0;
      border-color: #9bd3b1;
      color: #1e8449;
    }
    .ml-validation-actions button.danger.active {
      background: #fdf2f2;
      border-color: #efb3aa;
      color: #c0392b;
    }

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
    .alerts-help {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #d8e1f3;
      background: #f7faff;
      border-radius: 8px;
      color: #4f5d80;
      font-size: 12px;
      line-height: 1.45;
    }
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

      .section {
        padding: 12px;
      }
      .cards {
        grid-template-columns: 1fr;
      }
      .status-row {
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
      .actions {
        grid-template-columns: 1fr;
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

      .charts-grid {
        grid-template-columns: 1fr;
      }
      .chart-card,
      .chart-card:first-child {
        grid-column: auto;
      }
      .chart-card canvas,
      .chart-card:not(:first-child) canvas {
        height: 170px !important;
        max-height: 170px;
      }

      .notif-menu {
        right: auto;
        left: 0;
        width: min(94vw, 430px);
        max-height: 60vh;
      }

      .ml-modal {
        padding: 10px;
        align-items: start;
      }
      .ml-modal__panel {
        max-height: 92vh;
      }
      .ml-modal__header {
        align-items: flex-start;
      }
      .ml-summary-grid,
      .ml-methods,
      .confusion-grid {
        grid-template-columns: 1fr;
      }
      .ml-validation-item {
        grid-template-columns: 1fr;
      }
      .ml-validation-actions {
        justify-content: stretch;
      }
      .ml-validation-actions button {
        flex: 1;
      }
      .confusion-grid > div,
      .confusion-grid > div:nth-child(3n),
      .confusion-grid > div:nth-last-child(-n + 3) {
        border-right: none;
        border-bottom: 1px solid #dfe5f2;
      }
      .confusion-grid > div:last-child {
        border-bottom: none;
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
      <span>Panel en tiempo real para llama, gas, movimiento y riesgo · ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span>
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
      <a class="section-link" href="#sec-control">Control</a>
      <a class="section-link" href="#sec-alertas">Alertas</a>
      <a class="section-link" href="#sec-notificaciones">Notificaciones</a>
      <a class="section-link" href="#sec-grafica">Grafica</a>
      <a class="section-link" href="#sec-historial">Historial</a>
    </nav>

    <section id="sec-resumen" class="section">
    <h2>Resumen actual</h2>
    <p class="section-hint">Aqui ves el estado actual del detector con un lenguaje sencillo: que detecta cada sensor y que nivel de riesgo sugiere el analisis.</p>
    <div id="summaryPriorityBanner" class="priority-banner ${prioridad.cls}">
      <strong id="summaryPriorityTitle">${prioridad.titulo}</strong>
      <span id="summaryPriorityMessage">${prioridad.mensaje}</span>
    </div>
    <div class="cards">
      <div id="cardLlama" class="card ${ultima && ultima.llama === 1 ? 'alerta' : ''}">
        <div class="c-label">Sensor de llama</div>
        <div class="c-value" id="cardLlamaValue">${ultima ? (ultima.llama === 1 ? 'Detectada' : 'Sin llama') : '-'}</div>
        <div class="c-unit">KY-026</div>
        <div class="c-help">Indica si el sensor detecta una fuente de fuego.</div>
      </div>
      <div id="cardGas" class="card ${ultima && Number(ultima.gas) >= 1800 ? 'alerta' : (ultima && Number(ultima.gas) >= 1100 ? 'warning' : '')}">
        <div class="c-label">Concentracion de gas</div>
        <div class="c-value" id="cardGasValue">${ultima ? ultima.gas : '-'}</div>
        <div class="c-unit">ADC (0-4095)</div>
        <div class="c-help">Valores altos pueden indicar humo, combustion o fuga.</div>
      </div>
      <div id="cardMovimiento" class="card">
        <div class="c-label">Presencia / movimiento</div>
        <div class="c-value" id="cardMovimientoValue">${ultima ? (ultima.movimiento === 1 ? 'Detectado' : 'Sin presencia') : '-'}</div>
        <div class="c-unit">PIR</div>
        <div class="c-help">Ayuda a saber si hay actividad cerca del detector.</div>
      </div>
      <div id="cardCount" class="card">
        <div class="c-label">Lecturas visibles</div>
        <div class="c-value" id="cardCountValue">${meta.count}</div>
        <div class="c-unit">ultimas 30</div>
        <div class="c-help">Cantidad de registros usados para tablas y graficas.</div>
      </div>
    </div>

    <div class="reading-legend">
      <article>
        <strong>Riesgo normal</strong>
        <span>Operacion estable. Mantener monitoreo.</span>
      </article>
      <article>
        <strong>Riesgo medio</strong>
        <span>Condicion a vigilar. Conviene revisar ventilacion y entorno.</span>
      </article>
      <article>
        <strong>Riesgo alto</strong>
        <span>Posible amenaza. Revisar el area de inmediato con precaucion.</span>
      </article>
    </div>

    <div class="status-row">
      <div id="statusInterpretationCard" class="status-card ${prioridad.cls}">
        <div class="status-label">Interpretacion ML</div>
        <div id="interpretationBlock">${interpretarEstado(ultima)}</div>
      </div>
      <div id="statusUpdatedCard" class="status-card ${prioridad.cls}">
        <div class="status-label">Ultima actualizacion</div>
        <div class="status-value" id="lastUpdatedTime">${ultima ? new Date(ultima.fecha).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' }) : '-'}</div>
      </div>
    </div>

    </section>

    <section id="sec-control" class="section">
    <h2>Centro de control</h2>
    <p class="section-hint">Desde aqui controlas notificaciones, instalacion de la PWA y filtros rapidos para priorizar eventos importantes.</p>
    <div class="actions">
      <div class="actions-row">
        <button id="mlResultsBtn" class="btn btn-primary" type="button">Ver detalle del analisis</button>
        <button id="installAppBtn" class="btn btn-secondary" disabled>Instalar app en el celular</button>
      </div>
      <div class="filters-row">
        <select id="severityFilter" class="filter" aria-label="Filtrar severidad">
          <option value="all">Todas</option>
          <option value="critical">Criticas</option>
          <option value="high">Altas</option>
          <option value="medium">Medias</option>
        </select>
        <label class="filter-check" for="onlyUnreadAlerts">
          <input id="onlyUnreadAlerts" type="checkbox" />
          Solo pendientes
        </label>
      </div>
    </div>
    </section>

    <section id="sec-alertas" class="section">
    <h2>Alertas y acciones sugeridas</h2>
    <p class="section-hint">Cada alerta incluye que paso y que hacer. Marca una alerta como atendida cuando ya la revisaste.</p>
    <div class="alerts-panel">
      <ul id="alertsList">
        <li><strong>Sin alertas nuevas</strong><div class="meta">Activa notificaciones para recibir eventos en tu celular.</div></li>
      </ul>
      <div class="alerts-help">Consejo: activa notificaciones para recibir aviso inmediato cuando el modelo detecte riesgo alto o probabilidad elevada de incendio.</div>
    </div>
    </section>

    <section id="sec-notificaciones" class="section">
    <h2>Historial de notificaciones</h2>
    <p class="section-hint">Aqui ves todas las notificaciones enviadas a tu dispositivo. Puedes filtrar, marcar como leidas y ver estadisticas de entrega.</p>
    
    <div id="notificationHistoryContainer">
      <div class="notif-controls">
        <select id="notifSeverityFilter" class="filter" aria-label="Filtrar por severidad">
          <option value="all">Severidad: todas</option>
          <option value="critical">Critica</option>
          <option value="high">Alta</option>
          <option value="medium">Media</option>
          <option value="low">Baja</option>
        </select>
        <select id="notifStatusFilter" class="filter" aria-label="Filtrar por estado">
          <option value="all">Estado: todos</option>
          <option value="success">Exitosas</option>
          <option value="failed">Fallidas</option>
          <option value="partial">Parciales</option>
        </select>
        <label class="filter-check" for="notifOnlyUnread">
          <input id="notifOnlyUnread" type="checkbox" />
          Solo no leidas
        </label>
        <button id="notificationRefreshBtn" class="btn btn-secondary" type="button">Actualizar</button>
      </div>

      <div id="notificationResumenStats" style="background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 10px; box-shadow: var(--shadow);"></div>

      <div id="notificationHistoryStatus"></div>
      <div id="notificationHistoryList"></div>
    </div>
    </section>

    <section id="sec-grafica" class="section">
    <h2>Graficas de comportamiento</h2>
    <p class="section-hint">Explora la evolucion de cada parametro. Puedes mover la ventana, acercar/alejar y navegar en el tiempo.</p>
    <div class="chart-data-info" style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 0.9em; color: #555;">
      <strong>Historial completo:</strong> Se muestran <span id="chartHistoryCount">${lecturas.length}</span> lecturas disponibles desde Adafruit. Las graficas se actualizan conforme a todo el historial guardado.
    </div>
    <div class="chart-help">Tip: usa el scroll del mouse para hacer zoom horizontal y arrastra para desplazarte por la grafica.</div>
    <div class="chart-controls">
      <select id="chartWindowSize" class="filter" aria-label="Rango visible en graficas">
        <option value="15">Ultimos 15 puntos</option>
        <option value="30" selected>Ultimos 30 puntos</option>
        <option value="60">Ultimos 60 puntos</option>
        <option value="all">Todos</option>
      </select>
      <button id="chartOlderBtn" class="btn btn-secondary" type="button">Ir al pasado</button>
      <button id="chartNewerBtn" class="btn btn-secondary" type="button">Volver al presente</button>
      <button id="chartResetZoomBtn" class="btn btn-secondary" type="button">Restablecer zoom</button>
      <span id="chartViewportLabel" class="chart-viewport-label">0 de 0 puntos visibles</span>
    </div>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-header">Evolucion de gas</div>
        <canvas id="gasChart"
          data-labels='${JSON.stringify(lecturas.slice().reverse().map(l => l.fecha ? new Date(l.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" }) : ""))}'
          data-gas='${JSON.stringify(lecturas.slice().reverse().map(l => l.gas ?? null))}'
          data-riesgo='${JSON.stringify(lecturas.slice().reverse().map(l => l.riesgo ?? "normal"))}'
        ></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-header">Deteccion de llama</div>
        <canvas id="fireChart"
          data-labels='${JSON.stringify(lecturas.slice().reverse().map(l => l.fecha ? new Date(l.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" }) : ""))}'
          data-fire='${JSON.stringify(lecturas.slice().reverse().map(l => l.llama === 1 ? 1 : 0))}'
        ></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-header">Deteccion de movimiento</div>
        <canvas id="movementChart"
          data-labels='${JSON.stringify(lecturas.slice().reverse().map(l => l.fecha ? new Date(l.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" }) : ""))}'
          data-movement='${JSON.stringify(lecturas.slice().reverse().map(l => l.movimiento === 1 ? 1 : 0))}'
        ></canvas>
      </div>
    </div>
    </section>

    <section id="sec-historial" class="section">
    <h2>Historial completo</h2>
    <p class="section-hint">Filtra los registros por riesgo, presencia, llama o anomalia para analizar eventos pasados y exportarlos en PDF.</p>
    <div class="history-tools">
      <select id="historyRiskFilter" class="filter" aria-label="Filtrar riesgo en historial">
        <option value="all">Riesgo: todos</option>
        <option value="normal">Riesgo: normal</option>
        <option value="medio">Riesgo: medio</option>
        <option value="alto">Riesgo: alto</option>
      </select>
      <select id="historyMovimientoFilter" class="filter" aria-label="Filtrar movimiento en historial">
        <option value="all">Presencia: todas</option>
        <option value="1">Con presencia</option>
        <option value="0">Sin presencia</option>
      </select>
      <select id="historyLlamaFilter" class="filter" aria-label="Filtrar llama en historial">
        <option value="all">Llama: todas</option>
        <option value="1">Con llama</option>
        <option value="0">Sin llama</option>
      </select>
      <select id="historyAnomaliaFilter" class="filter" aria-label="Filtrar anomalia en historial">
        <option value="all">Anomalia: todas</option>
        <option value="true">Solo anomalia</option>
        <option value="false">Sin anomalia</option>
      </select>
      <button id="downloadHistoryPdfBtn" class="btn btn-secondary wide">Descargar historial en PDF</button>
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

  ${renderMlEvaluationModal()}

  <footer>
    <span>Proyecto IoT — CETI 7mo semestre</span>
    <a href="/api/sensores/ultimas" target="_blank" rel="noreferrer">Ver JSON completo</a>
  </footer>
  <!-- Chart.js from jsDelivr (allowed by CSP) and the chart init script served from /public -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
  <script src="/gas-chart.js"></script>
  <script src="/pwa-client.js"></script>
  <script src="/history-view.js"></script>
  <script src="/notification-history.js"></script>
</body>
</html>`;
}

app.get('/resultados', async (req, res, next) => {
  try {
    if (isAdafruitConfigured()) {
      const resultado = await obtenerLecturasAdafruit({ limit: 30 });
      const estadisticas = await obtenerEstadisticasAdafruit(30);

      return res.status(200).send(renderResultadosPage(resultado.lecturas, {
        count: resultado.lecturas.length,
      }, estadisticas));
    }

    if (!isFirebaseConfigured || !db) {
      return res.status(503).send('<pre>No hay proveedor de datos configurado. Define AIO_USERNAME, AIO_KEY y AIO_STATE_FEED en Render.</pre>');
    }

    const snapshot = await db.collection('lecturas')
      .orderBy('fecha', 'desc')
      .limit(30)
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
        probabilidad: Number.isFinite(Number(data.probabilidad)) ? Number(data.probabilidad) : null,
        alerta: typeof data.alerta === 'boolean' ? data.alerta : null,
        nivel: typeof data.nivel === 'string' ? data.nivel : null,
      };
    });

    const estadisticas = await obtenerEstadisticasLecturas({ limit: 30 });

    res.status(200).send(renderResultadosPage(lecturas, { count: lecturas.length }, estadisticas));
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    const quotaExceeded = msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded');

    if (quotaExceeded) {
      logger.warn('Firestore quota exceeded on /resultados. Serving runtime cache fallback.');
      const fallback = runtimeStore.listLecturas({
        limit: 30,
        before: null,
        filters: {
          riesgo: null,
          movimiento: null,
          llama: null,
          anomalia: null,
        },
      });

      const fallbackStats = await obtenerEstadisticasLecturas({ limit: 30 });
      return res.status(200).send(renderResultadosPage(fallback.lecturas, {
        count: fallback.lecturas.length,
      }, fallbackStats));
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
