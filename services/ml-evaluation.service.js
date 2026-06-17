'use strict';

function esPrediccionIncendio(riesgo) {
  const value = String(riesgo || '').toLowerCase();
  return value === 'alto' || value === 'peligro' || value === 'critico' || value === 'critical';
}

function dividirSeguro(numerador, denominador) {
  return denominador === 0 ? null : numerador / denominador;
}

function normalizarIncendioReal(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function calcularEvaluacionModelo(lecturas) {
  const validadas = Array.isArray(lecturas)
    ? lecturas.filter((lectura) => normalizarIncendioReal(lectura.incendioReal) !== null)
    : [];

  const matriz = validadas.reduce(
    (acc, lectura) => {
      const real = normalizarIncendioReal(lectura.incendioReal);
      const predijoIncendio = esPrediccionIncendio(lectura.riesgo);

      if (predijoIncendio && real) acc.verdaderosPositivos += 1;
      else if (!predijoIncendio && !real) acc.verdaderosNegativos += 1;
      else if (predijoIncendio && !real) acc.falsosPositivos += 1;
      else acc.falsosNegativos += 1;

      return acc;
    },
    {
      verdaderosPositivos: 0,
      verdaderosNegativos: 0,
      falsosPositivos: 0,
      falsosNegativos: 0,
    },
  );

  const total = validadas.length;
  const exactitud = dividirSeguro(matriz.verdaderosPositivos + matriz.verdaderosNegativos, total);
  const precision = dividirSeguro(
    matriz.verdaderosPositivos,
    matriz.verdaderosPositivos + matriz.falsosPositivos,
  );
  const sensibilidad = dividirSeguro(
    matriz.verdaderosPositivos,
    matriz.verdaderosPositivos + matriz.falsosNegativos,
  );
  const f1 = precision === null || sensibilidad === null || precision + sensibilidad === 0
    ? null
    : (2 * precision * sensibilidad) / (precision + sensibilidad);

  return {
    totalLecturas: Array.isArray(lecturas) ? lecturas.length : 0,
    totalValidadas: total,
    totalPendientes: Math.max((Array.isArray(lecturas) ? lecturas.length : 0) - total, 0),
    matriz,
    metricas: {
      exactitud,
      precision,
      sensibilidad,
      f1,
    },
  };
}

module.exports = {
  calcularEvaluacionModelo,
  esPrediccionIncendio,
  normalizarIncendioReal,
};
