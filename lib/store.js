'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'atlas.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

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

function slugId(username) {
  return String(username)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || crypto.randomUUID().slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * Persistencia
 * ------------------------------------------------------------------ */

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password, credentials) {
  if (!credentials || !credentials.salt || !credentials.hash) return false;
  const { hash } = hashPassword(password, credentials.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(credentials.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Contraseña inicial de los miembros: `atlas` + su dorsal (cambiable). */
function defaultPasswordFor(number) {
  return `atlas${number}`;
}

function createSeedDatabase() {
  const players = SEED_PLAYERS.map((entry, index) => {
    const { salt, hash } = hashPassword(defaultPasswordFor(entry.number));
    return {
      id: slugId(entry.username),
      number: entry.number,
      username: entry.username,
      displayName: entry.alias || entry.username,
      position: entry.position,
      photo: null,
      isAdmin: false,
      order: index,
      credentials: { salt, hash },
    };
  });

  const adminUser = process.env.ATLAS_ADMIN_USER || 'admin';
  const adminPassword = process.env.ATLAS_ADMIN_PASSWORD || 'atlas-admin';
  const { salt, hash } = hashPassword(adminPassword);
  const admin = {
    id: slugId(adminUser),
    number: 'A',
    username: adminUser,
    displayName: 'Admin ATLAS',
    position: 'ADMIN',
    photo: null,
    isAdmin: true,
    order: -1,
    credentials: { salt, hash },
  };

  return {
    version: 1,
    club: {
      name: 'ATLAS',
      game: 'EA SPORTS FC 27 · Clubes Pro',
      tagline: 'Un escudo, once corazones.',
      motto: 'Subimos juntos.',
      founded: '2026',
      coach: '',
      captainId: players.find((p) => p.number === '7')?.id || players[0].id,
    },
    players: [admin, ...players],
    lineup: {
      formation: DEFAULT_FORMATION,
      updatedAt: new Date().toISOString(),
      items: [],
    },
    sessions: [],
    history: [
      {
        id: 'hist-juntos',
        title: 'Nace ATLAS',
        date: '2026',
        body: 'Se funda ATLAS para competir en FC 27 Clubes Pro. Dieciséis apellidos, un mismo escudo: la temporada empieza aquí.',
        image: null,
        pinned: true,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function loadDatabase() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    const seed = createSeedDatabase();
    writeDatabaseFile(seed);
    return seed;
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.players ||= [];
    db.sessions ||= [];
    db.history ||= [];
    db.lineup ||= { formation: DEFAULT_FORMATION, updatedAt: new Date().toISOString(), items: [] };
    db.club ||= {};
    return db;
  } catch (error) {
    const broken = `${DB_FILE}.broken-${Date.now()}`;
    fs.renameSync(DB_FILE, broken);
    const seed = createSeedDatabase();
    writeDatabaseFile(seed);
    return seed;
  }
}

function writeDatabaseFile(db) {
  ensureDirs();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
  return db;
}

let database = loadDatabase();

function saveDatabase(next = database) {
  database = next;
  database.updatedAt = new Date().toISOString();
  writeDatabaseFile(database);
  return database;
}

function raw() {
  return database;
}

/* ------------------------------------------------------------------ *
 * Usuarios y autenticación
 * ------------------------------------------------------------------ */

function publicPlayer(player) {
  if (!player) return null;
  const { credentials, ...rest } = player;
  return { ...rest };
}

function findPlayerByUsername(username) {
  const needle = String(username || '').trim().toLowerCase();
  return database.players.find((p) => p.username.toLowerCase() === needle) || null;
}

function findPlayerById(id) {
  return database.players.find((p) => p.id === id) || null;
}

function authenticate(username, password) {
  const player = findPlayerByUsername(username);
  if (!player || !verifyPassword(password, player.credentials)) return null;
  return publicPlayer(player);
}

function setPassword(playerId, password) {
  const player = findPlayerById(playerId);
  if (!player) return null;
  player.credentials = hashPassword(password);
  saveDatabase();
  return publicPlayer(player);
}

function updatePlayer(playerId, patch) {
  const player = findPlayerById(playerId);
  if (!player) return null;

  if (patch.username !== undefined) {
    const candidate = String(patch.username).trim();
    if (!candidate) throw new HttpError(400, 'El ID no puede estar vacío');
    const clash = findPlayerByUsername(candidate);
    if (clash && clash.id !== player.id) throw new HttpError(409, 'Ese ID ya está en uso');
    player.username = candidate;
  }
  if (patch.displayName !== undefined) {
    player.displayName = String(patch.displayName).trim() || player.username;
  }
  if (patch.number !== undefined) player.number = String(patch.number).trim();
  if (patch.position !== undefined) {
    if (!POSITION_KEYS.includes(patch.position)) throw new HttpError(400, 'Posición inválida');
    player.position = patch.position;
  }
  if (patch.photo !== undefined) player.photo = patch.photo;

  saveDatabase();
  return publicPlayer(player);
}

function createPlayer({ username, number, position, displayName, password }) {
  const name = String(username || '').trim();
  if (!name) throw new HttpError(400, 'El ID del jugador es obligatorio');
  if (findPlayerByUsername(name)) throw new HttpError(409, 'Ese ID ya está en uso');
  if (!POSITION_KEYS.includes(position)) throw new HttpError(400, 'Posición inválida');

  const secret = password ? String(password) : defaultPasswordFor(number || '00');
  const { salt, hash } = hashPassword(secret);
  const player = {
    id: slugId(name),
    number: String(number || '').trim(),
    username: name,
    displayName: String(displayName || '').trim() || name,
    position,
    photo: null,
    isAdmin: false,
    order: database.players.length,
    credentials: { salt, hash },
  };
  database.players.push(player);
  saveDatabase();
  return publicPlayer(player);
}

function deletePlayer(playerId) {
  const player = findPlayerById(playerId);
  if (!player) return false;
  if (player.isAdmin) throw new HttpError(400, 'No se puede eliminar una cuenta de administrador');
  database.players = database.players.filter((p) => p.id !== playerId);
  database.lineup.items = database.lineup.items.filter((item) => item.playerId !== playerId);
  for (const session of database.sessions) {
    delete session.entries[playerId];
  }
  saveDatabase();
  return true;
}

/* ------------------------------------------------------------------ *
 * Pizarra táctica
 * ------------------------------------------------------------------ */

/**
 * Guarda la alineación. `vertical` marca las posiciones tomadas ya con el campo
 * en vertical, para poder traspasar las antiguas (horizontales) al vuelo.
 */
function saveLineup({ formation, items }) {
  if (formation !== undefined) database.lineup.formation = String(formation).slice(0, 40);
  if (Array.isArray(items)) {
    database.lineup.items = items
      .filter((item) => item && findPlayerById(item.playerId))
      .map((item) => ({
        playerId: item.playerId,
        x: clamp01(item.x),
        y: clamp01(item.y),
        vertical: item.vertical !== false,
      }));
  }
  database.lineup.updatedAt = new Date().toISOString();
  saveDatabase();
  return database.lineup;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------------------------------------------ *
 * Check-in
 * ------------------------------------------------------------------ */

function ensureSession(date) {
  let session = database.sessions.find((s) => s.date === date);
  if (!session) {
    session = { date, note: '', entries: {}, updatedAt: new Date().toISOString() };
    database.sessions.push(session);
    database.sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
    saveDatabase();
  }
  return session;
}

function setCheckIn(date, playerId, status, message = '') {
  const session = ensureSession(date);
  session.entries[playerId] = {
    status,
    message: String(message || '').slice(0, 240),
    at: new Date().toISOString(),
  };
  session.updatedAt = new Date().toISOString();
  saveDatabase();
  return session;
}

function sessionView(date) {
  const session = database.sessions.find((s) => s.date === date) || {
    date,
    note: '',
    entries: {},
    updatedAt: null,
  };
  const roster = database.players
    .filter((p) => !p.isAdmin)
    .sort(playerSort)
    .map((p) => {
      const entry = session.entries[p.id] || null;
      return { player: publicPlayer(p), status: entry ? entry.status : null, entry };
    });

  const counts = { yes: 0, no: 0, late: 0, maybe: 0, pending: 0 };
  for (const row of roster) {
    if (row.status && counts[row.status] !== undefined) counts[row.status] += 1;
    else counts.pending += 1;
  }

  return {
    date,
    note: session.note || '',
    updatedAt: session.updatedAt,
    counts,
    roster,
    total: roster.length,
    confirmed: counts.yes,
  };
}

function pastSessions(limit = 12) {
  const today = todayISO();
  return database.sessions
    .filter((s) => s.date <= today && Object.keys(s.entries).length > 0)
    .slice(0, limit)
    .map((s) => ({
      date: s.date,
      note: s.note,
      counts: countEntries(s.entries),
    }));
}

function countEntries(entries) {
  const counts = { yes: 0, no: 0, late: 0, maybe: 0, pending: 0 };
  for (const entry of Object.values(entries)) {
    if (counts[entry.status] !== undefined) counts[entry.status] += 1;
  }
  const rosterSize = database.players.filter((p) => !p.isAdmin).length;
  counts.pending = Math.max(0, rosterSize - Object.keys(entries).length);
  return counts;
}

/**
 * Estado de convocatoria por jugador para una fecha: { playerId: 'yes' | ... }.
 * La pizarra lo usa para colorear las fichas del campo.
 */
function statusMap(date) {
  const session = database.sessions.find((s) => s.date === date);
  const map = {};
  if (session) {
    for (const [playerId, entry] of Object.entries(session.entries)) {
      map[playerId] = entry.status;
    }
  }
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
 * Historia del club
 * ------------------------------------------------------------------ */

function addHistory({ title, date, body, image }) {
  if (!title) throw new HttpError(400, 'El título es obligatorio');
  const entry = {
    id: `hist-${crypto.randomUUID().slice(0, 8)}`,
    title: String(title).slice(0, 120),
    date: String(date || todayISO()).slice(0, 40),
    body: String(body || ''),
    image: image || null,
    pinned: false,
  };
  database.history.unshift(entry);
  saveDatabase();
  return entry;
}

function updateHistory(id, patch) {
  const entry = database.history.find((h) => h.id === id);
  if (!entry) return null;
  if (patch.title !== undefined) entry.title = String(patch.title).slice(0, 120);
  if (patch.date !== undefined) entry.date = String(patch.date).slice(0, 40);
  if (patch.body !== undefined) entry.body = String(patch.body);
  if (patch.image !== undefined) entry.image = patch.image;
  if (patch.pinned !== undefined) entry.pinned = Boolean(patch.pinned);
  saveDatabase();
  return entry;
}

function deleteHistory(id) {
  const before = database.history.length;
  database.history = database.history.filter((h) => h.id !== id);
  saveDatabase();
  return database.history.length < before;
}

/* ------------------------------------------------------------------ */

function playerSort(a, b) {
  const na = parseInt(a.number, 10);
  const nb = parseInt(b.number, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return a.username.localeCompare(b.username, 'es');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  DB_FILE,
  POSITIONS,
  POSITION_KEYS,
  HttpError,
  raw,
  saveDatabase,
  publicPlayer,
  playerSort,
  findPlayerById,
  findPlayerByUsername,
  authenticate,
  setPassword,
  updatePlayer,
  createPlayer,
  deletePlayer,
  saveLineup,
  ensureSession,
  setCheckIn,
  sessionView,
  pastSessions,
  statusMap,
  addHistory,
  updateHistory,
  deleteHistory,
  todayISO,
  dateInTimeZone,
  defaultPasswordFor,
};
