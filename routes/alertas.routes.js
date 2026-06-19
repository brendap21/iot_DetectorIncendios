'use strict';

const express = require('express');

const {
  suscribirNotificaciones,
  desuscribirNotificaciones,
  obtenerPublicKey,
  obtenerAlertasRecientes,
  marcarAlertaLeida,
  obtenerHistorialNotificaciones,
  obtenerResumenNotificaciones,
  marcarNotificacionLeida,
  resolverAmenaza,
  obtenerEstadoAmenazas,
} = require('../controllers/alertas.controller');

const router = express.Router();

router.get('/public-key', obtenerPublicKey);
router.post('/subscribe', suscribirNotificaciones);
router.post('/unsubscribe', desuscribirNotificaciones);
router.get('/ultimas', obtenerAlertasRecientes);
router.patch('/:id/leida', marcarAlertaLeida);
router.get('/notificaciones/historial', obtenerHistorialNotificaciones);
router.get('/notificaciones/resumen', obtenerResumenNotificaciones);
router.patch('/notificaciones/:id/leida', marcarNotificacionLeida);
router.get('/amenazas/estado', obtenerEstadoAmenazas);
router.patch('/amenazas/:tipo/resolver', resolverAmenaza);

module.exports = router;
