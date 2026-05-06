require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const sensoresRoutes = require("./routes/sensores.routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100
}));

app.get("/", (req, res) => {
  res.json({ ok: true, message: "API IoT funcionando 🚀" });
});

app.use("/api/sensores", sensoresRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto", PORT);
});