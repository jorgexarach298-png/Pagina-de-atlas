'use strict';

/**
 * Carga un fichero `.env` si existe. Sin dependencias: el proyecto no necesita
 * nada más que leer líneas `CLAVE=valor`.
 *
 * Se usa para que apuntar la web a Supabase sea copiar una cadena de conexión:
 *
 *   DATABASE_URL=postgresql://postgres.<ref>:<clave>@...pooler.supabase.com:6543/postgres
 *
 * Las variables ya definidas en el entorno tienen prioridad sobre el fichero.
 */

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  const loaded = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Se admiten comillas simples o dobles alrededor del valor.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}

module.exports = { loadEnv };
