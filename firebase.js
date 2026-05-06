require("dotenv").config();
const admin = require("firebase-admin");

const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY
} = process.env;

if (!FIREBASE_PROJECT_ID) {
    throw new Error("Falta FIREBASE_PROJECT_ID");
}

if (!FIREBASE_CLIENT_EMAIL) {
    throw new Error("Falta FIREBASE_CLIENT_EMAIL");
}

if (!FIREBASE_PRIVATE_KEY) {
    throw new Error("Falta FIREBASE_PRIVATE_KEY");
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        })
    });
}

const db = admin.firestore();

console.log("Firebase conectado correctamente");
module.exports = db;