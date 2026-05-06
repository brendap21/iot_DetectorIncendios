require("dotenv").config();

const admin = require("firebase-admin");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("No existe GOOGLE_APPLICATION_CREDENTIALS en .env");
}

const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);

console.log("PROJECT ID JSON:", serviceAccount.project_id);
console.log("CLIENT EMAIL:", serviceAccount.client_email);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
}

const db = admin.firestore();

console.log("Firebase conectado correctamente");

module.exports = db;
