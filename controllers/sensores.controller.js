const db = require("../firebase");

const guardarLectura = async (req, res) => {
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