// Controller: guardarLectura
// Receives sensor payload and persists it to Firestore. If Firestore
// is not configured, respond with 503 so the deploy proxy can distinguish
// between application-level errors and infrastructure problems.
const { db, isFirebaseConfigured, firebaseInitError } = require('../firebase');
const logger = require('../logger');

const guardarLectura = async (req, res) => {
  if (!isFirebaseConfigured || !db) {
    logger.warn('Request received but Firebase is not configured', { path: req.path });
    return res.status(503).json({ ok: false, error: 'Firebase no está configurado en este entorno' });
  }

  try {
    logger.info('Request body completo', req.body);
    
    const { llama, gas, movimiento } = req.body;

    const lectura = { llama, gas, movimiento, fecha: new Date() };

    const doc = await db.collection('lecturas').add(lectura);

    logger.info('Lectura guardada', { id: doc.id });

    res.status(201).json({ ok: true, id: doc.id, data: lectura });
  } catch (error) {
    logger.error('Error guardando lectura', error && error.stack ? error.stack : error);
    res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : 'Error en controlador',
      source: 'controller:guardarLectura'
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