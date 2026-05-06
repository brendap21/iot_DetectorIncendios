const express = require("express");
const router = express.Router();

const authDevice = require("../middleware/authDevice");
const validarSensor = require("../middleware/validarSensor");

const {
    guardarLectura
} = require("../controllers/sensores.controller");

const {
    reglasSensor,
    validarSensor
} = require("../middleware/validarSensor");

router.post(
    "/",
    authDevice,
    reglasSensor,
    validarSensor,
    guardarLectura
);

module.exports = router;