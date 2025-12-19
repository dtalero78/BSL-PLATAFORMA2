const path = require('path');

/**
 * Configuración de Puppeteer para DigitalOcean App Platform
 * Guarda Chrome en el directorio del proyecto para que persista
 */
module.exports = {
    cacheDirectory: path.join(__dirname, '.cache', 'puppeteer'),
};
