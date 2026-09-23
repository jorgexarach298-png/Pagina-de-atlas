'use strict';

/**
 * Lanza las pruebas contra un servidor real con datos de usar y tirar.
 *
 * Cada suite arranca su propio servidor sobre una base de datos **aparte**
 * (`ATLAS_TEST_DATABASE_URL`), que se vacía antes de cada suite: así las pruebas
 * no se pisan entre ellas ni tocan la base de datos del club.
 *
 * Uso: node tests/run.js [suite.test.js ...]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Base de datos de pruebas. Nunca debe apuntar a la del club: `resetDatabase`
 * borra todas las tablas.
 */
const TEST_DATABASE_URL =
  process.env.ATLAS_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://atlas:atlas-dev-pass@127.0.0.1:5432/atlas_test';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/roster`);
      if (res.ok) return true;
    } catch {
      /* todavía arrancando */
    }
    await sleep(150);
  }
  return false;
}

/** Deja la base de datos de pruebas como recién creada. */
async function resetDatabase() {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    // Se usa la misma definición de esquema que el servidor, para que las
    // pruebas corran contra exactamente la misma estructura.
    const { DDL } = require('../lib/db-schema');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query(DDL);
  } finally {
    await client.end();
  }
}

/** Arranca un servidor con datos vírgenes y devuelve cómo apagarlo. */
async function startServer(dataDir) {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ATLAS_DATA_DIR: dataDir,
      ATLAS_DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
      // Cada suite usa su propio secreto: así las cookies de una no valen en la
      // siguiente, igual que pasaba con los datos en fichero.
      SESSION_SECRET: 'secreto-de-pruebas-atlas-0123456789abcdef',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });

  const ready = await waitForServer();
  if (!ready) {
    server.kill('SIGTERM');
    throw new Error(`El servidor de pruebas no arrancó:\n${output}`);
  }

  return () =>
    new Promise((resolve) => {
      server.once('exit', () => resolve());
      server.kill('SIGTERM');
    });
}

(async () => {
  const suites = process.argv.slice(2);
  const files = suites.length ? suites : ['api.test.js', 'ui.test.js'];
  let failed = 0;

  for (const file of files) {
    // Cada suite parte de cero: se vacía la base de datos de pruebas.
    await resetDatabase();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
    const stop = await startServer(dataDir);
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, file), BASE], {
        stdio: 'inherit',
        // Las pruebas necesitan saber con qué base de datos y directorio de
        // fotos trabaja el servidor para poder comprobarlo por su cuenta.
        env: {
          ...process.env,
          ATLAS_DATA_DIR: dataDir,
          ATLAS_DATABASE_URL: TEST_DATABASE_URL,
          DATABASE_URL: TEST_DATABASE_URL,
        },
      });
      child.on('exit', resolve);
    });
    await stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (code) failed += 1;
  }

  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
