'use strict';

/**
 * Acceso a PostgreSQL (Supabase compatible).
 *
 * Antes los datos vivían en un único `data/atlas.json` que se reescribía entero
 * en cada cambio. Ahora viven en tablas relacionales y cada cambio escribe solo
 * la fila que toca.
 *
 * Conexión: `DATABASE_URL` (o `ATLAS_DATABASE_URL`). Para Supabase es la cadena
 * de conexión del panel del proyecto (Connect → Connection string). Ejemplo:
 *
 *   DATABASE_URL=postgresql://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Si no hay ninguna definida, se usan las variables estándar de PostgreSQL
 * (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
 */

const { Pool, types } = require('pg');

const { DDL } = require('./db-schema');

/**
 * `pg` convierte por su cuenta las columnas DATE a `Date`, lo que rompería las
 * comparaciones de fecha del código (todo compara cadenas 'YYYY-MM-DD'). Se
 * devuelven los valores tal y como los manda PostgreSQL.
 *
 * Los instantes sí se normalizan a ISO 8601, que es como los guardaba el JSON
 * anterior. Ojo con el desfase: PostgreSQL lo escribe como `+00` y JavaScript
 * solo entiende `+00:00`.
 */
function toIso(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

types.setTypeParser(1082, (value) => value); // date
types.setTypeParser(1114, toIso); // timestamp
types.setTypeParser(1184, toIso); // timestamptz

const SCHEMA = process.env.ATLAS_DB_SCHEMA || 'public';

function connectionString() {
  return process.env.ATLAS_DATABASE_URL || process.env.DATABASE_URL || null;
}

/**
 * Supabase exige TLS. En local no, así que se activa solo cuando la propia
 * cadena lo pide o cuando se fuerza con `ATLAS_DB_SSL=1`.
 */
function sslConfig() {
  const url = connectionString() || '';
  const forced = process.env.ATLAS_DB_SSL === '1';
  const required = /sslmode=require|sslmode=verify/i.test(url) || /\bsupabase\.(co|com)\b/.test(url);
  if (!forced && !required) return false;
  // El pooler de Supabase presenta una cadena que Node no valida por defecto.
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: connectionString() || undefined,
  ssl: sslConfig(),
  max: Number(process.env.ATLAS_DB_POOL || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on('error', (error) => {
  console.error('[atlas] error en la conexión a PostgreSQL:', error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

/** Ejecuta varias sentencias en una transacción; si algo falla, no deja nada a medias. */
async function transaction(run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Crea el esquema si falta. */
async function ensureSchema() {
  await query(DDL);
}

/** Vacía todas las tablas del club. Solo lo usan las pruebas. */
async function resetSchema() {
  await query(`
    TRUNCATE sessions, match_scores, match_ballots, match_stats, match_items,
             matches, lineup_items, lineup, checkins, checkin_days, history,
             players, settings
    RESTART IDENTITY CASCADE
  `);
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, transaction, ensureSchema, resetSchema, close, SCHEMA, connectionString };
