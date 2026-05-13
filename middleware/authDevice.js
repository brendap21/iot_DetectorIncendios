function normalizarClave(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function enmascararClave(value) {
    const clave = normalizarClave(value);

    if (!clave) {
        return '(vacía)';
    }

    if (clave.length <= 8) {
        return `${clave.slice(0, 2)}***${clave.slice(-2)}`;
    }

    return `${clave.slice(0, 4)}***${clave.slice(-4)}`;
}

module.exports = (req, res, next) => {
    const apiKey = normalizarClave(req.header('x-api-key'));
    const serverApiKey = normalizarClave(process.env.DEVICE_API_KEY || process.env.IOT_DEVICE_API_KEY);

    console.log('API key recibida:', enmascararClave(apiKey));
    console.log('API key del servidor:', enmascararClave(serverApiKey));

    if (!apiKey) {
        return res.status(401).json({
            ok: false,
            error: 'API key requerida'
        });
    }

    if (!serverApiKey) {
        return res.status(503).json({
            ok: false,
            error: 'API key del servidor no configurada'
        });
    }

    if (apiKey !== serverApiKey) {
        return res.status(403).json({
            ok: false,
            error: 'API key inválida'
        });
    }

    next();
};