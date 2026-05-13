// app.js - build and export Express application (middleware, routes, error handlers)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const sensoresRoutes = require('./routes/sensores.routes');
const logger = require('./logger');
const { isFirebaseConfigured, firebaseInitError } = require('./firebase');

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
    firebaseError: firebaseInitError ? (firebaseInitError.message || String(firebaseInitError)) : null
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
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
