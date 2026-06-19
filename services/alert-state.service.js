'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = process.env.ALERT_STATE_FILE || path.join(DATA_DIR, 'alert-state.json');
const MAX_READ_IDS = 2000;

let state = {
  readAlertIds: [],
  activeAlerts: {},
};

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function loadState() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (parsed && Array.isArray(parsed.readAlertIds)) {
      state.readAlertIds = parsed.readAlertIds.slice(0, MAX_READ_IDS);
    }
    if (parsed && parsed.activeAlerts && typeof parsed.activeAlerts === 'object') {
      state.activeAlerts = parsed.activeAlerts;
    }
  } catch (error) {
    logger.warn('No se pudo cargar estado de alertas leidas', error.message);
  }
}

function persistState() {
  try {
    ensureDir();
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    logger.warn('No se pudo guardar estado de alertas leidas', error.message);
  }
}

function isAlertRead(id) {
  return Boolean(id && state.readAlertIds.includes(id));
}

function markAlertRead(id) {
  if (!id) {
    return false;
  }

  state.readAlertIds = state.readAlertIds.filter((item) => item !== id);
  state.readAlertIds.unshift(id);

  if (state.readAlertIds.length > MAX_READ_IDS) {
    state.readAlertIds.length = MAX_READ_IDS;
  }

  persistState();
  return true;
}

function stableAlertId(tipo) {
  return `active-${tipo || 'desconocida'}`;
}

function clearReadId(id) {
  state.readAlertIds = state.readAlertIds.filter((item) => item !== id);
}

function syncActiveAlerts(alertas) {
  const incoming = Array.isArray(alertas) ? alertas : [];
  const activeIds = new Set();
  let changed = false;

  incoming.forEach((alerta) => {
    const id = stableAlertId(alerta.tipo);
    const previous = state.activeAlerts[id] || {};
    const fecha = previous.fecha || alerta.fecha || new Date().toISOString();
    const lastSeen = alerta.fecha || new Date().toISOString();

    activeIds.add(id);
    state.activeAlerts[id] = {
      ...alerta,
      id,
      fecha,
      firstSeen: previous.firstSeen || fecha,
      lastSeen,
      leida: isAlertRead(id),
      active: true,
    };
    changed = true;
  });

  Object.keys(state.activeAlerts).forEach((id) => {
    if (!activeIds.has(id)) {
      delete state.activeAlerts[id];
      clearReadId(id);
      changed = true;
    }
  });

  if (changed) {
    persistState();
  }

  return Object.values(state.activeAlerts)
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2 };
      const ar = rank[a.severidad] ?? 3;
      const br = rank[b.severidad] ?? 3;
      if (ar !== br) return ar - br;
      return new Date(b.lastSeen || b.fecha) - new Date(a.lastSeen || a.fecha);
    });
}

loadState();

module.exports = {
  isAlertRead,
  markAlertRead,
  syncActiveAlerts,
};
