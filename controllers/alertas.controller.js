'use strict';

const { db, isFirebaseConfigured } = require('../firebase');
const logger = require('../logger');
const {
  getPublicVapidKey,
  hasVapidKeys,
  saveSubscription,
  removeSubscription,
} = require('../services/push.service');

function parseBooleanQuery(value) {
  if (value === undefined) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

const suscribirNotificaciones = async (req, res) => {
  try {
    const subscription = req.body && req.body.subscription;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ ok: false, error: 'Suscripcion invalida' });
    }

    const result = await saveSubscription(subscription);

    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason });
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    logger.error('Error guardando suscripcion push', error && error.stack ? error.stack : error);
    return res.status(500).json({ ok: false, error: 'Error guardando suscripcion' });
  }
};

const desuscribirNotificaciones = async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;

    if (!endpoint) {
      return res.status(400).json({ ok: false, error: 'Endpoint requerido' });
    }

    await removeSubscription(endpoint);
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Error removiendo suscripcion push', error && error.stack ? error.stack : error);
    return res.status(500).json({ ok: false, error: 'Error removiendo suscripcion' });
  }
};

const obtenerPublicKey = (req, res) => {
  if (!hasVapidKeys) {
    return res.status(503).json({ ok: false, error: 'Push deshabilitado. Faltan llaves VAPID.' });
  }

  return res.status(200).json({ ok: true, publicKey: getPublicVapidKey() });
};

const obtenerAlertasRecientes = async (req, res) => {
  if (!isFirebaseConfigured || !db) {
    return res.status(503).json({ ok: false, error: 'Firebase no esta configurado' });
  }

  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const severidades = typeof req.query.severidad === 'string' && req.query.severidad.trim()
      ? req.query.severidad.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const leidaFiltro = parseBooleanQuery(req.query.leida);

    const snapshot = await db.collection('alertas')
      .orderBy('fecha', 'desc')
      .limit(limit)
      .get();

    const alertasRaw = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const fecha = data.fecha && typeof data.fecha.toDate === 'function'
        ? data.fecha.toDate().toISOString()
        : (data.fecha ? new Date(data.fecha).toISOString() : null);

      return {
        id: doc.id,
        tipo: data.tipo,
        severidad: data.severidad,
        titulo: data.titulo,
        mensaje: data.mensaje,
        lecturaId: data.lecturaId,
        leida: data.leida === true,
        fecha,
      };
    });

    const alertas = alertasRaw.filter((alerta) => {
      const severidadOk = severidades.length === 0 || severidades.includes((alerta.severidad || '').toLowerCase());
      const leidaOk = leidaFiltro === null || alerta.leida === leidaFiltro;
      return severidadOk && leidaOk;
    });

    return res.status(200).json({ ok: true, count: alertas.length, alertas });
  } catch (error) {
    logger.error('Error leyendo alertas recientes', error && error.stack ? error.stack : error);
    return res.status(500).json({ ok: false, error: 'No fue posible cargar alertas' });
  }
};

const marcarAlertaLeida = async (req, res) => {
  if (!isFirebaseConfigured || !db) {
    return res.status(503).json({ ok: false, error: 'Firebase no esta configurado' });
  }

  try {
    const id = req.params && req.params.id;
    if (!id) {
      return res.status(400).json({ ok: false, error: 'ID de alerta requerido' });
    }

    const ref = db.collection('alertas').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });
    }

    await ref.set({ leida: true, fechaLectura: new Date() }, { merge: true });
    return res.status(200).json({ ok: true, id, leida: true });
  } catch (error) {
    logger.error('Error marcando alerta como leida', error && error.stack ? error.stack : error);
    return res.status(500).json({ ok: false, error: 'No fue posible actualizar la alerta' });
  }
};

module.exports = {
  suscribirNotificaciones,
  desuscribirNotificaciones,
  obtenerPublicKey,
  obtenerAlertasRecientes,
  marcarAlertaLeida,
};
