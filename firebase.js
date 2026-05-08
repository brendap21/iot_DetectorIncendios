require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function loadServiceAccount() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    GOOGLE_APPLICATION_CREDENTIALS
  } = process.env;

  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    };
  }

  if (GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS)) {
    return require(path.resolve(GOOGLE_APPLICATION_CREDENTIALS));
  }

  const localKeyPath = path.join(__dirname, "config", "firebase-key.json");
  if (fs.existsSync(localKeyPath)) {
    return require(localKeyPath);
  }

  return null;
}

let db = null;
let firebaseInitError = null;

const serviceAccount = loadServiceAccount();

if (serviceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  db = admin.firestore();
  console.log("Firebase conectado correctamente");
} else {
  firebaseInitError = new Error(
    "No se encontraron credenciales de Firebase. Define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY, o configura GOOGLE_APPLICATION_CREDENTIALS."
  );
  console.warn(firebaseInitError.message);
}

module.exports = {
  db,
  isFirebaseConfigured: Boolean(db),
  firebaseInitError
};