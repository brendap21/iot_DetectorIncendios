/**
 * @fileoverview Controller for sensor reading persistence.
 *
 * Receives a validated sensor payload, runs ML analysis (risk classification,
 * anomaly detection, and gas trend prediction), and persists the enriched
 * document to Firestore.
 */

'use strict';

const { db, isFirebaseConfigured } = require('../firebase');
const logger = require('../logger');
const { clasificarRiesgo, detectarAnomalia, predecirTendencia } = require('../services/ml.service');

// Number of recent readings fetched from Firestore to compute gas trend.
const TREND_WINDOW = 10;

const guardarLectura = async (req, res) => {
  if (!isFirebaseConfigured || !db) {
    logger.warn('Request received but Firebase is not configured', { path: req.path });
    return res.status(503).json({ ok: false, error: 'Firebase no está configurado en este entorno' });
  }

  try {
    logger.info('Request body completo', req.body);

    const { llama, gas, movimiento } = req.body;

    // Fetch recent readings before saving so the new reading is not included
    // in its own trend calculation.
    let ultimasLecturas = [];
    try {
      const recentSnapshot = await db.collection('lecturas')
        .orderBy('fecha', 'desc')
        .limit(TREND_WINDOW)
        .get();
      ultimasLecturas = recentSnapshot.docs.map((doc) => doc.data());
    } catch (fetchErr) {
      // Non-fatal: predecirTendencia will return "estable" for an empty array.
      logger.warn('Could not fetch recent readings for trend analysis', fetchErr.message);
    }

    // Run all three ML analyses. clasificarRiesgo is async (ONNX inference);
    // the other two are synchronous and can run without awaiting.
    const riesgo        = await clasificarRiesgo({ llama, gas, movimiento });
    const anomalia      = detectarAnomalia({ llama, gas, movimiento });
    const prediccion_gas = predecirTendencia(ultimasLecturas);

    const lectura = {
      llama,
      gas,
      movimiento,
      fecha: new Date(),
      riesgo,
      anomalia,
      prediccion_gas,
    };

    const doc = await db.collection('lecturas').add(lectura);

    logger.info('Lectura guardada', { id: doc.id, riesgo, anomalia, prediccion_gas });

    // Log a high-visibility warning when risk is elevated so it stands out in
    // Railway's log stream and can be filtered with a keyword alert if needed.
    if (riesgo === 'alto') {
      logger.warn('ALERTA RIESGO ALTO', {
        id: doc.id,
        llama,
        gas,
        movimiento,
        anomalia,
        prediccion_gas,
        fecha: lectura.fecha,
      });
    } else if (riesgo === 'medio' && anomalia) {
      logger.warn('ALERTA RIESGO MEDIO + ANOMALIA', {
        id: doc.id,
        gas,
        prediccion_gas,
        fecha: lectura.fecha,
      });
    }

    res.status(201).json({ ok: true, id: doc.id, data: lectura });
  } catch (error) {
    logger.error('Error guardando lectura', error && error.stack ? error.stack : error);
    res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : 'Error en controlador',
      source: 'controller:guardarLectura',
    });
  }
};

const obtenerLecturasRecientes = async (req, res) => {
  if (!isFirebaseConfigured || !db) {
    logger.warn('Recent readings requested but Firebase is not configured', { path: req.path });
    return res.status(503).json({ ok: false, error: 'Firebase no está configurado en este entorno' });
  }

  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const snapshot = await db.collection('lecturas')
      .orderBy('fecha', 'desc')
      .limit(limit)
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

    return res.status(200).json({ ok: true, count: lecturas.length, lecturas });
  } catch (error) {
    logger.error('Error obteniendo lecturas recientes', error && error.stack ? error.stack : error);
    return res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : 'Error obteniendo lecturas',
      source: 'controller:obtenerLecturasRecientes'
    });
  }
};

module.exports = { guardarLectura, obtenerLecturasRecientes };