'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');

const store = require('./lib/store');
const uploads = require('./lib/uploads');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
// Detrás del túnel HTTPS de desarrollo el proxy termina TLS: sin esto la sesión
// no se marcaría como segura y la cookie podría no fijarse correctamente.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));

/** Secreto de sesión persistente para que los inicios de sesión sobrevivan a un reinicio. */
function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(store.DATA_DIR, 'session.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* el fichero aún no existe */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

app.use(
  session({
    name: 'atlas.sid',
    secret: loadSessionSecret(),
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

/* ------------------------------------------------------------------ *
 * Helpers HTTP
 * ------------------------------------------------------------------ */

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function currentUser(req) {
  if (!req.session || !req.session.playerId) return null;
  const player = store.findPlayerById(req.session.playerId);
  if (!player) {
    req.session.destroy(() => {});
    return null;
  }
  return player;
}

function requireAuth(req, res, next) {
  const player = currentUser(req);
  if (!player) return res.status(401).json({ error: 'Necesitas iniciar sesión' });
  req.player = player;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.player.isAdmin) return res.status(403).json({ error: 'Solo para el administrador' });
    next();
  });
}

function me(req) {
  const player = currentUser(req);
  return player ? store.publicPlayer(player) : null;
}

function normaliseDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : store.todayISO();
}

/* ------------------------------------------------------------------ *
 * Sesión y perfil
 * ------------------------------------------------------------------ */

app.get('/api/auth/me', (req, res) => {
  res.json({ user: me(req), today: store.todayISO() });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const player = store.authenticate(username, password);
  if (!player) {
    // Mensaje unico para no revelar si el ID existe.
    return res.status(401).json({ error: 'ID de miembro o contraseña incorrectos' });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
    req.session.playerId = player.id;
    res.json({ user: player, today: store.todayISO() });
  });
});

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('atlas.sid');
    res.json({ ok: true });
  });
});

/**
 * Registro de un miembro nuevo: crea su cuenta y lo deja con la sesión iniciada.
 * El dorsal y el ID son suyos; la posición la elige él mismo al entrar.
 */
app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const { username, number, position, displayName, password } = req.body || {};

    const name = String(username || '').trim();
    if (name.length < 3) {
      return res.status(400).json({ error: 'El ID debe tener al menos 3 caracteres' });
    }
    if (String(password || '').length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const dorsal = String(number || '').trim();
    if (!/^\d{1,2}$/.test(dorsal)) {
      return res.status(400).json({ error: 'El dorsal debe ser un número de 1 o 2 cifras' });
    }

    const player = store.createPlayer({
      username: name,
      number: dorsal,
      position,
      displayName,
      password,
    });

    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
      req.session.playerId = player.id;
      res.status(201).json({ user: player, today: store.todayISO() });
    });
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
    if (!store.authenticate(req.player.username, currentPassword)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    const player = store.setPassword(req.player.id, newPassword);
    res.json({ user: player });
  }),
);

/* ------------------------------------------------------------------ *
 * Plantilla
 * ------------------------------------------------------------------ */

app.get('/api/roster', (req, res) => {
  const players = store
    .raw()
    .players.filter((p) => !p.isAdmin)
    .sort(store.playerSort)
    .map(store.publicPlayer);
  res.json({ players, positions: store.POSITIONS, club: store.raw().club });
});

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
    const player = store.updatePlayer(req.player.id, patch);
    res.json({ user: player });
  }),
);

app.post(
  '/api/players',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { username, number, position, displayName, photo } = req.body || {};
    const player = store.createPlayer({ username, number, position, displayName });
    if (photo) store.updatePlayer(player.id, { photo: uploads.saveDataUrl(photo) });
    res.status(201).json({ player: store.publicPlayer(store.findPlayerById(player.id)) });
  }),
);

app.patch(
  '/api/players/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const target = store.findPlayerById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });

    const { username, number, position, displayName, photo, newPassword } = req.body || {};
    const patch = {};
    if (username !== undefined) patch.username = username;
    if (number !== undefined) patch.number = number;
    if (position !== undefined) patch.position = position;
    if (displayName !== undefined) patch.displayName = displayName;
    if (photo !== undefined) {
      patch.photo = photo ? uploads.replaceUpload(target.photo, photo) : (uploads.removeUpload(target.photo), null);
    }

    let player = store.updatePlayer(target.id, patch);
    if (newPassword) player = store.setPassword(target.id, newPassword);
    res.json({ player });
  }),
);

app.delete(
  '/api/players/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const target = store.findPlayerById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });
    uploads.removeUpload(target.photo);
    store.deletePlayer(target.id);
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ *
 * Pizarra táctica
 * ------------------------------------------------------------------ */

app.get('/api/lineup', (req, res) => {
  const date = normaliseDate(req.query.date);
  // La convocatoria solo se envía a quien ha iniciado sesión: la pizarra es
  // pública, pero quién viene al partido no tiene por qué serlo.
  const viewer = currentUser(req);
  res.json({
    lineup: store.raw().lineup,
    positions: store.POSITIONS,
    date,
    statuses: viewer ? store.statusMap(date) : {},
    counts: viewer ? store.sessionView(date).counts : null,
  });
});

app.put(
  '/api/lineup',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const lineup = store.saveLineup(req.body || {});
    res.json({ lineup });
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
    res.json({
      ...store.sessionView(date),
      today: store.todayISO(),
      past: store.pastSessions(),
      statuses: [
        { key: 'yes', label: 'Estaré', icon: '✅' },
        { key: 'no', label: 'No puedo', icon: '❌' },
        { key: 'late', label: 'Llego tarde', icon: '🕐' },
        { key: 'maybe', label: 'Dudo', icon: '🤔' },
      ],
    });
  }),
);

app.post('/api/checkin/me', requireAuth, asyncRoute(async (req, res) => {
  if (req.player.isAdmin) {
    return res.status(400).json({ error: 'La cuenta de administrador no cuenta para el check-in' });
  }
  const { status, message, date } = req.body || {};
  const allowed = ['yes', 'no', 'late', 'maybe'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
  const day = normaliseDate(date);
  store.setCheckIn(day, req.player.id, status, message);
  res.json({ ...store.sessionView(day), today: store.todayISO(), past: store.pastSessions() });
}));

app.post(
  '/api/checkin/admin',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { date, playerId, status, message } = req.body || {};
    const day = normaliseDate(date);
    if (status === null || status === 'clear') {
      const session = store.ensureSession(day);
      delete session.entries[playerId];
      store.saveDatabase();
    } else {
      const allowed = ['yes', 'no', 'late', 'maybe'];
      if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
      if (!store.findPlayerById(playerId)) return res.status(404).json({ error: 'Miembro no encontrado' });
      store.setCheckIn(day, playerId, status, message);
    }
    res.json({ ...store.sessionView(day), today: store.todayISO(), past: store.pastSessions() });
  }),
);

/* ------------------------------------------------------------------ *
 * Historia del club
 * ------------------------------------------------------------------ */

app.get('/api/history', (req, res) => {
  const entries = [...store.raw().history].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return String(b.date).localeCompare(String(a.date));
  });
  res.json({ entries, club: store.raw().club });
});

app.post(
  '/api/history',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { title, date, body, image } = req.body || {};
    const entry = store.addHistory({
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
    const existing = store.raw().history.find((h) => h.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entrada no encontrada' });
    const patch = { ...(req.body || {}) };
    if (patch.image !== undefined) {
      patch.image = patch.image
        ? uploads.replaceUpload(existing.image, patch.image)
        : (uploads.removeUpload(existing.image), null);
    }
    res.json({ entry: store.updateHistory(req.params.id, patch) });
  }),
);

app.delete(
  '/api/history/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = store.raw().history.find((h) => h.id === req.params.id);
    if (existing) uploads.removeUpload(existing.image);
    store.deleteHistory(req.params.id);
    res.json({ ok: true });
  }),
);

app.patch(
  '/api/club',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const allowed = ['name', 'tagline', 'motto', 'coach', 'founded', 'captainId'];
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) {
        store.raw().club[key] = String(req.body[key]).slice(0, 200);
      }
    }
    store.saveDatabase();
    res.json({ club: store.raw().club });
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

app.listen(PORT, HOST, () => {
  console.log(`⚽ ATLAS · FC27 Clubes Pro`);
  console.log(`   Servidor listo en http://localhost:${PORT}`);
  console.log(`   Admin por defecto: ${store.raw().players.find((p) => p.isAdmin)?.username} / atlas-admin`);
});

module.exports = app;
