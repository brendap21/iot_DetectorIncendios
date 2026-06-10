'use strict';

const GAS_EXTREME_THRESHOLD = 2000;
const GAS_SPIKE_DELTA = 350;
const ultimaAlertaPorTipo = new Map();

const COOLDOWN_MS = {
  llama_detectada: 3000,
  riesgo_alto: 15000,
  gas_extremo: 45000,
  cambio_extremo_gas: 45000,
  movimiento_detectado: 30000,
  anomalia_estadistica: 60000,
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

  if (lectura.llama === 1) {
    alertas.push({
      tipo: 'llama_detectada',
      severidad: 'critical',
      titulo: 'Alerta critica: llama detectada',
      mensaje: 'El sensor de llama reporto una deteccion. Revisa el area de inmediato.',
    });
  }

  if (lectura.gas >= GAS_EXTREME_THRESHOLD) {
    alertas.push({
      tipo: 'gas_extremo',
      severidad: 'high',
      titulo: 'Alerta de gas alto',
      mensaje: `Nivel de gas elevado (${lectura.gas} ADC).`,
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
      titulo: 'Anomalia detectada',
      mensaje: 'La lectura actual se sale del patron historico esperado.',
    });
  }

  if (lectura.riesgo === 'alto') {
    alertas.push({
      tipo: 'riesgo_alto',
      severidad: 'critical',
      titulo: 'Riesgo alto',
      mensaje: 'El modelo de riesgo clasifico la lectura en nivel ALTO.',
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
