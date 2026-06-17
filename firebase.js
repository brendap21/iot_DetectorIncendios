require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const logger = require('./logger');

function normalizePrivateKey(privateKey) {
  if (typeof privateKey !== 'string') {
    return '';
  }

  let normalized = privateKey
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  // Handle case where newlines are double-escaped: \\\\n (literal backslash-n)
  if (normalized.includes('\\n')) {
    normalized = normalized.replace(/\\n/g, '\n');
  }

  return normalized;
}

function normalizeServiceAccount(serviceAccount) {
  if (!serviceAccount || typeof serviceAccount !== 'object') {
    return null;
  }

  const normalized = {
    projectId: serviceAccount.projectId || serviceAccount.project_id,
    clientEmail: serviceAccount.clientEmail || serviceAccount.client_email,
    privateKey: serviceAccount.privateKey || serviceAccount.private_key,
    privateKeyId: serviceAccount.privateKeyId || serviceAccount.private_key_id
  };

  if (normalized.privateKey) {
    normalized.privateKey = normalizePrivateKey(normalized.privateKey);
  }

  return normalized;
}

function loadServiceAccount() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_JSON,
    GOOGLE_APPLICATION_CREDENTIALS
  } = process.env;

  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      logger.info('Loading Firebase credentials from FIREBASE_SERVICE_ACCOUNT_JSON');
      return normalizeServiceAccount(JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON));
    } catch (error) {
      logger.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON', error && error.stack ? error.stack : error);
    }
  }

  // Prefer explicit env-based service account
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    logger.info('Loading Firebase credentials from environment variables');
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(FIREBASE_PRIVATE_KEY)
    };
  }

  // Try GOOGLE_APPLICATION_CREDENTIALS path (common on cloud providers)
  if (GOOGLE_APPLICATION_CREDENTIALS) {
    const resolved = path.resolve(GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(resolved)) {
      logger.info('Loading Firebase credentials from GOOGLE_APPLICATION_CREDENTIALS at', resolved);
      return normalizeServiceAccount(require(resolved));
    }
    logger.warn('GOOGLE_APPLICATION_CREDENTIALS is set but file not found at', resolved);
  }

  // Fallback to a local config file (only for development)
  const localKeyPath = path.join(__dirname, 'config', 'firebase-key.json');
  if (fs.existsSync(localKeyPath)) {
    logger.info('Loading Firebase credentials from local config/firebase-key.json');
    return normalizeServiceAccount(require(localKeyPath));
  }

  return null;
}

let db = null;
let firebaseInitError = null;
let firebaseReady = false;

const serviceAccount = loadServiceAccount();

logger.info('Firebase credential sources available', {
  hasProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
  hasClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
  hasPrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  hasServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
  hasGoogleAppCreds: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
});

// Initialize Firebase asynchronously in background (don't block server startup)
async function initializeFirebaseAsync() {
  if (!serviceAccount) {
    firebaseInitError = new Error('No se encontraron credenciales de Firebase. Define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY, o configura GOOGLE_APPLICATION_CREDENTIALS.');
    logger.warn(firebaseInitError.message);
    return;
  }

  try {
    logger.info('Initializing Firebase Admin SDK');
    
    const keyPreview = serviceAccount.privateKey
      ? `${serviceAccount.privateKey.slice(0, 50)}...${serviceAccount.privateKey.slice(-50)}`
      : '(missing)';
    
    logger.info('Firebase credential loaded', {
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      privateKeyPreview: keyPreview,
      hasBeginMarker: serviceAccount.privateKey?.includes('-----BEGIN PRIVATE KEY-----') || false,
      hasEndMarker: serviceAccount.privateKey?.includes('-----END PRIVATE KEY-----') || false
    });
    
    if (!admin.apps.length) {
      const hasPemHeaders = typeof serviceAccount.privateKey === 'string'
        && serviceAccount.privateKey.includes('-----BEGIN PRIVATE KEY-----');

      logger.info('Firebase service account prepared', {
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        hasPemHeaders
      });

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    db = admin.firestore();
    firebaseReady = true;
    logger.info('Firebase conectado correctamente');
  } catch (err) {
    firebaseInitError = err;
    logger.error('Error initializing Firebase:', err && err.stack ? err.stack : err);
  }
}

// Start Firebase initialization in background (non-blocking)
initializeFirebaseAsync().catch((err) => {
  logger.error('Unexpected error in Firebase background init:', err);
});

// Give Firebase a max of 10 seconds to initialize, then proceed anyway
setTimeout(() => {
  if (!firebaseReady) {
    logger.warn('Firebase initialization timeout (10s), proceeding with degraded mode');
  }
}, 10000);

module.exports = {
  db,
  isFirebaseConfigured: Boolean(db),
  firebaseInitError
};