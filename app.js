// app.js - build and export Express application (middleware, routes, error handlers)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const sensoresRoutes = require('./routes/sensores.routes');
const logger = require('./logger');
const { db, isFirebaseConfigured, firebaseInitError } = require('./firebase');

const app = express();

// Basic security headers
app.use(helmet());

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

function renderResultadosPage(lecturas, meta) {
  const rows = lecturas.map((lectura) => `
    <tr>
      <td>${lectura.fecha ? new Date(lectura.fecha).toLocaleString('es-MX') : 'Sin fecha'}</td>
      <td>${lectura.llama ?? '-'}</td>
      <td>${lectura.gas ?? '-'}</td>
      <td>${lectura.movimiento ?? '-'}</td>
      <td>${lectura.id}</td>
    </tr>
  `).join('');

  return `<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="10" />
    <title>Resultados - IoT Detector Incendios</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1220;
        --panel: #111a2e;
        --panel-2: #17233d;
        --text: #e8eefc;
        --muted: #97a6c6;
        --accent: #62d0ff;
        --ok: #39d98a;
        --border: rgba(255,255,255,0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: radial-gradient(circle at top, #162445 0%, var(--bg) 48%, #060b14 100%);
        color: var(--text);
        min-height: 100vh;
      }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 40px 20px 56px; }
      .hero {
        display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap;
        padding: 24px; border: 1px solid var(--border); border-radius: 20px;
        background: linear-gradient(180deg, rgba(17,26,46,0.96), rgba(11,18,32,0.96));
        box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      }
      h1 { margin: 0 0 10px; font-size: clamp(28px, 4vw, 44px); }
      p { margin: 0; color: var(--muted); line-height: 1.5; }
      .badge {
        display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px;
        background: rgba(57,217,138,0.12); color: var(--ok); font-weight: 700; border: 1px solid rgba(57,217,138,0.25);
      }
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0; }
      .card { background: rgba(23,35,61,0.9); border: 1px solid var(--border); border-radius: 18px; padding: 18px; }
      .card .label { color: var(--muted); font-size: 13px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .08em; }
      .card .value { font-size: 28px; font-weight: 800; }
      .table-wrap { overflow-x: auto; background: rgba(17,26,46,0.9); border: 1px solid var(--border); border-radius: 18px; }
      table { width: 100%; border-collapse: collapse; min-width: 720px; }
      th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid var(--border); }
      th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; background: rgba(255,255,255,0.02); }
      tr:hover td { background: rgba(255,255,255,0.02); }
      .footer { margin-top: 16px; color: var(--muted); font-size: 14px; }
      a { color: var(--accent); text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <div>
          <span class="badge">Sistema activo</span>
          <h1>Resultados en tiempo real</h1>
          <p>Últimas lecturas que sube el ESP32 al backend y se guardan en Firestore.</p>
        </div>
        <div>
          <div class="card">
            <div class="label">Lecturas visibles</div>
            <div class="value">${meta.count}</div>
          </div>
        </div>
      </section>

      <section class="stats">
        <div class="card"><div class="label">Estado backend</div><div class="value" style="font-size:20px;">Online</div></div>
        <div class="card"><div class="label">Última actualización</div><div class="value" style="font-size:20px;">${new Date().toLocaleString('es-MX')}</div></div>
        <div class="card"><div class="label">Auto refresh</div><div class="value" style="font-size:20px;">10 s</div></div>
      </section>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Llama</th>
              <th>Gas</th>
              <th>Movimiento</th>
              <th>ID documento</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5">Aún no hay lecturas guardadas.</td></tr>'}
          </tbody>
        </table>
      </section>

      <div class="footer">
        También puedes ver el JSON en <a href="/api/sensores/ultimas" target="_blank" rel="noreferrer">/api/sensores/ultimas</a>.
      </div>
    </main>
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
        fecha
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
