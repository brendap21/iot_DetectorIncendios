'use strict';

const MAX_LECTURAS = 800;
const MAX_ALERTAS = 800;

const state = {
  lecturas: [],
  alertas: [],
};

function toIso(fecha) {
  if (!fecha) return null;
  if (typeof fecha === 'string') return fecha;
  if (fecha instanceof Date) return fecha.toISOString();
  if (typeof fecha.toDate === 'function') return fecha.toDate().toISOString();

  const parsed = new Date(fecha);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function pushBounded(arr, value, max) {
  arr.unshift(value);
  if (arr.length > max) {
    arr.length = max;
  }
}

function saveLectura(lectura) {
  const copy = {
    id: lectura.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    llama: Number(lectura.llama || 0),
    gas: Number(lectura.gas || 0),
    movimiento: Number(lectura.movimiento || 0),
    fecha: toIso(lectura.fecha) || new Date().toISOString(),
    riesgo: lectura.riesgo || 'normal',
    anomalia: Boolean(lectura.anomalia),
    prediccion_gas: lectura.prediccion_gas || 'estable',
    probabilidad: Number.isFinite(Number(lectura.probabilidad)) ? Number(lectura.probabilidad) : null,
    alerta: typeof lectura.alerta === 'boolean' ? lectura.alerta : null,
    nivel: typeof lectura.nivel === 'string' ? lectura.nivel : null,
    incendioReal: typeof lectura.incendioReal === 'boolean' ? lectura.incendioReal : null,
    validadoEn: toIso(lectura.validadoEn) || null,
  };

  pushBounded(state.lecturas, copy, MAX_LECTURAS);
}

function saveAlerta(alerta) {
  const copy = {
    id: alerta.id || `mem-alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: alerta.tipo || 'desconocido',
    severidad: alerta.severidad || 'medium',
    titulo: alerta.titulo || 'Alerta',
    mensaje: alerta.mensaje || '',
    lecturaId: alerta.lecturaId || null,
    leida: Boolean(alerta.leida),
    fecha: toIso(alerta.fecha) || new Date().toISOString(),
  };

  pushBounded(state.alertas, copy, MAX_ALERTAS);
}

function matchLectura(lectura, filters) {
  if (filters.riesgo && (lectura.riesgo || 'normal') !== filters.riesgo) return false;
  if (filters.movimiento !== null && Number(lectura.movimiento) !== filters.movimiento) return false;
  if (filters.llama !== null && Number(lectura.llama) !== filters.llama) return false;
  if (filters.anomalia !== null && Boolean(lectura.anomalia) !== filters.anomalia) return false;
  return true;
}

function listLecturas(opts) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const before = opts.before ? new Date(opts.before) : null;

  const filtered = state.lecturas
    .filter((l) => {
      if (before && !Number.isNaN(before.getTime())) {
        const fecha = new Date(l.fecha);
        if (fecha >= before) return false;
      }
      return matchLectura(l, opts.filters || {});
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const chunk = filtered.slice(0, limit);
  const nextBefore = chunk.length > 0 ? chunk[chunk.length - 1].fecha : null;

  return {
    lecturas: chunk,
    page: {
      limit,
      before: opts.before || null,
      nextBefore,
      hasMore: filtered.length > chunk.length && Boolean(nextBefore),
    },
  };
}

function listAlertas(opts) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const severidades = Array.isArray(opts.severidades) ? opts.severidades : [];
  const leida = typeof opts.leida === 'boolean' ? opts.leida : null;

  const filtered = state.alertas
    .filter((a) => {
      const sevOk = severidades.length === 0 || severidades.includes((a.severidad || '').toLowerCase());
      const leidaOk = leida === null || Boolean(a.leida) === leida;
      return sevOk && leidaOk;
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return filtered.slice(0, limit);
}

function markAlertaLeida(id) {
  const idx = state.alertas.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  state.alertas[idx].leida = true;
  return true;
}

function validarLectura(id, incendioReal) {
  const idx = state.lecturas.findIndex((l) => l.id === id);
  if (idx < 0) return false;
  state.lecturas[idx].incendioReal = incendioReal;
  state.lecturas[idx].validadoEn = new Date().toISOString();
  return true;
}

module.exports = {
  saveLectura,
  saveAlerta,
  listLecturas,
  listAlertas,
  markAlertaLeida,
  validarLectura,
};
