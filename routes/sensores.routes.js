const express = require("express");
const router = express.Router();

const authDevice = require("../middleware/authDevice");
const validarSensor = require("../middleware/validarSensor");
const {
  guardarLectura,
  obtenerLecturasRecientes,
  obtenerEstadisticas,
  obtenerEvaluacionModelo,
  validarLecturaReal,
  subscribeLecturasStream,
} = require("../controllers/sensores.controller");

router.post("/", authDevice, ...validarSensor, guardarLectura);
router.get("/ml/evaluacion", obtenerEvaluacionModelo);
router.get("/ultimas", obtenerLecturasRecientes);
router.get("/estadisticas", obtenerEstadisticas);
router.get("/stream", subscribeLecturasStream);
router.patch("/:id/validacion", validarLecturaReal);

module.exports = router;
