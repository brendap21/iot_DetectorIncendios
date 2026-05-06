require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const sensoresRoutes = require("./routes/sensores.routes");

const app = express();

app.use(helmet());

app.use(cors({
    origin: false
}));

app.use(express.json());

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100
});

app.use(limiter);

app.get("/", (req, res) => {
    res.json({
        ok: true,
        mensaje: "API IoT segura funcionando"
    });
});

app.use("/api/sensores", sensoresRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor seguro corriendo en puerto ${PORT}`);
});