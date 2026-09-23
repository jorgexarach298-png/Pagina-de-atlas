'use strict';

/**
 * Datos del club en PostgreSQL.
 *
 * Antes todo vivía en un único `data/atlas.json` que se reescribía entero en
 * cada cambio. Ahora cada operación lee y escribe solo las filas que necesita.
 *
 * Todas las funciones que tocan datos son **asíncronas** (la base de datos está
 * en la nube, no en el proceso). Las vistas del cliente siguen recibiendo
 * exactamente la misma forma de objeto que antes, para no tocar el frontend.
 */

const crypto = require('crypto');

const db = require('./db');
const { DATA_DIR, UPLOAD_DIR, HttpError } = require('./config');
const { slugId, hashPassword, verifyPassword, defaultPasswordFor } = require('./passwords');

/**
 * Posiciones normalizadas del equipo. El orden de esta lista define el orden
 * en el que los grupos aparecen en la vista de Plantilla.
 */
const POSITIONS = [
  { key: 'POR', label: 'Portero', icon: '🧤', group: 'Portería' },
  { key: 'DFC', label: 'Defensa Central', icon: '🛡️', group: 'Defensa' },
  { key: 'LI', label: 'Carrilero Izquierdo', icon: '⚡', group: 'Carrileros' },
  { key: 'LD', label: 'Carrilero Derecho', icon: '⚡', group: 'Carrileros' },
  { key: 'MC', label: 'Mediocentro', icon: '🧠', group: 'Mediocampo' },
  { key: 'DC', label: 'Delantero', icon: '⚽', group: 'Delantera' },
];

const POSITION_KEYS = POSITIONS.map((p) => p.key);

/** Fila de formación por defecto: 4 líneas (DEF, MED, DEL) + portería. */
const DEFAULT_FORMATION = '4-3-3';

/** Porterías imbatidas: solo se cuentan a porteros y defensas centrales. */
const CLEAN_SHEET_POSITIONS = ['POR', 'DFC'];

/**
 * Plantilla inicial del club. `username` es el ID con el que cada miembro
 * inicia sesión y `number` el dorsal que se muestra en su carta.
 */
const SEED_PLAYERS = [
  { number: '15', username: 'Cristiano-15m-8', position: 'POR' },

  { number: '5', username: 'totocuero', position: 'DFC' },
  { number: '20', username: 'adrimarquezj', position: 'DFC' },
  { number: '90', username: 'batousai_lp', position: 'DFC' },
  { number: '56', username: 'Nebulosa BLK', position: 'DFC', alias: 'Nebulosa' },
  { number: '4', username: 'danico_2', position: 'DFC' },

  { number: '19', username: 'Franmp0004', position: 'LI' },
  { number: '23', username: 'Angelotss', position: 'LD' },
  { number: '29', username: 'RodriKTV', position: 'LD' },

  { number: '8', username: 'habixuelo75', position: 'MC' },
  { number: '10', username: 'DRKSNP-RíoYT', position: 'MC' },
  { number: '22', username: 'racknarook', position: 'MC' },
  { number: '17', username: 'RAyNext77', position: 'MC' },

  { number: '7', username: 'antoniogarciagal', position: 'DC' },
  { number: '11', username: 'Oliverelbueno', position: 'DC' },
  { number: '9', username: 'tonii_gk', position: 'DC' },
];

/* ------------------------------------------------------------------ *
 * Traducción de filas a los objetos que espera el resto de la app
 * ------------------------------------------------------------------ */

function playerFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    username: row.username,
    displayName: row.display_name,
    position: row.position,
    photo: row.photo,
    isAdmin: row.is_admin,
    isPlayer: row.is_player,
    order: row.sort_order,
    claimed: row.claimed,
    credentials: { salt: row.password_salt, hash: row.password_hash },
  };
}

/** Objeto público de un jugador: sin credenciales. */
function publicPlayer(player) {
  if (!player) return null;
  const { credentials, ...rest } = player;
  return { ...rest };
}

function itemFromRow(row) {
  return {
    playerId: row.player_id,
    x: Number(row.x),
    y: Number(row.y),
    vertical: row.vertical,
  };
}

function matchFromRow(row, items = []) {
  return {
    date: row.date,
    formation: row.formation,
    note: row.note,
    cleanSheet: row.clean_sheet,
    publishedAt: row.published_at,
    items,
  };
}

function playerSort(a, b) {
  const na = parseInt(a.number, 10);
  const nb = parseInt(b.number, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return a.username.localeCompare(b.username, 'es');
}

/* ------------------------------------------------------------------ *
 * Arranque: esquema y datos iniciales
 * ------------------------------------------------------------------ */

/**
 * Crea el esquema y, si la base de datos está vacía, siembra la plantilla.
 * Se llama una vez al arrancar el servidor, antes de escuchar.
 */
async function init() {
  await db.ensureSchema();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM players');
  if (rows[0].n === 0) {
    await seed();
    return { seeded: true };
  }
  return { seeded: false };
}

function defaultClub() {
  return {
    name: 'ATLAS',
    game: 'EA SPORTS FC 27 · Clubes Pro',
    tagline: 'Un escudo, once corazones.',
    motto: 'Subimos juntos.',
    founded: '2026',
    coach: '',
    captainId: slugId('antoniogarciagal'),
  };
}

async function seed() {
  const adminUser = process.env.ATLAS_ADMIN_USER || 'admin';
  const adminPassword = process.env.ATLAS_ADMIN_PASSWORD || 'atlas-admin';

  await db.transaction(async (client) => {
    const admin = hashPassword(adminPassword);
    await client.query(
      `INSERT INTO players (id, number, username, display_name, position, is_admin, is_player, sort_order, claimed, password_salt, password_hash)
       VALUES ($1,$2,$3,$4,$5,true,false,-1,true,$6,$7)`,
      [slugId(adminUser), 'A', adminUser, 'Admin ATLAS', 'ADMIN', admin.salt, admin.hash],
    );

    let order = 0;
    for (const entry of SEED_PLAYERS) {
      // Sin reclamar: el miembro entra por primera vez desde «Registrarme» con
      // su ID de la plantilla y elige ahí su contraseña.
      const secret = hashPassword(crypto.randomBytes(24).toString('hex'));
      await client.query(
        `INSERT INTO players (id, number, username, display_name, position, is_admin, is_player, sort_order, claimed, password_salt, password_hash)
         VALUES ($1,$2,$3,$4,$5,false,true,$6,false,$7,$8)`,
        [
          slugId(entry.username),
          entry.number,
          entry.username,
          entry.alias || entry.username,
          entry.position,
          order,
          secret.salt,
          secret.hash,
        ],
      );
      order += 1;
    }

    await client.query('INSERT INTO lineup (id, formation) VALUES (true, $1)', [DEFAULT_FORMATION]);

    await client.query(
      `INSERT INTO history (id, title, date, body, image, pinned, position)
       VALUES ($1,$2,$3,$4,NULL,true,0)`,
      [
        'hist-juntos',
        'Nace ATLAS',
        '2026',
        'Se funda ATLAS para competir en FC 27 Clubes Pro. Dieciséis apellidos, un mismo escudo: la temporada empieza aquí.',
      ],
    );

    await saveClub(client, defaultClub());
  });

  return true;
}

/* ------------------------------------------------------------------ *
 * Club y ajustes: datos sueltos que no merecen una tabla cada uno
 * ------------------------------------------------------------------ */

async function saveClub(client, club) {
  await client.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('club', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(club)],
  );
}

async function getClub() {
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'club'`);
  if (!rows.length) return defaultClub();
  try {
    return { ...defaultClub(), ...JSON.parse(rows[0].value) };
  } catch {
    return defaultClub();
  }
}

/** Datos de texto del club (nombre, lema, entrenador...). */
async function updateClub(patch) {
  const allowed = ['name', 'tagline', 'motto', 'coach', 'founded', 'captainId'];
  const club = await getClub();
  for (const key of allowed) {
    if (patch && patch[key] !== undefined) club[key] = String(patch[key]).slice(0, 200);
  }
  await db.transaction((client) => saveClub(client, club));
  return club;
}

async function getSetting(key) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function setSetting(key, value) {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
  return value;
}

/* ------------------------------------------------------------------ *
 * Jugadores
 * ------------------------------------------------------------------ */

async function listPlayers() {
  const { rows } = await db.query('SELECT * FROM players ORDER BY sort_order, username');
  return rows.map(playerFromRow);
}

async function listRoster() {
  // Se filtra por `is_player`, no por `is_admin`: un mánager que también juega
  // debe seguir apareciendo en la plantilla y en la pizarra.
  const players = await listPlayers();
  return players.filter((p) => p.isPlayer).sort(playerSort);
}

async function findPlayerById(id) {
  const { rows } = await db.query('SELECT * FROM players WHERE id = $1', [id]);
  return playerFromRow(rows[0]);
}

async function findPlayerByUsername(username) {
  const needle = String(username || '').trim();
  if (!needle) return null;
  const { rows } = await db.query('SELECT * FROM players WHERE lower(username) = lower($1)', [needle]);
  return playerFromRow(rows[0]);
}

/** IDs de la plantilla que todavía no han activado su cuenta. */
async function pendingPlayers() {
  const { rows } = await db.query(
    'SELECT * FROM players WHERE is_player AND NOT claimed ORDER BY sort_order, username',
  );
  return rows.map(playerFromRow).sort(playerSort);
}

async function authenticate(username, password) {
  const player = await findPlayerByUsername(username);
  if (!player || !verifyPassword(password, player.credentials)) return null;
  return publicPlayer(player);
}

/**
 * Registro de un miembro que YA está en la plantilla: reclama su cuenta con el
 * ID que el club le asignó y elige su contraseña. No crea jugadores nuevos.
 */
async function claimAccount(username, password) {
  const player = await findPlayerByUsername(username);
  if (!player) throw new HttpError(404, 'Ese ID no está en la plantilla. Pídele al mánager que te añada.');
  if (!player.isPlayer) throw new HttpError(403, 'La cuenta de administrador no se registra desde aquí');
  if (player.claimed) throw new HttpError(409, 'Ese ID ya tiene cuenta. Entra con tu contraseña.');

  const { salt, hash } = hashPassword(password);
  const { rows } = await db.query(
    `UPDATE players SET password_salt = $2, password_hash = $3, claimed = true, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [player.id, salt, hash],
  );
  return publicPlayer(playerFromRow(rows[0]));
}

async function setPassword(playerId, password) {
  const { salt, hash } = hashPassword(password);
  const { rows } = await db.query(
    `UPDATE players SET password_salt = $2, password_hash = $3, claimed = true, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [playerId, salt, hash],
  );
  if (!rows.length) return null;
  return publicPlayer(playerFromRow(rows[0]));
}

/**
 * Restablece una cuenta para que el miembro vuelva a activarla. Se usa cuando
 * alguien olvida su contraseña y el club quiere devolverle el acceso: su ID
 * queda de nuevo disponible en «Registrarme» para elegir una contraseña nueva.
 */
async function resetAccount(playerId) {
  const player = await findPlayerById(playerId);
  if (!player) throw new HttpError(404, 'Ese miembro no existe');
  if (!player.isPlayer) throw new HttpError(400, 'La cuenta de administrador no se restablece desde aquí');

  const { salt, hash } = hashPassword(crypto.randomBytes(24).toString('hex'));
  const { rows } = await db.query(
    `UPDATE players SET claimed = false, password_salt = $2, password_hash = $3, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [player.id, salt, hash],
  );
  return publicPlayer(playerFromRow(rows[0]));
}

async function updatePlayer(playerId, patch) {
  const player = await findPlayerById(playerId);
  if (!player) return null;

  const next = { ...player };
  if (patch.username !== undefined) {
    const candidate = String(patch.username).trim();
    if (!candidate) throw new HttpError(400, 'El ID no puede estar vacío');
    const clash = await findPlayerByUsername(candidate);
    if (clash && clash.id !== player.id) throw new HttpError(409, 'Ese ID ya está en uso');
    next.username = candidate;
  }
  if (patch.displayName !== undefined) {
    next.displayName = String(patch.displayName).trim() || next.username;
  }
  if (patch.number !== undefined) next.number = String(patch.number).trim();
  if (patch.position !== undefined) {
    if (!POSITION_KEYS.includes(patch.position) && !player.isAdmin) {
      throw new HttpError(400, 'Posición inválida');
    }
    next.position = patch.position;
  }
  if (patch.photo !== undefined) next.photo = patch.photo || null;

  const { rows } = await db.query(
    `UPDATE players
        SET number = $2, username = $3, display_name = $4, position = $5, photo = $6, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [player.id, next.number, next.username, next.displayName, next.position, next.photo],
  );
  return publicPlayer(playerFromRow(rows[0]));
}

async function createPlayer({ username, number, position, displayName, password }) {
  const name = String(username || '').trim();
  if (!name) throw new HttpError(400, 'El ID del jugador es obligatorio');
  if (await findPlayerByUsername(name)) throw new HttpError(409, 'Ese ID ya está en uso');
  if (!POSITION_KEYS.includes(position)) throw new HttpError(400, 'Posición inválida');

  const secret = password ? String(password) : crypto.randomBytes(24).toString('hex');
  const { salt, hash } = hashPassword(secret);

  const { rows } = await db.query(
    `INSERT INTO players (id, number, username, display_name, position, is_admin, sort_order, claimed, password_salt, password_hash)
     VALUES ($1,$2,$3,$4,$5,false,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM players), $6, $7, $8)
     RETURNING *`,
    [
      slugId(name),
      String(number || '').trim(),
      name,
      String(displayName || '').trim() || name,
      position,
      Boolean(password),
      salt,
      hash,
    ],
  );
  return publicPlayer(playerFromRow(rows[0]));
}

/**
 * Borra a un jugador. Sus fichas, estadísticas, papeletas y check-ins
 * desaparecen con él: las claves ajenas están declaradas en cascada, así que la
 * base de datos se encarga sola de que no queden notas huérfanas.
 */
async function deletePlayer(playerId) {
  const player = await findPlayerById(playerId);
  if (!player) return false;
  if (!player.isPlayer) throw new HttpError(400, 'No se puede eliminar la cuenta de administrador');
  await db.query('DELETE FROM players WHERE id = $1', [playerId]);
  return true;
}

/* ------------------------------------------------------------------ *
 * Pizarra táctica
 * ------------------------------------------------------------------ */

/**
 * Guarda la alineación. `vertical` marca las posiciones tomadas ya con el campo
 * en vertical, para poder traspasar las antiguas (horizontales) al vuelo.
 */
async function saveLineup({ formation, items }) {
  await db.transaction(async (client) => {
    if (formation !== undefined) {
      await client.query('UPDATE lineup SET formation = $1, updated_at = now() WHERE id', [
        String(formation).slice(0, 40),
      ]);
    }
    if (Array.isArray(items)) {
      const wanted = items.filter((item) => item && item.playerId).map((item) => item.playerId);

      // Se comprueban todos los IDs de una vez: un jugador que ya no existe no
      // se puede colocar y su clave ajena abortaría la transacción entera.
      const { rows: known } = await client.query('SELECT id FROM players WHERE id = ANY($1::text[])', [wanted]);
      const exists = new Set(known.map((row) => row.id));

      await client.query('DELETE FROM lineup_items');
      let order = 0;
      for (const item of items) {
        if (!item || !exists.has(item.playerId)) continue;
        await client.query(
          `INSERT INTO lineup_items (player_id, x, y, vertical, position)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_id) DO NOTHING`,
          [item.playerId, clamp01(item.x), clamp01(item.y), item.vertical !== false, order],
        );
        order += 1;
      }
      await client.query('UPDATE lineup SET updated_at = now() WHERE id');
    }
  });
  return getLineup();
}

async function getLineup() {
  const { rows } = await db.query('SELECT * FROM lineup WHERE id');
  const { rows: items } = await db.query('SELECT * FROM lineup_items ORDER BY position, player_id');
  return {
    formation: rows[0]?.formation || DEFAULT_FORMATION,
    updatedAt: rows[0]?.updated_at || null,
    items: items.map(itemFromRow),
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------------------------------------------ *
 * Check-in
 * ------------------------------------------------------------------ */

async function ensureDay(date) {
  await db.query('INSERT INTO checkin_days (date) VALUES ($1) ON CONFLICT (date) DO NOTHING', [date]);
}

/** Crea el día si hace falta. Se mantiene por compatibilidad con el servidor. */
async function ensureSession(date) {
  await ensureDay(date);
  return sessionView(date);
}

async function setCheckIn(date, playerId, status, message = '') {
  await ensureDay(date);
  await db.query(
    `INSERT INTO checkins (date, player_id, status, message, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (date, player_id)
     DO UPDATE SET status = EXCLUDED.status, message = EXCLUDED.message, updated_at = now()`,
    [date, playerId, status, String(message || '').slice(0, 240)],
  );
  await db.query('UPDATE checkin_days SET updated_at = now() WHERE date = $1', [date]);
  return sessionView(date);
}

/** Quita la respuesta de un jugador (el mánager corrige una convocatoria). */
async function clearCheckIn(date, playerId) {
  await ensureDay(date);
  await db.query('DELETE FROM checkins WHERE date = $1 AND player_id = $2', [date, playerId]);
  await db.query('UPDATE checkin_days SET updated_at = now() WHERE date = $1', [date]);
  return sessionView(date);
}

async function sessionView(date) {
  const { rows: dayRows } = await db.query('SELECT * FROM checkin_days WHERE date = $1', [date]);
  const day = dayRows[0] || null;

  const { rows: entryRows } = await db.query(
    'SELECT player_id, status, message, updated_at FROM checkins WHERE date = $1',
    [date],
  );
  const entries = {};
  for (const row of entryRows) {
    entries[row.player_id] = { status: row.status, message: row.message, at: row.updated_at };
  }

  const roster = (await listRoster()).map((p) => {
    const entry = entries[p.id] || null;
    return { player: publicPlayer(p), status: entry ? entry.status : null, entry };
  });

  const counts = { yes: 0, no: 0, late: 0, maybe: 0, pending: 0 };
  for (const row of roster) {
    if (row.status && counts[row.status] !== undefined) counts[row.status] += 1;
    else counts.pending += 1;
  }

  return {
    date,
    note: day?.note || '',
    updatedAt: day?.updated_at || null,
    counts,
    roster,
    total: roster.length,
    confirmed: counts.yes,
  };
}

async function pastSessions(limit = 12) {
  const rosterSize = (await listRoster()).length;
  const { rows } = await db.query(
    `SELECT d.date, d.note,
            count(c.player_id)::int AS answered,
            count(*) FILTER (WHERE c.status = 'yes')::int   AS yes,
            count(*) FILTER (WHERE c.status = 'no')::int    AS no,
            count(*) FILTER (WHERE c.status = 'late')::int  AS late,
            count(*) FILTER (WHERE c.status = 'maybe')::int AS maybe
       FROM checkin_days d
       JOIN checkins c ON c.date = d.date
      WHERE d.date <= $1
      GROUP BY d.date, d.note
      ORDER BY d.date DESC
      LIMIT $2`,
    [todayISO(), limit],
  );
  return rows.map((row) => ({
    date: row.date,
    note: row.note,
    counts: {
      yes: row.yes,
      no: row.no,
      late: row.late,
      maybe: row.maybe,
      pending: Math.max(0, rosterSize - row.answered),
    },
  }));
}

/**
 * Estado de convocatoria por jugador para una fecha: { playerId: 'yes' | ... }.
 * La pizarra lo usa para colorear las fichas del campo.
 */
async function statusMap(date) {
  const { rows } = await db.query('SELECT player_id, status FROM checkins WHERE date = $1', [date]);
  const map = {};
  for (const row of rows) map[row.player_id] = row.status;
  return map;
}

function todayISO() {
  return dateInTimeZone(new Date());
}

function dateInTimeZone(date) {
  const timeZone = process.env.ATLAS_TZ || 'Europe/Madrid';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/* ------------------------------------------------------------------ *
 * Partidos: alineación publicada, estadísticas y notas
 * ------------------------------------------------------------------ */

/** Notas posibles: del 1 al 11, sin repetir ninguna en la misma papeleta. */
const NOTE_MIN = 1;
const NOTE_MAX = 11;

async function findMatch(date) {
  const { rows } = await db.query('SELECT * FROM matches WHERE date = $1', [date]);
  if (!rows.length) return null;
  const { rows: items } = await db.query(
    'SELECT * FROM match_items WHERE match_date = $1 ORDER BY position, player_id',
    [date],
  );
  return matchFromRow(rows[0], items.map(itemFromRow));
}

function matchPlayerIds(match) {
  return (match?.items || []).map((item) => item.playerId);
}

/**
 * Publica (o republica) la alineación de un día. Es el gesto que abre la
 * jornada: a partir de aquí los jugadores pueden puntuar a sus compañeros.
 * Republicar no borra las notas ya puestas; solo descarta las de quien se haya
 * quedado fuera de la nueva alineación.
 */
async function publishMatch(date, { formation, items, note }) {
  const roster = new Set((await listRoster()).map((p) => p.id));
  const cleanItems = (items || [])
    .filter((item) => item && roster.has(item.playerId))
    .map((item) => ({
      playerId: item.playerId,
      x: clamp01(item.x),
      y: clamp01(item.y),
      vertical: item.vertical !== false,
    }));

  if (!cleanItems.length) throw new HttpError(400, 'No puedes publicar una alineación vacía');

  const playing = cleanItems.map((i) => i.playerId);
  const chosenFormation = formation === undefined ? DEFAULT_FORMATION : String(formation).slice(0, 40);

  await db.transaction(async (client) => {
    // Publicar fija también el borrador de la pizarra: el campo queda como se
    // publicó, para que al abrirla se vea el once del día y no una versión vieja.
    await client.query('UPDATE lineup SET formation = $1, updated_at = now() WHERE id', [chosenFormation]);
    await client.query('DELETE FROM lineup_items');
    let lineupOrder = 0;
    for (const item of cleanItems) {
      await client.query(
        `INSERT INTO lineup_items (player_id, x, y, vertical, position)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_id) DO NOTHING`,
        [item.playerId, item.x, item.y, item.vertical, lineupOrder],
      );
      lineupOrder += 1;
    }

    await client.query(
      `INSERT INTO matches (date, formation, note, published_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (date) DO UPDATE
          SET formation = EXCLUDED.formation,
              note = CASE WHEN $4 THEN EXCLUDED.note ELSE matches.note END,
              published_at = now()`,
      [date, chosenFormation, note === undefined ? '' : String(note || '').slice(0, 240), note !== undefined],
    );

    await client.query('DELETE FROM match_items WHERE match_date = $1', [date]);
    let order = 0;
    for (const item of cleanItems) {
      await client.query(
        `INSERT INTO match_items (match_date, player_id, x, y, vertical, position)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [date, item.playerId, item.x, item.y, item.vertical, order],
      );
      order += 1;
    }

    // Fuera de la alineación no hay a quién puntuar: se descartan esas notas.
    await client.query('DELETE FROM match_ballots WHERE match_date = $1 AND voter_id <> ALL($2::text[])', [
      date,
      playing,
    ]);
    await client.query(
      `DELETE FROM match_scores
        WHERE match_date = $1 AND (target_id <> ALL($2::text[]) OR target_id = voter_id)`,
      [date, playing],
    );
  });

  return findMatch(date);
}

async function unpublishMatch(date) {
  // Fichas, estadísticas y papeletas del día caen en cascada.
  const { rowCount } = await db.query('DELETE FROM matches WHERE date = $1', [date]);
  return rowCount > 0;
}

async function setMatchStats(date, playerId, { goals, assists }) {
  const match = await findMatch(date);
  if (!match) throw new HttpError(404, 'Ese día no tiene alineación publicada');
  if (!matchPlayerIds(match).includes(playerId)) {
    throw new HttpError(400, 'Ese jugador no está en la alineación de ese día');
  }

  const clean = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Math.max(0, Math.min(99, Math.trunc(Number(value))));
    if (!Number.isFinite(n)) throw new HttpError(400, 'Las estadísticas deben ser números');
    return n;
  };

  const { rows: current } = await db.query(
    'SELECT goals, assists FROM match_stats WHERE match_date = $1 AND player_id = $2',
    [date, playerId],
  );
  const before = current[0] || { goals: 0, assists: 0 };

  const { rows } = await db.query(
    `INSERT INTO match_stats (match_date, player_id, goals, assists)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (match_date, player_id)
     DO UPDATE SET goals = EXCLUDED.goals, assists = EXCLUDED.assists
     RETURNING goals, assists`,
    [date, playerId, clean(goals, before.goals), clean(assists, before.assists)],
  );
  return { goals: rows[0].goals, assists: rows[0].assists };
}

/**
 * Marca si el equipo dejó la portería a cero en un partido. Solo cuenta para
 * porteros y defensas centrales, que son los que la sostienen.
 */
async function setMatchCleanSheet(date, value) {
  const { rows } = await db.query(
    'UPDATE matches SET clean_sheet = $2 WHERE date = $1 RETURNING clean_sheet',
    [date, Boolean(value)],
  );
  if (!rows.length) throw new HttpError(404, 'Ese día no tiene alineación publicada');
  return { cleanSheet: rows[0].clean_sheet };
}

/**
 * Guarda la papeleta de un votante para un día: a cada compañero que jugó se le
 * da una nota del 1 al 11, y ninguna nota puede repetirse dentro de la misma
 * papeleta. Así las notas se reparten en vez de ser todos un 11.
 */
async function saveBallot(date, voterId, scores) {
  const match = await findMatch(date);
  if (!match) throw new HttpError(400, 'El mánager todavía no ha publicado la alineación de ese día');

  const playing = matchPlayerIds(match);
  if (!playing.includes(voterId)) {
    throw new HttpError(403, 'Solo puntúan quienes jugaron ese día');
  }

  const clean = {};
  const used = new Map();
  for (const [targetId, raw] of Object.entries(scores || {})) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (targetId === voterId) continue; // nadie se puntúa a sí mismo
    if (!playing.includes(targetId)) continue;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < NOTE_MIN || value > NOTE_MAX) {
      throw new HttpError(400, `Las notas van del ${NOTE_MIN} al ${NOTE_MAX}`);
    }
    if (used.has(value)) {
      const other = await findPlayerById(used.get(value));
      const name = other ? other.displayName : used.get(value);
      throw new HttpError(409, `El ${value} ya se lo has puesto a ${name}. Reparte notas distintas.`);
    }
    used.set(value, targetId);
    clean[targetId] = value;
  }

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO match_ballots (match_date, voter_id, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (match_date, voter_id) DO UPDATE SET updated_at = now()`,
      [date, voterId],
    );
    await client.query('DELETE FROM match_scores WHERE match_date = $1 AND voter_id = $2', [date, voterId]);
    for (const [targetId, score] of Object.entries(clean)) {
      await client.query(
        'INSERT INTO match_scores (match_date, voter_id, target_id, score) VALUES ($1,$2,$3,$4)',
        [date, voterId, targetId, score],
      );
    }
  });

  return { scores: clean, at: new Date().toISOString() };
}

/** Notas de un votante, sin exponer quién votó qué al resto. */
async function ballotOf(date, voterId) {
  const { rows } = await db.query(
    'SELECT target_id, score FROM match_scores WHERE match_date = $1 AND voter_id = $2',
    [date, voterId],
  );
  const scores = {};
  for (const row of rows) scores[row.target_id] = row.score;
  return scores;
}

/** Media de cada jugador y número de votos, a partir de todas las papeletas. */
async function ratingsFrom(matchDate = null) {
  const sql = matchDate
    ? `SELECT target_id, sum(score)::int AS total, count(*)::int AS votes
         FROM match_scores WHERE match_date = $1 GROUP BY target_id`
    : `SELECT target_id, sum(score)::int AS total, count(*)::int AS votes
         FROM match_scores GROUP BY target_id`;
  const { rows } = await db.query(sql, matchDate ? [matchDate] : []);
  const ratings = {};
  for (const row of rows) {
    ratings[row.target_id] = {
      votes: row.votes,
      average: Math.round((row.total / row.votes) * 100) / 100,
    };
  }
  return ratings;
}

/**
 * Estadísticas de toda la plantilla. Partidos jugados = días con alineación
 * publicada en los que el jugador entró; goles y asistencias los anota el
 * mánager partido a partido; la valoración es la media de las notas que le
 * han puesto sus compañeros.
 */
async function rosterStats() {
  const stats = {};
  for (const player of await listRoster()) {
    stats[player.id] = {
      played: 0,
      goals: 0,
      assists: 0,
      votes: 0,
      average: null,
      // Porterías imbatidas: solo se cuentan a porteros y centrales.
      cleanSheets: 0,
      cleanSheetsEligible: CLEAN_SHEET_POSITIONS.includes(player.position),
    };
  }

  const { rows } = await db.query(
    `SELECT i.player_id, m.clean_sheet,
            COALESCE(s.goals, 0)   AS goals,
            COALESCE(s.assists, 0) AS assists
       FROM match_items i
       JOIN matches m ON m.date = i.match_date
       LEFT JOIN match_stats s ON s.match_date = i.match_date AND s.player_id = i.player_id`,
  );
  for (const row of rows) {
    const entry = stats[row.player_id];
    if (!entry) continue;
    entry.played += 1;
    if (row.clean_sheet && entry.cleanSheetsEligible) entry.cleanSheets += 1;
    entry.goals += row.goals;
    entry.assists += row.assists;
  }

  for (const [playerId, rating] of Object.entries(await ratingsFrom())) {
    if (!stats[playerId]) continue;
    stats[playerId].votes = rating.votes;
    stats[playerId].average = rating.average;
  }
  return stats;
}

/** Vista de un partido para el cliente, con la papeleta del que pregunta. */
async function matchView(date, viewerId) {
  const match = await findMatch(date);
  if (!match) return { date, published: false };
  const playing = matchPlayerIds(match);
  const viewerPlayed = viewerId ? playing.includes(viewerId) : false;

  const { rows: statRows } = await db.query(
    'SELECT player_id, goals, assists FROM match_stats WHERE match_date = $1',
    [date],
  );
  const stats = {};
  for (const row of statRows) stats[row.player_id] = { goals: row.goals, assists: row.assists };

  const { rows: ballotRows } = await db.query('SELECT voter_id FROM match_ballots WHERE match_date = $1', [date]);

  return {
    date,
    published: true,
    publishedAt: match.publishedAt,
    note: match.note || '',
    formation: match.formation,
    items: match.items,
    playerIds: playing,
    stats,
    cleanSheet: Boolean(match.cleanSheet),
    // Media del día por jugador, para que el votante vea cómo va la cosa.
    averages: await ratingsFrom(date),
    ballots: ballotRows.length,
    myScores: viewerId ? await ballotOf(date, viewerId) : {},
    canVote: viewerPlayed,
    // Quién ha votado ya, sin decir qué nota puso a quién.
    voted: ballotRows.map((r) => r.voter_id),
  };
}

async function pastMatches(limit = 12) {
  const { rows } = await db.query(
    `SELECT m.date, m.note, m.clean_sheet,
            (SELECT count(*)::int FROM match_items i WHERE i.match_date = m.date)   AS players,
            (SELECT count(*)::int FROM match_ballots b WHERE b.match_date = m.date) AS ballots
       FROM matches m
      ORDER BY m.date DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    date: row.date,
    note: row.note || '',
    players: row.players,
    ballots: row.ballots,
    cleanSheet: Boolean(row.clean_sheet),
  }));
}

/* ------------------------------------------------------------------ *
 * Historia del club
 * ------------------------------------------------------------------ */

function historyFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    body: row.body,
    image: row.image,
    pinned: row.pinned,
  };
}

async function listHistory() {
  const { rows } = await db.query('SELECT * FROM history ORDER BY pinned DESC, date DESC, created_at DESC');
  return rows.map(historyFromRow);
}

async function findHistory(id) {
  const { rows } = await db.query('SELECT * FROM history WHERE id = $1', [id]);
  return rows.length ? historyFromRow(rows[0]) : null;
}

async function addHistory({ title, date, body, image }) {
  if (!title) throw new HttpError(400, 'El título es obligatorio');
  const entry = {
    id: `hist-${crypto.randomUUID().slice(0, 8)}`,
    title: String(title).slice(0, 120),
    date: String(date || todayISO()).slice(0, 40),
    body: String(body || ''),
    image: image || null,
    pinned: false,
  };
  await db.query(
    `INSERT INTO history (id, title, date, body, image, pinned, position)
     VALUES ($1,$2,$3,$4,$5,$6, (SELECT COALESCE(MIN(position), 0) - 1 FROM history))`,
    [entry.id, entry.title, entry.date, entry.body, entry.image, entry.pinned],
  );
  return entry;
}

async function updateHistory(id, patch) {
  const entry = await findHistory(id);
  if (!entry) return null;
  if (patch.title !== undefined) entry.title = String(patch.title).slice(0, 120);
  if (patch.date !== undefined) entry.date = String(patch.date).slice(0, 40);
  if (patch.body !== undefined) entry.body = String(patch.body);
  if (patch.image !== undefined) entry.image = patch.image;
  if (patch.pinned !== undefined) entry.pinned = Boolean(patch.pinned);

  await db.query(
    'UPDATE history SET title = $2, date = $3, body = $4, image = $5, pinned = $6 WHERE id = $1',
    [id, entry.title, entry.date, entry.body, entry.image, entry.pinned],
  );
  return entry;
}

async function deleteHistory(id) {
  const { rowCount } = await db.query('DELETE FROM history WHERE id = $1', [id]);
  return rowCount > 0;
}

/* ------------------------------------------------------------------ */

async function close() {
  await db.close();
}

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  POSITIONS,
  POSITION_KEYS,
  CLEAN_SHEET_POSITIONS,
  HttpError,
  init,
  close,
  listPlayers,
  listRoster,
  pendingPlayers,
  publicPlayer,
  playerSort,
  findPlayerById,
  findPlayerByUsername,
  authenticate,
  claimAccount,
  setPassword,
  resetAccount,
  updatePlayer,
  createPlayer,
  deletePlayer,
  getLineup,
  saveLineup,
  getClub,
  updateClub,
  getSetting,
  setSetting,
  findMatch,
  matchView,
  pastMatches,
  publishMatch,
  unpublishMatch,
  setMatchStats,
  setMatchCleanSheet,
  saveBallot,
  ballotOf,
  rosterStats,
  ensureSession,
  setCheckIn,
  clearCheckIn,
  sessionView,
  pastSessions,
  statusMap,
  listHistory,
  findHistory,
  addHistory,
  updateHistory,
  deleteHistory,
  todayISO,
  dateInTimeZone,
  defaultPasswordFor,
  slugId,
  hashPassword,
  verifyPassword,
};
