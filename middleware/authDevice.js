module.exports = (req, res, next) => {
    const apiKey = req.header("x-api-key");

    console.log("Header recibido:", apiKey);
    console.log("ENV guardada:", process.env.DEVICE_API_KEY);

    if (!apiKey) {
        return res.status(401).json({
            ok: false,
            error: "API key requerida"
        });
    }

    if (apiKey !== process.env.DEVICE_API_KEY) {
        return res.status(403).json({
            ok: false,
            error: "API key inválida"
        });
    }

    next();
};