'use strict';

const logger = require('../logger');
const { evaluarAlertas } = require('./alert.service');
const { calcularEstadisticas } = require('./data.service');
const { calcularEvaluacionModelo, esIncendioObservado } = require('./ml-evaluation.service');
const alertState = require('./alert-state.service');

const AIO_BASE_URL = 'https://io.adafruit.com/api/v2';
const DEFAULT_FEED = 'detector-incendios.estado';
const CACHE_TTL_MS = Number(process.env.AIO_CACHE_TTL_MS || 1000);

let cache = {
  before: null,
  expiresAt: 0,
  limit: 0,
  value: null,
};

function isAdafruitConfigured() {
  return Boolean(process.env.AIO_USERNAME && process.env.AIO_KEY);
}

function getFeedKey() {
  return process.env.AIO_STATE_FEED || DEFAULT_FEED;
}

function getConfig() {
  return {
    username: process.env.AIO_USERNAME,
    key: process.env.AIO_KEY,
    feedKey: getFeedKey(),
  };
}

function normalizeRisk(nivel, alerta) {
  const value = String(nivel || '').trim().toUpperCase();
  if (value === 'PELIGRO' || alerta === true || alerta === 1) return 'alto';
  if (value === 'ADVERTENCIA') return 'medio';
  return 'normal';
}

function parsePayload(value) {
  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      return JSON.parse(parsed);
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    logger.warn('No se pudo interpretar el JSON recibido desde Adafruit IO', error.message);
    return {};
  }
}

function calcularTendenciaGas(lecturas, index) {
  const actual = Number(lecturas[index] && lecturas[index].gas);
  const posteriores = lecturas
    .slice(index + 1, index + 6)
    .map((item) => Number(item.gas))
    .filter((gas) => Number.isFinite(gas));

  if (!Number.isFinite(actual) || posteriores.length < 2) {
    return 'estable';
  }

  const promedio = posteriores.reduce((sum, gas) => sum + gas, 0) / posteriores.length;
  const delta = actual - promedio;

  if (delta > 80) return 'subiendo';
  if (delta < -80) return 'bajando';
  return 'estable';
}

function normalizeDatum(datum) {
  const payload = parsePayload(datum.value);
  const alerta = payload.alerta === true || Number(payload.alerta) === 1;
  const fecha = datum.created_at ? new Date(datum.created_at).toISOString() : new Date().toISOString();
  const gas = Number(payload.gas || 0);
  const llama = Number(payload.llama || 0);
  const movimiento = Number(payload.movimiento || 0);

  return {
    id: datum.id || `aio-${Date.parse(fecha) || Date.now()}`,
    llama,
    gas,
    movimiento,
    fecha,
    riesgo: normalizeRisk(payload.nivel, alerta),
    nivel: payload.nivel || null,
    probabilidad: Number(payload.probabilidad || 0),
    alerta,
    anomalia: false,
    prediccion_gas: 'estable',
    source: 'adafruit-io',
  };
}

function severityRank(severidad) {
  const rank = { critical: 0, high: 1, medium: 2 };
  return rank[severidad] ?? 3;
}

function getHighestSeverity(alertas) {
  return alertas.reduce((highest, alerta) => {
    return severityRank(alerta.severidad) < severityRank(highest)
      ? alerta.severidad
      : highest;
  }, 'medium');
}

function buildIncidentEvidence(alertas, lectura) {
  const tipos = new Set(alertas.map((alerta) => alerta.tipo));
  const evidencia = [];
  const probabilidad = Number(lectura && lectura.probabilidad || 0);
  const gas = Number(lectura && lectura.gas || 0);

  if (tipos.has('llama_detectada')) {
    evidencia.push('Llama detectada');
  }

  if (tipos.has('gas_extremo')) {
    evidencia.push(`Gas alto (${gas} ADC)`);
  } else if (tipos.has('tendencia_gas_subiendo')) {
    evidencia.push('Gas subiendo');
  } else if (tipos.has('cambio_extremo_gas')) {
    evidencia.push('Cambio fuerte de gas');
  }

  if (tipos.has('riesgo_alto') || tipos.has('probabilidad_incendio_alta') || tipos.has('probabilidad_incendio_media')) {
    evidencia.push(`Analisis ML: ${Math.round(probabilidad * 100)}%`);
  }

  if (tipos.has('movimiento_detectado')) {
    evidencia.push('Movimiento detectado');
  }

  if (tipos.has('anomalia_estadistica')) {
    evidencia.push('Lectura fuera de lo normal');
  }

  return evidencia.length > 0 ? evidencia : ['Lectura con riesgo'];
}

function summarizeAlertsAsIncident(alertas, lectura) {
  if (!Array.isArray(alertas) || alertas.length === 0 || !lectura) {
    return [];
  }

  const severidad = getHighestSeverity(alertas);
  const evidencia = buildIncidentEvidence(alertas, lectura);

  if (severidad === 'critical') {
    return [{
      tipo: 'incidente_actual',
      severidad,
      titulo: 'Amenaza critica',
      mensaje: 'Hay senales de incendio o explosion. Revisa el area de inmediato.',
      accion: 'Alejate si no es seguro, ventila el area y corta fuentes de ignicion solo si puedes hacerlo sin riesgo.',
      evidencia,
      lecturaId: lectura.id,
      leida: false,
      fecha: lectura.fecha,
      source: 'adafruit-io',
    }];
  }

  if (severidad === 'high') {
    return [{
      tipo: 'incidente_actual',
      severidad,
      titulo: 'Advertencia de riesgo',
      mensaje: 'El detector ve una condicion que puede volverse peligrosa.',
      accion: 'Revisa gas, ventilacion y el area cercana al detector.',
      evidencia,
      lecturaId: lectura.id,
      leida: false,
      fecha: lectura.fecha,
      source: 'adafruit-io',
    }];
  }

  return [{
    tipo: 'incidente_actual',
    severidad,
    titulo: 'Evento detectado',
    mensaje: 'Se detecto actividad cerca del sensor.',
    accion: 'Verifica que el detector siga en su lugar y que no haya riesgo visible.',
    evidencia,
    lecturaId: lectura.id,
    leida: false,
    fecha: lectura.fecha,
    source: 'adafruit-io',
  }];
}

function matchesReadingFilters(reading, filters) {
  if (!filters) return true;
  if (filters.riesgo && (reading.riesgo || 'normal') !== filters.riesgo) return false;
  if (filters.movimiento !== null && Number(reading.movimiento) !== filters.movimiento) return false;
  if (filters.llama !== null && Number(reading.llama) !== filters.llama) return false;
  if (filters.anomalia !== null && Boolean(reading.anomalia) !== filters.anomalia) return false;
  return true;
}

async function fetchFeedData({ limit = 20, before = null } = {}) {
  if (!isAdafruitConfigured()) {
    throw new Error('Adafruit IO no esta configurado');
  }

  const { username, key, feedKey } = getConfig();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const now = Date.now();

  if (
    cache.before === (before || null) &&
    cache.value &&
    cache.limit >= safeLimit &&
    cache.expiresAt > now
  ) {
    return cache.value.slice(0, safeLimit);
  }

  const url = new URL(`${AIO_BASE_URL}/${encodeURIComponent(username)}/feeds/${encodeURIComponent(feedKey)}/data`);
  url.searchParams.set('limit', String(safeLimit));
  url.searchParams.set('include', 'id,value,created_at');

  if (before) {
    url.searchParams.set('end_time', before);
  }

  const response = await fetch(url, {
    headers: {
      'X-AIO-Key': key,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Adafruit IO respondio ${response.status}: ${body.slice(0, 180)}`);
  }

  const data = await response.json();
  const items = Array.isArray(data) ? data : [];
  cache = {
    before: before || null,
    expiresAt: now + CACHE_TTL_MS,
    limit: safeLimit,
    value: items,
  };

  return items;
}

async function obtenerLecturasAdafruit(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const before = options.before || null;
  const filters = options.filters || null;
  const raw = await fetchFeedData({ limit: Math.max(limit, 20), before });
  const todas = raw.map(normalizeDatum);

  todas.forEach((lectura, index) => {
    lectura.prediccion_gas = calcularTendenciaGas(todas, index);
  });

  const lecturas = todas
    .filter((lectura) => matchesReadingFilters(lectura, filters))
    .slice(0, limit);

  const last = lecturas[lecturas.length - 1];
  const hasMore = raw.length >= limit;

  return {
    ok: true,
    source: 'adafruit-io',
    count: lecturas.length,
    lecturas,
    page: {
      limit,
      before,
      nextBefore: hasMore && last ? last.fecha : null,
      hasMore: Boolean(hasMore && last),
    },
  };
}

async function obtenerEstadisticasAdafruit(limit = 100) {
  const resultado = await obtenerLecturasAdafruit({ limit });
  return calcularEstadisticas(resultado.lecturas);
}

async function obtenerAlertasAdafruit(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const severidades = options.severidades || [];
  const leidaFiltro = options.leida === undefined ? null : options.leida;
  const resultado = await obtenerLecturasAdafruit({ limit: Math.max(limit, 30) });
  const alertas = [];

  resultado.lecturas.forEach((lectura, index) => {
    const generadas = evaluarAlertas({
      lectura,
      ultimasLecturas: resultado.lecturas.slice(index + 1, index + 8),
    });

    generadas.forEach((alerta) => {
      alertas.push({
        id: `${lectura.id}-${alerta.tipo}`,
        tipo: alerta.tipo,
        severidad: alerta.severidad,
        titulo: alerta.titulo,
        mensaje: alerta.mensaje,
        lecturaId: lectura.id,
        leida: false,
        fecha: lectura.fecha,
        source: 'adafruit-io',
      });
    });
  });

  const unicasPorTipo = [];
  const tiposVistos = new Set();

  alertas.forEach((alerta) => {
    if (tiposVistos.has(alerta.tipo)) {
      return;
    }

    tiposVistos.add(alerta.tipo);
    unicasPorTipo.push(alerta);
  });

  const latestReading = resultado.lecturas[0] || null;
  const summarizedAlerts = summarizeAlertsAsIncident(unicasPorTipo, latestReading);
  const activeAlerts = alertState.syncActiveAlerts(summarizedAlerts);

  const filtradas = activeAlerts.filter((alerta) => {
    const severidadOk = severidades.length === 0 || severidades.includes((alerta.severidad || '').toLowerCase());
    const leidaOk = leidaFiltro === null || alerta.leida === leidaFiltro;
    return severidadOk && leidaOk;
  });

  return {
    ok: true,
    source: 'adafruit-io',
    count: Math.min(filtradas.length, limit),
    alertas: filtradas.slice(0, limit),
  };
}

async function obtenerEvaluacionAdafruit(limit = 300) {
  const resultado = await obtenerLecturasAdafruit({ limit: Math.min(limit, 100) });
  const lecturas = resultado.lecturas.map((lectura) => ({
    ...lectura,
    incendioObservado: esIncendioObservado(lectura),
  }));

  return {
    ok: true,
    source: 'adafruit-io',
    evaluacion: calcularEvaluacionModelo(lecturas),
    lecturas: lecturas.slice(0, 20),
  };
}

module.exports = {
  isAdafruitConfigured,
  getConfig,
  obtenerLecturasAdafruit,
  obtenerEstadisticasAdafruit,
  obtenerAlertasAdafruit,
  obtenerEvaluacionAdafruit,
};
