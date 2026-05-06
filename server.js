require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const sensoresRoutes = require("./routes/sensores.routes");

const app = express();

// Seguridad
app.use(helmet());

app.use(
  cors({
    origin: false,
  })
);

app.use(express.json());

// Rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  })
);

// Ruta principal
app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensaje: "API IoT segura funcionando",
  });
});

// Rutas API
app.use("/api/sensores", sensoresRoutes);

// Puerto Railway
const PORT = process.env.PORT || 3000;

// Escuchar
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});