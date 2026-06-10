'use strict';

const express = require('express');

const {
  suscribirNotificaciones,
  desuscribirNotificaciones,
  obtenerPublicKey,
  obtenerAlertasRecientes,
  marcarAlertaLeida,
} = require('../controllers/alertas.controller');

const router = express.Router();

router.get('/public-key', obtenerPublicKey);
router.post('/subscribe', suscribirNotificaciones);
router.post('/unsubscribe', desuscribirNotificaciones);
router.get('/ultimas', obtenerAlertasRecientes);
router.patch('/:id/leida', marcarAlertaLeida);

module.exports = router;
