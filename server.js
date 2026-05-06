require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const sensoresRoutes = require("./routes/sensores.routes");

const app = express();

// ================= SECURITY =================
app.use(helmet());

app.use(cors({
  origin: "*"
}));

app.use(express.json());

// ================= RATE LIMIT =================
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100
  })
);

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "API IoT funcionando correctamente 🚀"
  });
});

// ================= ROUTES =================
app.use("/api/sensores", sensoresRoutes);

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});