require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const sensoresRoutes = require("./routes/sensores.routes");

const app = express();

// Seguridad básica
app.use(helmet());

// CORS
app.use(cors());

// Parse JSON
app.use(express.json());

// Rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: {
      ok: false,
      error: "Demasiadas peticiones"
    }
  })
);

// Health check para Render
app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "IoT Detector Incendios",
    status: "online"
  });
});

// Ruta health explícita
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true
  });
});

// API
app.use("/api/sensores", sensoresRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Ruta no encontrada"
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("ERROR:", err);

  res.status(500).json({
    ok: false,
    error: "Error interno"
  });
});

// Render asigna puerto dinámico
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 INICIANDO SERVIDOR...");
  console.log("🚀 LISTO PARA ESCUCHAR");
  console.log(`Servidor corriendo en puerto ${PORT}`);
});