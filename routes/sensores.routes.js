const express = require("express");
const router = express.Router();

const authDevice = require("../middleware/authDevice");
const validarSensor = require("../middleware/validarSensor");
const { guardarLectura } = require("../controllers/sensores.controller");

router.post("/", authDevice, ...validarSensor, guardarLectura);

module.exports = router;