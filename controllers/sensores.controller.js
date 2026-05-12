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
    const { llama, gas, movimiento } = req.body;

    const lectura = { llama, gas, movimiento, fecha: new Date() };

    const doc = await db.collection('lecturas').add(lectura);

    logger.info('Lectura guardada', { id: doc.id });

    res.status(201).json({ ok: true, id: doc.id, data: lectura });
  } catch (error) {
    logger.error('Error guardando lectura', error && error.stack ? error.stack : error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = { guardarLectura };