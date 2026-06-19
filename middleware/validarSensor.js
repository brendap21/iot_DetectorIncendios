const { body, validationResult } = require("express-validator");

const validarSensor = [
  body("llama").isInt({ min: 0, max: 1 }),
  body("gas").isNumeric(),
  body("movimiento").isInt({ min: 0, max: 1 }),
  body("probabilidad").optional().isFloat({ min: 0, max: 1 }),
  body("alerta").optional().isBoolean(),
  body("nivel").optional().isString(),

  (req, res, next) => {
    const errores = validationResult(req);

    if (!errores.isEmpty()) {
      return res.status(400).json({
        ok: false,
        errores: errores.array()
      });
    }

    next();
  }
];

module.exports = validarSensor;