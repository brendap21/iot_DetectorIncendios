'use strict';

const { db } = require('../firebase');
const logger = require('../logger');

const GAS_EXTREME_THRESHOLD = 800;  // Alerta CRÍTICA
const GAS_HIGH_THRESHOLD = 500;      // Alerta WARNING
const GAS_SPIKE_DELTA = 150;
const ML_PROBABILITY_CRITICAL_THRESHOLD = 0.75;
const ML_PROBABILITY_WARNING_THRESHOLD = 0.55;

const COOLDOWN_MS = {
  llama_detectada: 0,
  riesgo_alto: 0,
  gas_extremo: 0,
  gas_alto: 0,
  cambio_extremo_gas: 0,
  movimiento_detectado: 0,      // Reducido: permite detectar movimiento más frecuentemente
  anomalia_estadistica: 0,
  probabilidad_incendio_alta: 0,
  probabilidad_incendio_media: 0,
  tendencia_gas_subiendo: 0,
};

function inferirProbabilidadML(lectura) {
  const probabilidadDirecta = Number(lectura && lectura.probabilidad);
  if (Number.isFinite(probabilidadDirecta) && probabilidadDirecta >= 0) {
    return Math.min(Math.max(probabilidadDirecta, 0), 1);
  }

  const riesgo = String(lectura && lectura.riesgo || '').toLowerCase();
  if (riesgo === 'alto') {
    return 0.82;
  }

  if (riesgo === 'medio') {
    return 0.58;
  }

  if (lectura && lectura.alerta === true) {
    return 0.8;
  }

  return 0.12;
}

function promedioGas(lecturas) {
  if (!Array.isArray(lecturas) || lecturas.length === 0) {
    return null;
  }

  const gases = lecturas
    .map((l) => Number(l.gas))
    .filter((g) => Number.isFinite(g));

  if (gases.length === 0) {
    return null;
  }

  const total = gases.reduce((acc, val) => acc + val, 0);
  return total / gases.length;
}

function obtenerLecturaAnterior(ultimas) {
  // Retorna la lectura más reciente (que es la lectura anterior a la actual)
  if (Array.isArray(ultimas) && ultimas.length > 0) {
    return ultimas[0];
  }
  return null;
}

function evaluarAlertas({ lectura, ultimasLecturas }) {
  const alertas = [];
  const gasPromedioReciente = promedioGas(ultimasLecturas);
  const probabilidad = inferirProbabilidadML(lectura);
  const lecturaAnterior = obtenerLecturaAnterior(ultimasLecturas);
  const sensorDescriptor = ' [Sensor MQ-2]';

  if (lectura.riesgo === 'alto' || lectura.alerta === true) {
    alertas.push({
      tipo: 'riesgo_alto',
      severidad: 'critical',
      titulo: 'Amenaza critica detectada',
      mensaje: `El análisis ML clasificó como riesgo ALTO${sensorDescriptor}. Revisa fuego, gas y presencia en el área.`,
    });
  }

  if (probabilidad >= ML_PROBABILITY_CRITICAL_THRESHOLD) {
    alertas.push({
      tipo: 'probabilidad_incendio_alta',
      severidad: 'critical',
      titulo: 'Probabilidad alta de incendio',
      mensaje: `El modelo estima ${(probabilidad * 100).toFixed(0)}% de probabilidad de incendio o evento critico.`,
    });
  } else if (probabilidad >= ML_PROBABILITY_WARNING_THRESHOLD) {
    alertas.push({
      tipo: 'probabilidad_incendio_media',
      severidad: 'high',
      titulo: 'Probabilidad elevada de incendio',
      mensaje: `El modelo estima ${(probabilidad * 100).toFixed(0)}% de probabilidad. Mantente atento a gas y llama.`,
    });
  }

  if (lectura.prediccion_gas === 'subiendo') {
    alertas.push({
      tipo: 'tendencia_gas_subiendo',
      severidad: 'high',
      titulo: 'Tendencia de gas en aumento',
      mensaje: 'El analisis de tendencia indica que la concentracion de gas esta subiendo.',
    });
  }

  if (lectura.llama === 1) {
    // Detectar cambio: si la lectura anterior tenía llama=0 y ahora es 1, generar alerta
    const huboLlamaAntes = lecturaAnterior && Number(lecturaAnterior.llama) === 1;
    const esNuevaLlama = !huboLlamaAntes;

    if (esNuevaLlama) {
      // Cambio detectado: 0→1 (fuego detectado)
      alertas.push({
        tipo: 'llama_detectada',
        severidad: 'critical',
        titulo: '🔥 LLAMA DETECTADA - EVACUACIÓN',
        mensaje: 'Sensor de llama confirmó FUEGO [KY-026]. EVACÚA el área de INMEDIATO.',
      });
    } else {
      // Continuidad: ya había llama antes y sigue habiendo → mantener alerta activa
      alertas.push({
        tipo: 'llama_detectada',
        severidad: 'critical',
        titulo: '🔥 LLAMA DETECTADA - EVACUACIÓN',
        mensaje: 'Sensor de llama confirmó FUEGO [KY-026]. EVACÚA el área de INMEDIATO.',
      });
    }
  }

  if (lectura.gas >= GAS_EXTREME_THRESHOLD) {
    alertas.push({
      tipo: 'gas_extremo',
      severidad: 'critical',
      titulo: 'ALERTA CRÍTICA: Gas muy alto',
      mensaje: `Concentración de gas CRÍTICA (${lectura.gas} ADC)${sensorDescriptor}. Posible incendio o fuga.`,
    });
  } else if (lectura.gas >= GAS_HIGH_THRESHOLD) {
    alertas.push({
      tipo: 'gas_alto',
      severidad: 'high',
      titulo: 'Alerta: Concentración de gas elevada',
      mensaje: `Gas detectado (${lectura.gas} ADC)${sensorDescriptor}. Revisa ventilación y fuentes potenciales.`,
    });
  }

  if (gasPromedioReciente !== null && (lectura.gas - gasPromedioReciente) >= GAS_SPIKE_DELTA) {
    alertas.push({
      tipo: 'cambio_extremo_gas',
      severidad: 'high',
      titulo: 'Cambio rápido en concentración de gas',
      mensaje: `Gas subió ${Math.round(lectura.gas - gasPromedioReciente)} ADC sobre promedio${sensorDescriptor}.`,
    });
  }

  if (lectura.movimiento === 1) {
    // Detectar cambio: si la lectura anterior tenía movimiento=0 y ahora es 1, generar alerta
    const huboMovimientoAntes = lecturaAnterior && Number(lecturaAnterior.movimiento) === 1;
    const esNuevoMovimiento = !huboMovimientoAntes;

    if (esNuevoMovimiento) {
      // Cambio detectado: 0→1 (movimiento comenzó)
      alertas.push({
        tipo: 'movimiento_detectado',
        severidad: 'medium',
        titulo: 'Movimiento detectado',
        mensaje: 'El sensor de movimiento detecto presencia en el area monitoreada.',
      });
    }
  }

  if (lectura.anomalia === true) {
    alertas.push({
      tipo: 'anomalia_estadistica',
      severidad: 'medium',
      titulo: 'Anomalia detectada por ML',
      mensaje: 'La lectura actual se sale del patron historico esperado por el modelo.',
    });
  }

  return alertas;
}

function filtrarAlertasPorCooldown(alertas) {
  const ahora = Date.now();

  return alertas.filter((alerta) => {
    const tipo = alerta.tipo;
    const cooldown = COOLDOWN_MS[tipo] ?? 30000;
    const ultimo = ultimaAlertaPorTipo.get(tipo) || 0;

    if ((ahora - ultimo) < cooldown) {
      return false;
    }

    ultimaAlertaPorTipo.set(tipo, ahora);
    return true;
  });
}

// Obtener estado persistente de amenaza desde Firestore
async function obtenerEstadoAmenaza(tipoAmenaza) {
  if (!db) return null;
  
  try {
    const docRef = db.collection('threat_states').doc(tipoAmenaza);
    const snapshot = await docRef.get();
    return snapshot.exists ? snapshot.data() : null;
  } catch (error) {
    logger.warn(`Error obteniendo estado de amenaza ${tipoAmenaza}:`, error.message);
    return null;
  }
}

// Actualizar estado de amenaza en Firestore
async function actualizarEstadoAmenaza(tipoAmenaza, estado) {
  if (!db) return;
  
  try {
    const docRef = db.collection('threat_states').doc(tipoAmenaza);
    await docRef.set(estado, { merge: true });
  } catch (error) {
    logger.warn(`Error actualizando estado de amenaza ${tipoAmenaza}:`, error.message);
  }
}

// Detectar cambios de estado y filtrar alertas dinámicamente
async function filtrarAlertasPorEstadoDinamico(alertas) {
  if (!Array.isArray(alertas) || alertas.length === 0) {
    return alertas;
  }

  // Requisito del prototipo: cada deteccion debe generar alerta/notificacion.
  // No se aplica cooldown ni estado persistente para bloquear repeticiones.
  return alertas;
}

// Resolver una amenaza (marcar como atendida)
async function resolverAmenaza(tipoAmenaza) {
  if (!db) return;
  
  try {
    const estadoAmenaza = await obtenerEstadoAmenaza(tipoAmenaza);
    if (estadoAmenaza) {
      estadoAmenaza.estado = 'resolved';
      estadoAmenaza.resueltaEn = new Date();
      await actualizarEstadoAmenaza(tipoAmenaza, estadoAmenaza);
      logger.info(`Amenaza resuelta: ${tipoAmenaza}`);
    }
  } catch (error) {
    logger.error(`Error resolviendo amenaza ${tipoAmenaza}:`, error.message);
  }
}

// Obtener estado actual de todas las amenazas
async function obtenerEstadoAmenazas() {
  if (!db) return [];
  
  try {
    const snapshot = await db.collection('threat_states').get();
    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    logger.error('Error obteniendo estados de amenazas:', error.message);
    return [];
  }
}

module.exports = { 
  evaluarAlertas, 
  filtrarAlertasPorCooldown,  // Mantener para compatibilidad
  filtrarAlertasPorEstadoDinamico,  // Nuevo sistema
  obtenerEstadoAmenaza,
  actualizarEstadoAmenaza,
  resolverAmenaza,
  obtenerEstadoAmenazas,
};
