// server.js - start the HTTP server from the modularized app
const app = require('./app');
const logger = require('./logger');

// Render assigns a dynamic port via env
const PORT = process.env.PORT || 3000;

// Log environment important bits (avoid secrets)
logger.info('Starting server', { port: PORT, node_env: process.env.NODE_ENV || 'development' });

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('🔥 INICIANDO SERVIDOR...');
  logger.info('🚀 LISTO PARA ESCUCHAR', `Servidor corriendo en puerto ${PORT}`);
});

// Catch errors during startup
server.on('error', (err) => {
  logger.error('Server error during startup', err && err.stack ? err.stack : err);
  process.exit(1);
});

// Process-level handlers to get diagnostic info in deploy logs
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection at:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err && err.stack ? err.stack : err);
  // Give logs a moment then exit
  setTimeout(() => process.exit(1), 100);
});
