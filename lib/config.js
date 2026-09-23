'use strict';

/**
 * Configuración compartida y errores HTTP.
 *
 * Vive aparte de `store.js` y `db.js` para que `uploads.js`, `session-store.js`
 * y el propio acceso a datos puedan usarla sin depender unos de otros.
 */

const path = require('path');

/**
 * `ATLAS_DATA_DIR` solo afecta ya a los ficheros subidos y a la clave de
 * sesión de respaldo: los datos del club viven en PostgreSQL.
 */
const DATA_DIR = process.env.ATLAS_DATA_DIR
  ? path.resolve(process.env.ATLAS_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_KEY_FILE = path.join(DATA_DIR, 'session.key');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { DATA_DIR, UPLOAD_DIR, SESSION_KEY_FILE, HttpError };
