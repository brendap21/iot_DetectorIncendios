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
const { evaluarAlertas, filtrarAlertasPorCooldown } = require('../services/alert.service');
const { sendAlertToAll } = require('../services/push.service');
const runtimeStore = require('../services/runtime-store.service');

// Number of recent readings fetched from Firestore to compute gas trend.
const TREND_WINDOW = 10;

function parseBinaryFilter(value) {
  if (value === '0' || value === 0) return 0;
  if (value === '1' || value === 1) return 1;
  return null;
}

function parseBooleanFilter(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function matchesReadingFilters(reading, filters) {
  if (filters.riesgo && (reading.riesgo || 'normal') !== filters.riesgo) {
    return false;
  }

  if (filters.movimiento !== null && Number(reading.movimiento) !== filters.movimiento) {
    return false;
  }

  if (filters.llama !== null && Number(reading.llama) !== filters.llama) {
    return false;
  }

  if (filters.anomalia !== null && Boolean(reading.anomalia) !== filters.anomalia) {
    return false;
  }

  return true;
}

function isQuotaError(error) {
  const msg = error && error.message ? String(error.message) : '';
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded');
}

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
    runtimeStore.saveLectura({ ...lectura, id: doc.id });

    logger.info('Lectura guardada', { id: doc.id, riesgo, anomalia, prediccion_gas });

    const alertasGeneradas = evaluarAlertas({ lectura, ultimasLecturas });
    const alertasAEnviar = filtrarAlertasPorCooldown(alertasGeneradas);

    if (alertasAEnviar.length > 0) {
      for (const alerta of alertasAEnviar) {
        const alertaDoc = {
          ...alerta,
          lecturaId: doc.id,
          leida: false,
          fecha: new Date(),
        };

        await sendAlertToAll({
          title: alerta.titulo,
          body: alerta.mensaje,
          tag: alerta.tipo,
          severity: alerta.severidad,
          renotify: alerta.severidad === 'critical',
          requireInteraction: alerta.severidad === 'critical',
          vibrate: alerta.severidad === 'critical' ? [300, 150, 300, 150, 600] : [100],
          soundHint: alerta.severidad === 'critical' ? 'critical' : 'default',
          data: {
            lecturaId: doc.id,
            tipo: alerta.tipo,
            riesgo,
            gas,
            movimiento,
          },
          url: '/resultados',
        });

        try {
          const alertaRef = await db.collection('alertas').add(alertaDoc);
          runtimeStore.saveAlerta({ ...alertaDoc, id: alertaRef.id });
        } catch (alertSaveError) {
          // Persistencia de respaldo para no perder trazabilidad si Firestore falla.
          runtimeStore.saveAlerta(alertaDoc);
          logger.warn('No se pudo persistir alerta en Firestore, guardada en cache temporal', {
            tipo: alerta.tipo,
            error: alertSaveError && alertSaveError.message ? alertSaveError.message : String(alertSaveError),
          });
        }
      }
    }

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

    // Degrade gracefully when Firestore quota is exhausted.
    if (isQuotaError(error)) {
      try {
        const lecturaMem = {
          id: `mem-${Date.now()}`,
          llama: req.body && req.body.llama,
          gas: req.body && req.body.gas,
          movimiento: req.body && req.body.movimiento,
          fecha: new Date(),
          riesgo: 'normal',
          anomalia: false,
          prediccion_gas: 'estable',
        };

        runtimeStore.saveLectura(lecturaMem);
        return res.status(201).json({
          ok: true,
          degraded: true,
          warning: 'Firestore quota exceeded. Lectura guardada en cache temporal.',
          id: lecturaMem.id,
          data: lecturaMem,
        });
      } catch (fallbackErr) {
        logger.error('Error in degraded write fallback', fallbackErr && fallbackErr.stack ? fallbackErr.stack : fallbackErr);
      }
    }

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

  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const beforeRaw = typeof req.query.before === 'string' ? req.query.before.trim() : '';
  const beforeDate = beforeRaw ? new Date(beforeRaw) : null;
  const riesgoRaw = typeof req.query.riesgo === 'string' ? req.query.riesgo.trim().toLowerCase() : '';

  const filters = {
    riesgo: ['normal', 'medio', 'alto'].includes(riesgoRaw) ? riesgoRaw : null,
    movimiento: parseBinaryFilter(req.query.movimiento),
    llama: parseBinaryFilter(req.query.llama),
    anomalia: parseBooleanFilter(req.query.anomalia),
  };

  try {
    if (beforeRaw && Number.isNaN(beforeDate.getTime())) {
      return res.status(400).json({ ok: false, error: 'Parametro before invalido. Usa fecha ISO 8601.' });
    }

    const READ_BATCH_SIZE = 120;
    let cursorDate = beforeDate || null;
    let hasMore = true;
    let nextBefore = null;
    const lecturas = [];

    while (lecturas.length < limit && hasMore) {
      let query = db.collection('lecturas').orderBy('fecha', 'desc');
      if (cursorDate) {
        query = query.where('fecha', '<', cursorDate);
      }

      const snapshot = await query.limit(READ_BATCH_SIZE).get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const fecha = data.fecha && typeof data.fecha.toDate === 'function'
          ? data.fecha.toDate().toISOString()
          : (data.fecha ? new Date(data.fecha).toISOString() : null);

        const reading = {
          id: doc.id,
          llama: data.llama,
          gas: data.gas,
          movimiento: data.movimiento,
          fecha,
          riesgo: data.riesgo,
          anomalia: data.anomalia,
          prediccion_gas: data.prediccion_gas,
        };

        if (matchesReadingFilters(reading, filters)) {
          lecturas.push(reading);
          if (lecturas.length === limit) {
            nextBefore = fecha;
            break;
          }
        }
      }

      const lastData = snapshot.docs[snapshot.docs.length - 1].data() || {};
      if (!nextBefore) {
        const lastDate = lastData.fecha && typeof lastData.fecha.toDate === 'function'
          ? lastData.fecha.toDate()
          : (lastData.fecha ? new Date(lastData.fecha) : null);

        if (lastDate && !Number.isNaN(lastDate.getTime())) {
          cursorDate = lastDate;
          nextBefore = lastDate.toISOString();
        } else {
          hasMore = false;
          nextBefore = null;
        }
      }

      if (snapshot.size < READ_BATCH_SIZE) {
        hasMore = false;
      }

      if (lecturas.length === limit) {
        break;
      }
    }

    if (!hasMore) {
      nextBefore = null;
    }

    return res.status(200).json({
      ok: true,
      count: lecturas.length,
      lecturas,
      page: {
        limit,
        before: beforeRaw || null,
        nextBefore,
        hasMore: Boolean(nextBefore),
      },
    });
  } catch (error) {
    logger.error('Error obteniendo lecturas recientes', error && error.stack ? error.stack : error);

    if (isQuotaError(error)) {
      const fallback = runtimeStore.listLecturas({
        limit,
        before: beforeRaw || null,
        filters,
      });

      return res.status(200).json({
        ok: true,
        degraded: true,
        warning: 'Firestore quota exceeded. Respuesta servida desde cache temporal.',
        count: fallback.lecturas.length,
        lecturas: fallback.lecturas,
        page: fallback.page,
      });
    }

    return res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : 'Error obteniendo lecturas',
      source: 'controller:obtenerLecturasRecientes'
    });
  }
};

module.exports = { guardarLectura, obtenerLecturasRecientes };