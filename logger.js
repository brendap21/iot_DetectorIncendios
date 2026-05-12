// Small logger utility to keep logs consistent and timestamped.
// Replace with a real logger (winston/pino) if you need structured logs.
function ts() {
  return new Date().toISOString();
}

function info(...args) {
  console.log(`[INFO] [${ts()}]`, ...args);
}

function warn(...args) {
  console.warn(`[WARN] [${ts()}]`, ...args);
}

function error(...args) {
  console.error(`[ERROR] [${ts()}]`, ...args);
}

module.exports = { info, warn, error };
