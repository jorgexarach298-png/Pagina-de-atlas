'use strict';

const { loadEnv } = require('./lib/env');

// El fichero .env se lee antes que nada, para que DATABASE_URL esté disponible
// cuando se crea la conexión a PostgreSQL.
loadEnv();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');

const store = require('./lib/store');
const db = require('./lib/db');
const uploads = require('./lib/uploads');
const { createPostgresStore } = require('./lib/session-store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
// Detrás del túnel HTTPS de desarrollo el proxy termina TLS: sin esto la sesión
// no se marcaría como segura y la cookie podría no fijarse correctamente.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));

/**
 * Secreto de sesión persistente para que los inicios de sesión sobrevivan a los
 * reinicios. Vive en la base de datos (`settings`), no en disco: en la nube el
 * disco del contenedor es efímero y un secreto nuevo en cada arranque
 * invalidaría todas las sesiones guardadas.
 *
 * Orden de preferencia: `SESSION_SECRET` → base de datos → fichero local.
 */
async function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const stored = await store.getSetting('session_secret');
  if (stored && stored.length >= 32) return stored;

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    await store.setSetting('session_secret', secret);
    return secret;
  } catch {
    // Si la base de datos no admite escritura, se sigue con el fichero local.
    const file = path.join(store.DATA_DIR, 'session.key');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {
      /* todavía no existe */
    }
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers HTTP
 * ------------------------------------------------------------------ */

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function currentUser(req) {
  if (!req.session || !req.session.playerId) return null;
  const player = await store.findPlayerById(req.session.playerId);
  if (!player) {
    // La cuenta ya no existe: se cierra la sesión en vez de arrastrarla.
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    return null;
  }
  return player;
}

/** Comprueba la sesión y deja el jugador en `req.player`. */
function requireAuth(req, res, next) {
  currentUser(req)
    .then((player) => {
      if (!player) return res.status(401).json({ error: 'Necesitas iniciar sesión' });
      req.player = player;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.player.isAdmin) return res.status(403).json({ error: 'Solo para el administrador' });
    next();
  });
}

async function me(req) {
  const player = await currentUser(req);
  return player ? store.publicPlayer(player) : null;
}

function normaliseDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : store.todayISO();
}

/* ------------------------------------------------------------------ *
 * Rutas
 *
 * Se registran dentro de `registerRoutes`, y no al cargar el módulo, porque el
 * middleware de sesión necesita el secreto de la base de datos: hasta que no
 * está puesto, ninguna ruta debe existir (Express atiende en orden de registro).
 * ------------------------------------------------------------------ */

function registerRoutes(app) {
app.get(
  '/api/auth/me',
  asyncRoute(async (req, res) => {
    res.json({ user: await me(req), today: store.todayISO() });
  }),
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    const player = await store.authenticate(username, password);
    if (!player) return res.status(401).json({ error: 'ID o contraseña incorrectos' });
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
      req.session.playerId = player.id;
      res.json({ user: player, today: store.todayISO() });
    });
  }),
);

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('atlas.sid');
    res.json({ ok: true });
  });
});

/**
 * Registro de un miembro que ya está en la plantilla: elige contraseña con el
 * ID que le dio el club. No crea jugadores nuevos.
 */
app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    const name = String(username || '').trim();
    if (!name || !password) {
      return res.status(400).json({ error: 'Escribe tu ID y una contraseña' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const player = await store.claimAccount(name, password);

    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
      req.session.playerId = player.id;
      res.status(201).json({ user: player, today: store.todayISO() });
    });
  }),
);

/** IDs de la plantilla que todavía no tienen cuenta: alimenta el registro. */
app.get(
  '/api/auth/available',
  asyncRoute(async (req, res) => {
    const pending = (await store.pendingPlayers()).map((p) => ({
      id: p.id,
      username: p.username,
      number: p.number,
      position: p.position,
    }));
    res.json({ pending });
  }),
);

app.post(
  '/api/auth/password',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    if (!(await store.authenticate(req.player.username, currentPassword))) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    const player = await store.setPassword(req.player.id, newPassword);
    res.json({ user: player });
  }),
);

/* ------------------------------------------------------------------ *
 * Plantilla
 * ------------------------------------------------------------------ */

app.get(
  '/api/roster',
  asyncRoute(async (req, res) => {
    const [stats, players, club] = await Promise.all([
      store.rosterStats(),
      store.listRoster(),
      store.getClub(),
    ]);
    res.json({
      players: players.map((p) => ({ ...store.publicPlayer(p), stats: stats[p.id] || null })),
      positions: store.POSITIONS,
      club,
    });
  }),
);

app.patch(
  '/api/players/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { displayName, photo } = req.body || {};
    const patch = {};
    if (displayName !== undefined) patch.displayName = displayName;
    if (photo !== undefined) {
      patch.photo = photo
        ? uploads.replaceUpload(req.player.photo, photo)
        : (uploads.removeUpload(req.player.photo), null);
    }
    const player = await store.updatePlayer(req.player.id, patch);
    res.json({ user: player });
  }),
);

app.post(
  '/api/players',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { username, number, position, displayName, photo } = req.body || {};
    const player = await store.createPlayer({ username, number, position, displayName });
    if (photo) {
      await store.updatePlayer(player.id, { photo: uploads.saveDataUrl(photo) });
    }
    res.status(201).json({ player: await store.findPlayerById(player.id).then(store.publicPlayer) });
  }),
);

app.patch(
  '/api/players/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const target = await store.findPlayerById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });

    const { username, number, position, displayName, photo, newPassword } = req.body || {};
    const patch = {};
    if (username !== undefined) patch.username = username;
    if (number !== undefined) patch.number = number;
    if (position !== undefined) patch.position = position;
    if (displayName !== undefined) patch.displayName = displayName;
    if (photo !== undefined) {
      patch.photo = photo
        ? uploads.replaceUpload(target.photo, photo)
        : (uploads.removeUpload(target.photo), null);
    }

    let player = await store.updatePlayer(target.id, patch);
    if (newPassword) player = await store.setPassword(target.id, newPassword);
    res.json({ player });
  }),
);

app.delete(
  '/api/players/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const target = await store.findPlayerById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });
    uploads.removeUpload(target.photo);
    await store.deletePlayer(target.id);
    res.json({ ok: true });
  }),
);

/**
 * Devuelve el acceso a un miembro que olvidó su contraseña: su ID vuelve a
 * aparecer en «Registrarme» para que elija una nueva.
 */
app.post(
  '/api/players/:id/reset-account',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const player = await store.resetAccount(req.params.id);
    res.json({ player });
  }),
);

/* ------------------------------------------------------------------ *
 * Pizarra táctica
 * ------------------------------------------------------------------ */

app.get(
  '/api/lineup',
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.query.date);
    // La convocatoria solo se envía a quien ha iniciado sesión: la pizarra es
    // pública, pero quién viene al partido no tiene por qué serlo.
    const viewer = await currentUser(req);
    const isAdmin = Boolean(viewer?.isAdmin);
    const [lineup, roster, match] = await Promise.all([
      store.getLineup(),
      store.listRoster(),
      store.matchView(date, viewer ? viewer.id : null),
    ]);

    res.json({
      lineup,
      positions: store.POSITIONS,
      date,
      statuses: viewer ? await store.statusMap(date) : {},
      counts: viewer ? (await store.sessionView(date)).counts : null,
      // Estado del día: si el mánager ya publicó la alineación, se abren las notas.
      match,
      roster: roster.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        number: p.number,
        position: p.position,
        photo: p.photo,
        claimed: Boolean(p.claimed),
      })),
      // Las ayudas solo las gestiona el mánager. Al resto se le mandan
      // únicamente las que aparecen en el once que va a ver, para que una ayuda
      // publicada no desaparezca del campo (el nombre ya se ve en la ficha).
      guests: await (async () => {
        const all = await store.listGuests();
        const guestView = (g) => ({ id: g.id, displayName: g.displayName, photo: g.photo });
        if (isAdmin) return all.map(guestView);
        // Quien no es mánager ve el once publicado; si aún no lo hay, el borrador.
        const shown = (match.published ? match.items : lineup.items) || [];
        const visible = new Set(shown.map((item) => item.playerId));
        return all.filter((g) => visible.has(g.id)).map(guestView);
      })(),
    });
  }),
);

app.put(
  '/api/lineup',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const lineup = await store.saveLineup(req.body || {});
    res.json({ lineup });
  }),
);

/**
 * Ayudas y pruebas: gente de fuera que completa el once. No son miembros de la
 * plantilla, así que estas rutas son solo del mánager y no tocan el check-in ni
 * las cartas. Repetir un nombre reutiliza la misma ficha.
 */
app.get(
  '/api/guests',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const guests = await store.listGuests();
    res.json({ guests: guests.map((g) => store.publicPlayer(g)) });
  }),
);

app.post(
  '/api/guests',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { guest, created } = await store.ensureGuest(req.body?.name);
    res.status(created ? 201 : 200).json({ guest });
  }),
);

app.patch(
  '/api/guests/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { name, photo } = req.body || {};

    // El nombre y la foto llegan del mismo formulario, así que se aplican los
    // dos si vienen; cada uno se salta si no se ha tocado.
    if (name !== undefined) await store.renameGuest(req.params.id, name);
    if (photo !== undefined) {
      const current = await store.findPlayerById(req.params.id);
      if (!current?.isGuest) return res.status(404).json({ error: 'Esa ayuda no existe' });
      const saved = photo
        ? uploads.replaceUpload(current.photo, photo)
        : (uploads.removeUpload(current.photo), null);
      await store.setGuestPhoto(req.params.id, saved);
    }

    const guest = await store.findPlayerById(req.params.id);
    res.json({ guest: store.publicPlayer(guest) });
  }),
);

app.delete(
  '/api/guests/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const removed = await store.deleteGuest(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Esa ayuda no existe' });
    res.json({ ok: true });
  }),
);

/**
 * Publicar la alineación del día. A diferencia de guardarla, esto fija el once
 * y abre la jornada: los que jugaron ya pueden puntuar a sus compañeros.
 */
app.post(
  '/api/matches/:date/publish',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.params.date);
    const { formation, items, note } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Falta la alineación que quieres publicar' });
    }
    await store.publishMatch(date, { formation, items, note });
    res.json({ match: await store.matchView(date, req.player.id) });
  }),
);

app.delete(
  '/api/matches/:date',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.params.date);
    await store.unpublishMatch(date);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/matches',
  asyncRoute(async (req, res) => {
    res.json({ matches: await store.pastMatches() });
  }),
);

/** Goles y asistencias de un jugador en un día publicado. */
app.patch(
  '/api/matches/:date/stats/:playerId',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.params.date);
    const { goals, assists } = req.body || {};
    const stats = await store.setMatchStats(date, req.params.playerId, { goals, assists });
    res.json({ stats });
  }),
);

/** Portería a cero del día: suma a porteros y centrales en sus cartas. */
app.patch(
  '/api/matches/:date/clean-sheet',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.params.date);
    const { cleanSheet } = req.body || {};
    res.json(await store.setMatchCleanSheet(date, cleanSheet));
  }),
);

/**
 * Notas del día. Cada jugador que entró en la alineación puntúa a sus
 * compañeros con notas del 1 al 11, todas distintas dentro de su papeleta.
 */
app.post(
  '/api/matches/:date/ratings',
  requireAuth,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.params.date);
    const scores = (req.body || {}).scores || {};
    await store.saveBallot(date, req.player.id, scores);
    res.json({ match: await store.matchView(date, req.player.id) });
  }),
);

/* ------------------------------------------------------------------ *
 * Check-in
 * ------------------------------------------------------------------ */

app.get(
  '/api/checkin',
  requireAuth,
  asyncRoute(async (req, res) => {
    const date = normaliseDate(req.query.date);
    const [view, past] = await Promise.all([store.sessionView(date), store.pastSessions()]);
    res.json({
      ...view,
      today: store.todayISO(),
      past,
      statuses: [
        { key: 'yes', label: 'Estaré', icon: '✅' },
        { key: 'no', label: 'No puedo', icon: '❌' },
        { key: 'late', label: 'Llego tarde', icon: '🕐' },
        { key: 'maybe', label: 'Dudo', icon: '🤔' },
      ],
    });
  }),
);

app.post(
  '/api/checkin/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!req.player.isPlayer) {
      return res.status(400).json({ error: 'La cuenta de administrador no cuenta para el check-in' });
    }
    const { status, message, date } = req.body || {};
    const allowed = ['yes', 'no', 'late', 'maybe'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
    const day = normaliseDate(date);
    await store.setCheckIn(day, req.player.id, status, message);
    const [view, past] = await Promise.all([store.sessionView(day), store.pastSessions()]);
    res.json({ ...view, today: store.todayISO(), past });
  }),
);

app.post(
  '/api/checkin/admin',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { date, playerId, status, message } = req.body || {};
    const day = normaliseDate(date);
    if (status === null || status === 'clear') {
      await store.clearCheckIn(day, playerId);
    } else {
      const allowed = ['yes', 'no', 'late', 'maybe'];
      if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
      if (!(await store.findPlayerById(playerId))) {
        return res.status(404).json({ error: 'Miembro no encontrado' });
      }
      await store.setCheckIn(day, playerId, status, message);
    }
    const [view, past] = await Promise.all([store.sessionView(day), store.pastSessions()]);
    res.json({ ...view, today: store.todayISO(), past });
  }),
);

/* ------------------------------------------------------------------ *
 * Historia del club
 * ------------------------------------------------------------------ */

app.get(
  '/api/history',
  asyncRoute(async (req, res) => {
    const [entries, club] = await Promise.all([store.listHistory(), store.getClub()]);
    res.json({ entries, club });
  }),
);

app.post(
  '/api/history',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { title, date, body, image } = req.body || {};
    const entry = await store.addHistory({
      title,
      date,
      body,
      image: image ? uploads.saveDataUrl(image) : null,
    });
    res.status(201).json({ entry });
  }),
);

app.patch(
  '/api/history/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await store.findHistory(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entrada no encontrada' });
    const patch = { ...(req.body || {}) };
    if (patch.image !== undefined) {
      patch.image = patch.image
        ? uploads.replaceUpload(existing.image, patch.image)
        : (uploads.removeUpload(existing.image), null);
    }
    res.json({ entry: await store.updateHistory(req.params.id, patch) });
  }),
);

app.delete(
  '/api/history/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await store.findHistory(req.params.id);
    if (existing) uploads.removeUpload(existing.image);
    await store.deleteHistory(req.params.id);
    res.json({ ok: true });
  }),
);

app.patch(
  '/api/club',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const club = await store.updateClub(req.body || {});
    res.json({ club });
  }),
);

/* ------------------------------------------------------------------ *
 * SPA fallback + errores
 * ------------------------------------------------------------------ */

app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status >= 500) console.error('[atlas]', error);
  res.status(status).json({ error: error.message || 'Error interno del servidor' });
});
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

/**
 * Conectar con la base de datos y crear el esquema son operaciones de red: el
 * servidor no puede escuchar hasta que terminen, o las primeras peticiones
 * fallarían. El orden de registro importa: sesiones y estáticos primero, rutas
 * después, y el respaldo de la SPA al final.
 */
async function buildApp() {
  const { seeded } = await store.init();

  app.use(
    session({
      name: 'atlas.sid',
      secret: await loadSessionSecret(),
      // Las sesiones viven en PostgreSQL: reiniciar el servidor ya no expulsa a
      // nadie (que era justo lo que parecía al subir una foto).
      store: createPostgresStore(session),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, 'public')));

  registerRoutes(app);

  // Las sesiones caducadas se van limpiando sin esperar a nadie.
  const sweeper = setInterval(() => {
    createPostgresStore(session).clearExpired().catch(() => {});
  }, 60 * 60 * 1000);
  sweeper.unref?.();

  return { seeded };
}

async function start() {
  const { seeded } = await buildApp();
  const server = app.listen(PORT, HOST, () => {
    console.log('⚽ ATLAS · FC27 Clubes Pro');
    console.log(`   Servidor listo en http://localhost:${PORT}`);
    if (seeded) console.log('   Base de datos inicializada con la plantilla del club.');
  });
  return server;
}

/** Cierra la base de datos antes de salir, para no dejar conexiones colgando. */
function installShutdownHooks(server) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    server.close();
    try {
      await db.close();
    } catch {
      /* la conexión ya podría estar cerrada */
    }
    if (signal) process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => shutdown(signal));
  }
  return shutdown;
}

if (require.main === module) {
  start()
    .then((server) => installShutdownHooks(server))
    .catch((error) => {
      console.error('No se pudo arrancar ATLAS:', error.message);
      if (/ECONNREFUSED|ENOTFOUND|no such host|password|database .* does not exist/i.test(error.message)) {
        console.error('Revisa DATABASE_URL (o PGHOST/PGUSER/PGPASSWORD/PGDATABASE).');
      }
      if (/permission denied|no schema has been selected/i.test(error.message)) {
        // PostgreSQL 15+ ya no da permiso de creación en `public` por defecto.
        console.error('El usuario no puede crear tablas en el esquema public. Como superusuario:');
        console.error('  GRANT ALL ON SCHEMA public TO <usuario>;');
      }
      if (/sslmode|self.signed|SSL/i.test(error.message)) {
        console.error('Si tu proveedor exige TLS, prueba con ATLAS_DB_SSL=1.');
      }
      process.exit(1);
    });
}

module.exports = { app, start };
