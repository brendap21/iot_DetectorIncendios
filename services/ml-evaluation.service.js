'use strict';

function esPrediccionIncendio(riesgo) {
  const value = String(riesgo || '').toLowerCase();
  return value === 'alto' || value === 'peligro' || value === 'critico' || value === 'critical';
}

function esIncendioObservado(lectura) {
  const llama = Number(lectura && lectura.llama) === 1;
  const gas = Number(lectura && lectura.gas) || 0;
  return llama || gas >= 1800;
}

function dividirSeguro(numerador, denominador) {
  return denominador === 0 ? null : numerador / denominador;
}

function calcularEvaluacionModelo(lecturas) {
  const evaluadas = Array.isArray(lecturas) ? lecturas : [];

  const matriz = evaluadas.reduce(
    (acc, lectura) => {
      const real = esIncendioObservado(lectura);
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

  const total = evaluadas.length;
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
    totalLecturas: total,
    totalEvaluadas: total,
    totalObservadasIncendio: evaluadas.filter(esIncendioObservado).length,
    criterioReal: 'Incendio observado cuando llama = 1 o gas >= 1800 ADC.',
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
  esIncendioObservado,
};
