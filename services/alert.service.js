'use strict';

const GAS_EXTREME_THRESHOLD = 800;  // Alerta CRÍTICA
const GAS_HIGH_THRESHOLD = 500;      // Alerta WARNING
const GAS_SPIKE_DELTA = 150;
const ML_PROBABILITY_CRITICAL_THRESHOLD = 0.75;
const ML_PROBABILITY_WARNING_THRESHOLD = 0.55;
const ultimaAlertaPorTipo = new Map();

const COOLDOWN_MS = {
  llama_detectada: 5000,
  riesgo_alto: 30000,
  gas_extremo: 20000,
  gas_alto: 40000,
  cambio_extremo_gas: 30000,
  movimiento_detectado: 60000,
  anomalia_estadistica: 60000,
  probabilidad_incendio_alta: 20000,
  probabilidad_incendio_media: 30000,
  tendencia_gas_subiendo: 20000,
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

function evaluarAlertas({ lectura, ultimasLecturas }) {
  const alertas = [];
  const gasPromedioReciente = promedioGas(ultimasLecturas);
  const probabilidad = inferirProbabilidadML(lectura);
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
    alertas.push({
      tipo: 'llama_detectada',
      severidad: 'critical',
      titulo: '🔥 LLAMA DETECTADA - EVACUACIÓN',
      mensaje: 'Sensor de llama confirmó FUEGO [KY-026]. EVACÚA el área de INMEDIATO.',
    });
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
    alertas.push({
      tipo: 'movimiento_detectado',
      severidad: 'medium',
      titulo: 'Movimiento detectado',
      mensaje: 'El sensor de movimiento detecto presencia en el area monitoreada.',
    });
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
    const cooldown = COOLDOWN_MS[tipo] || 30000;
    const ultimo = ultimaAlertaPorTipo.get(tipo) || 0;

    if ((ahora - ultimo) < cooldown) {
      return false;
    }

    ultimaAlertaPorTipo.set(tipo, ahora);
    return true;
  });
}

module.exports = { evaluarAlertas, filtrarAlertasPorCooldown };
