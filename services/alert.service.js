'use strict';

const GAS_EXTREME_THRESHOLD = 2000;
const GAS_SPIKE_DELTA = 350;
const ML_PROBABILITY_CRITICAL_THRESHOLD = 0.75;
const ML_PROBABILITY_WARNING_THRESHOLD = 0.55;
const ultimaAlertaPorTipo = new Map();

const COOLDOWN_MS = {
  llama_detectada: 10000,
  riesgo_alto: 60000,
  gas_extremo: 45000,
  cambio_extremo_gas: 45000,
  movimiento_detectado: 30000,
  anomalia_estadistica: 60000,
  probabilidad_incendio_alta: 30000,
  probabilidad_incendio_media: 45000,
  tendencia_gas_subiendo: 30000,
};

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
  const probabilidad = Number(lectura.probabilidad || 0);

  if (lectura.riesgo === 'alto' || lectura.alerta === true) {
    alertas.push({
      tipo: 'riesgo_alto',
      severidad: 'critical',
      titulo: 'Amenaza critica detectada por ML',
      mensaje: 'El analisis del modelo clasifico la lectura como riesgo ALTO. Revisa fuego, gas y presencia en el area.',
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
      titulo: 'Evidencia critica: llama detectada',
      mensaje: 'El sensor de llama confirma una senal de fuego. Revisa el area de inmediato.',
    });
  }

  if (lectura.gas >= GAS_EXTREME_THRESHOLD) {
    alertas.push({
      tipo: 'gas_extremo',
      severidad: 'critical',
      titulo: 'Alerta critica: gas alto',
      mensaje: `Nivel de gas elevado (${lectura.gas} ADC). Riesgo de incendio o explosion.`,
    });
  }

  if (gasPromedioReciente !== null && (lectura.gas - gasPromedioReciente) >= GAS_SPIKE_DELTA) {
    alertas.push({
      tipo: 'cambio_extremo_gas',
      severidad: 'high',
      titulo: 'Cambio extremo de gas',
      mensaje: `El gas subio ${Math.round(lectura.gas - gasPromedioReciente)} ADC sobre el promedio reciente.`,
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
