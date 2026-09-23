'use strict';

/**
 * Sesiones en PostgreSQL (tabla `sessions`).
 *
 * El almacén por defecto de express-session vive en memoria, así que cada
 * reinicio del servidor borraba las sesiones y expulsaba a todo el mundo
 * (incluido el momento en el que se sube una foto, que es cuando más se nota).
 *
 * Guardarlas en la base de datos es además lo correcto en la nube: si algún día
 * hay más de una instancia del servidor, todas comparten las mismas sesiones.
 */

const db = require('./db');
const { HttpError } = require('./config');

function expiryOf(data) {
  if (data?.cookie?.expires) return new Date(data.cookie.expires).getTime();
  const maxAge = data?.cookie?.originalMaxAge ?? data?.cookie?.maxAge;
  return maxAge ? Date.now() + maxAge : null;
}

function createPostgresStore(session) {
  if (!session || typeof session.Store !== 'function') {
    throw new HttpError(500, 'express-session no está disponible');
  }

  class PostgresStore extends session.Store {
    get(sid, callback) {
      db.query('SELECT data, expires FROM sessions WHERE sid = $1', [sid])
        .then(({ rows }) => {
          if (!rows.length) return callback(null, null);
          const row = rows[0];
          if (row.expires && Number(row.expires) <= Date.now()) {
            // Caducada: se borra y se responde como si no existiera.
            return db
              .query('DELETE FROM sessions WHERE sid = $1', [sid])
              .then(() => callback(null, null))
              .catch((error) => callback(error));
          }
          return callback(null, row.data);
        })
        .catch((error) => callback(error));
    }

    set(sid, data, callback) {
      const expires = expiryOf(data);
      db.query(
        `INSERT INTO sessions (sid, data, expires) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires`,
        [sid, data, expires],
      )
        .then(() => callback?.(null))
        .catch((error) => callback?.(error));
    }

    destroy(sid, callback) {
      db.query('DELETE FROM sessions WHERE sid = $1', [sid])
        .then(() => callback?.(null))
        .catch((error) => callback?.(error));
    }

    /**
     * Renueva la caducidad sin reescribir la sesión entera. `touch` se llama en
     * cada petición, así que basta con mover `expires`.
     */
    touch(sid, data, callback) {
      db.query('UPDATE sessions SET expires = $2 WHERE sid = $1', [sid, expiryOf(data)])
        .then(() => callback?.(null))
        .catch((error) => callback?.(error));
    }

    /** Borra las sesiones caducadas. Lo llama el servidor de vez en cuando. */
    clearExpired() {
      return db.query('DELETE FROM sessions WHERE expires IS NOT NULL AND expires <= $1', [Date.now()]);
    }

    all(callback) {
      db.query('SELECT data FROM sessions')
        .then(({ rows }) => callback?.(null, rows.map((r) => r.data)))
        .catch((error) => callback?.(error));
    }

    length(callback) {
      db.query('SELECT count(*)::int AS n FROM sessions')
        .then(({ rows }) => callback?.(null, rows[0].n))
        .catch((error) => callback?.(error));
    }

    clear(callback) {
      db.query('DELETE FROM sessions')
        .then(() => callback?.(null))
        .catch((error) => callback?.(error));
    }
  }

  return new PostgresStore();
}

module.exports = { createPostgresStore };
