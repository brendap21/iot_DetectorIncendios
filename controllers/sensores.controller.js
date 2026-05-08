const { db, isFirebaseConfigured } = require("../firebase");

const guardarLectura = async (req, res) => {
    if (!isFirebaseConfigured || !db) {
        return res.status(503).json({
            ok: false,
            error: "Firebase no está configurado en este entorno"
        });
    }

    try {
        const { llama, gas, movimiento } = req.body;

        const lectura = {
            llama,
            gas,
            movimiento,
            fecha: new Date()
        };

        const doc = await db.collection("lecturas").add(lectura);

        res.status(201).json({
            ok: true,
            id: doc.id,
            data: lectura
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
};

module.exports = {
    guardarLectura
};