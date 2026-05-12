// app.js - build and export Express application (middleware, routes, error handlers)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const sensoresRoutes = require('./routes/sensores.routes');
const logger = require('./logger');

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
  logger.info('Incoming request', req.method, req.originalUrl, bodyPreview);
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
  res.status(200).json({ ok: true, service: 'IoT Detector Incendios', status: 'online' });
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
  logger.error('Unhandled error in request', err && err.stack ? err.stack : err);
  res.status(500).json({ ok: false, error: 'Error interno' });
});

module.exports = app;
