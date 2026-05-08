require("dotenv").config();
const { db, isFirebaseConfigured } = require("./firebase");

async function test() {
    try {
        if (!isFirebaseConfigured || !db) {
            throw new Error("Firebase no está configurado en este entorno");
        }

        const doc = await db.collection("test").add({
            mensaje: "hola firebase",
            fecha: new Date()
        });

        console.log("OK:", doc.id);
        process.exit(0);

    } catch (error) {
        console.error("ERROR:", error.message);
        process.exit(1);
    }
}

test();