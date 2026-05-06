require("dotenv").config();
const db = require("./firebase");

async function test() {
    try {
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