require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const logger = require('./logger');

function loadServiceAccount() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    GOOGLE_APPLICATION_CREDENTIALS
  } = process.env;

  // Prefer explicit env-based service account
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    logger.info('Loading Firebase credentials from environment variables');
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    };
  }

  // Try GOOGLE_APPLICATION_CREDENTIALS path (common on cloud providers)
  if (GOOGLE_APPLICATION_CREDENTIALS) {
    const resolved = path.resolve(GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(resolved)) {
      logger.info('Loading Firebase credentials from GOOGLE_APPLICATION_CREDENTIALS at', resolved);
      return require(resolved);
    }
    logger.warn('GOOGLE_APPLICATION_CREDENTIALS is set but file not found at', resolved);
  }

  // Fallback to a local config file (only for development)
  const localKeyPath = path.join(__dirname, 'config', 'firebase-key.json');
  if (fs.existsSync(localKeyPath)) {
    logger.info('Loading Firebase credentials from local config/firebase-key.json');
    return require(localKeyPath);
  }

  return null;
}

let db = null;
let firebaseInitError = null;

const serviceAccount = loadServiceAccount();

if (serviceAccount) {
  try {
    logger.info('Initializing Firebase Admin SDK');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    db = admin.firestore();
    logger.info('Firebase conectado correctamente');
  } catch (err) {
    firebaseInitError = err;
    logger.error('Error initializing Firebase:', err && err.stack ? err.stack : err);
  }
} else {
  firebaseInitError = new Error('No se encontraron credenciales de Firebase. Define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY, o configura GOOGLE_APPLICATION_CREDENTIALS.');
  logger.warn(firebaseInitError.message);
}

module.exports = {
  db,
  isFirebaseConfigured: Boolean(db),
  firebaseInitError
};