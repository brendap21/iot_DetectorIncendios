function clasificarRiesgo({ llama, gas, movimiento }) {
  if (llama === 1) return "alto";

  if (gas > 250) return "alto";

  if (movimiento === 1) return "medio";

  if (gas > 150) return "medio";

  return "normal";
}

module.exports = {
  clasificarRiesgo
};