'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = process.env.ALERT_STATE_FILE || path.join(DATA_DIR, 'alert-state.json');
const MAX_READ_IDS = 2000;

let state = {
  readAlertIds: [],
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

loadState();

module.exports = {
  isAlertRead,
  markAlertRead,
};
