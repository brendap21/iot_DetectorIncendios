'use strict';

const { db, isFirebaseConfigured } = require('../firebase');
const logger = require('../logger');
const runtimeStore = require('./runtime-store.service');

const DEFAULT_LIMIT = 200;

function normalizeReading(doc) {
  const data = doc.data ? doc.data() : doc || {};

  const fecha = data.fecha && typeof data.fecha.toDate === 'function'
    ? data.fecha.toDate().toISOString()
    : (data.fecha ? new Date(data.fecha).toISOString() : null);

  return {
    id: doc.id || data.id || null,
    llama: Number(data.llama || 0),
    gas: Number(data.gas || 0),
    movimiento: Number(data.movimiento || 0),
    fecha,
    riesgo: data.riesgo || 'normal',
    anomalia: Boolean(data.anomalia),
    prediccion_gas: data.prediccion_gas || 'estable',
  };
}

function calcularEstadisticas(lecturas) {
  const gasLecturas = lecturas.filter((item) => typeof item.gas === 'number');
  const totalLecturas = lecturas.length;
  const gasPromedio = gasLecturas.length
    ? gasLecturas.reduce((sum, item) => sum + item.gas, 0) / gasLecturas.length
    : 0;
  const gasMinimo = gasLecturas.length
    ? Math.min(...gasLecturas.map((item) => item.gas))
    : 0;
  const gasMaximo = gasLecturas.length
    ? Math.max(...gasLecturas.map((item) => item.gas))
    : 0;

  const riesgoCounts = lecturas.reduce(
    (acc, lectura) => {
      const nivel = lectura.riesgo || 'normal';
      if (!acc[nivel]) acc[nivel] = 0;
      acc[nivel] += 1;
      return acc;
    },
    { normal: 0, medio: 0, alto: 0 },
  );

  const tendenciaCounts = lecturas.reduce(
    (acc, lectura) => {
      const tendencia = lectura.prediccion_gas || 'estable';
      if (!acc[tendencia]) acc[tendencia] = 0;
      acc[tendencia] += 1;
      return acc;
    },
    { estable: 0, subiendo: 0, bajando: 0 },
  );

  const anomaliaCount = lecturas.reduce(
    (acc, lectura) => acc + (lectura.anomalia === true ? 1 : 0),
    0,
  );

  const modeloPresente = isFirebaseConfigured && db !== null;

  return {
    totalLecturas,
    gasPromedio,
    gasMinimo,
    gasMaximo,
    riesgoCounts,
    tendenciaCounts,
    anomaliaCount,
    modeloPresente,
  };
}

async function obtenerLecturasDeFirestore(limit = DEFAULT_LIMIT) {
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firebase no está configurado');
  }

  const snapshot = await db.collection('lecturas')
    .orderBy('fecha', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(normalizeReading);
}

async function obtenerEstadisticasLecturas(options = {}) {
  const limit = Number(options.limit) || DEFAULT_LIMIT;
  try {
    const lecturas = await obtenerLecturasDeFirestore(limit);
    return calcularEstadisticas(lecturas);
  } catch (error) {
    logger.warn('No se pudo calcular estadísticas desde Firestore, realizando fallback a cache local.', error.message);
    const fallback = runtimeStore.listLecturas({
      limit,
      before: null,
      filters: {
        riesgo: null,
        movimiento: null,
        llama: null,
        anomalia: null,
      },
    });
    return calcularEstadisticas(fallback.lecturas);
  }
}

module.exports = {
  obtenerEstadisticasLecturas,
  calcularEstadisticas,
  normalizeReading,
};
