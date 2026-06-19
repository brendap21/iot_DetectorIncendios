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

function calcularEvaluacionModelo(lecturas) {
  /**
   * Calcula métricas de pseudo-validación basadas en heurístico.
   * Maneja casos con datos limitados devolviendo 0 en lugar de null.
   */
  const evaluadas = Array.isArray(lecturas) ? lecturas : [];

  if (evaluadas.length === 0) {
    return {
      totalLecturas: 0,
      totalEvaluadas: 0,
      totalObservadasIncendio: 0,
      criterioReal: 'Incendio observado cuando llama = 1 o gas >= 1800 ADC.',
      matriz: {
        verdaderosPositivos: 0,
        verdaderosNegativos: 0,
        falsosPositivos: 0,
        falsosNegativos: 0,
      },
      metricas: {
        exactitud: 0,
        precision: 0,
        sensibilidad: 0,
        f1: 0,
      },
      advertencia: 'Sin datos disponibles para evaluación',
    };
  }

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
  const totalObservadasIncendio = evaluadas.filter(esIncendioObservado).length;

  // Calcula exactitud
  const exactitud = total > 0 
    ? (matriz.verdaderosPositivos + matriz.verdaderosNegativos) / total 
    : 0;

  // Calcula precision (si no hay predicciones positivas, retorna 0)
  const totalPrediccionesPositivas = matriz.verdaderosPositivos + matriz.falsosPositivos;
  const precision = totalPrediccionesPositivas > 0
    ? matriz.verdaderosPositivos / totalPrediccionesPositivas
    : 0;

  // Calcula sensibilidad (si no hay incendios reales, retorna 0)
  const totalIncendiosReales = matriz.verdaderosPositivos + matriz.falsosNegativos;
  const sensibilidad = totalIncendiosReales > 0
    ? matriz.verdaderosPositivos / totalIncendiosReales
    : 0;

  // Calcula F1-score
  const f1 = precision + sensibilidad > 0
    ? (2 * precision * sensibilidad) / (precision + sensibilidad)
    : 0;

  return {
    totalLecturas: total,
    totalEvaluadas: total,
    totalObservadasIncendio,
    criterioReal: 'Incendio observado cuando llama = 1 o gas >= 1800 ADC.',
    matriz,
    metricas: {
      exactitud: parseFloat(exactitud.toFixed(4)),
      precision: parseFloat(precision.toFixed(4)),
      sensibilidad: parseFloat(sensibilidad.toFixed(4)),
      f1: parseFloat(f1.toFixed(4)),
    },
  };
}

module.exports = {
  calcularEvaluacionModelo,
  esPrediccionIncendio,
  esIncendioObservado,
};
