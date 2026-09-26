'use strict';

/**
 * Prueba de la API contra el servidor real en marcha. Cubre el registro
 * restringido a la plantilla, la publicación del once del día, las notas 1-11
 * sin repetir y las estadísticas que salen en la Plantilla.
 *
 * Uso: node tests/api.test.js [base]
 *
 * Los datos viven en PostgreSQL. `ATLAS_DATABASE_URL` dice en qué base de datos
 * (de pruebas) está trabajando el servidor.
 */

const BASE = process.argv[2] || 'http://localhost:12000';
const COOKIE_NAME = 'atlas.sid';
const DATABASE_URL =
  process.env.ATLAS_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://atlas:atlas-dev-pass@127.0.0.1:5432/atlas_test';

let passed = 0;
let failed = 0;

/** Consulta directa a la base de datos, para comprobar lo que no se ve por la API. */
async function sql(text, params = []) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(text, params);
    return rows;
  } finally {
    await client.end();
  }
}

async function countSessions() {
  const rows = await sql('SELECT count(*)::int AS n FROM sessions');
  return rows[0].n;
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.log(`FALLO ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, { body, jar } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar?.cookie) headers.cookie = jar.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (jar && setCookie.length) {
    const session = setCookie
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (session) jar.cookie = session;
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, json, text };
}

async function login(username, password) {
  const jar = {};
  const res = await call('POST', '/api/auth/login', { body: { username, password }, jar });
  return { ...res, jar };
}

(async () => {
  console.log(`\nATLAS · pruebas de API contra ${BASE}\n`);

  /* ---------------------------------------------- Registro restringido */

  const pending = await call('GET', '/api/auth/available');
  check('la lista de IDs pendientes responde', pending.status === 200, `status ${pending.status}`);
  const pendientes = pending.json?.pending || [];
  check('hay IDs de plantilla sin cuenta', pendientes.length > 0, `${pendientes.length}`);

  const unknown = await call('POST', '/api/auth/register', {
    body: { username: 'inventado_que_no_existe_123', password: 'secreto123' },
  });
  check('no se puede registrar un ID que no está en la plantilla', unknown.status === 404, `status ${unknown.status}`);

  const candidate = pendientes.find((p) => !p.isAdmin);
  check('hay un candidato real para registrar', Boolean(candidate), 'sin pendientes');

  const shortPass = await call('POST', '/api/auth/register', {
    body: { username: candidate.username, password: '123' },
  });
  check('se exige contraseña de 6+ caracteres', shortPass.status === 400, `status ${shortPass.status}`);

  const claimed = await call('POST', '/api/auth/register', {
    body: { username: candidate.username, password: 'atlas-prueba-1' },
  });
  check('un ID de la plantilla se registra', claimed.status === 201, `status ${claimed.status} ${claimed.text.slice(0, 120)}`);
  check('al registrarse queda con sesión iniciada', Boolean(claimed.json?.user?.id), 'sin usuario');
  check('el usuario registrado no es admin', claimed.json?.user?.isAdmin === false);

  const again = await call('POST', '/api/auth/register', {
    body: { username: candidate.username, password: 'otra-clave-123' },
  });
  check('un ID ya reclamado no se puede volver a registrar', again.status === 409, `status ${again.status}`);

  const relogin = await login(candidate.username, 'atlas-prueba-1');
  check('el usuario registrado entra con su contraseña', relogin.status === 200, `status ${relogin.status}`);

  const wrong = await call('POST', '/api/auth/login', {
    body: { username: candidate.username, password: 'no-es-la-buena' },
  });
  check('una contraseña incorrecta no entra', wrong.status === 401, `status ${wrong.status}`);

  /* ---------------------------------------------- Mánager y jugador */

  const admin = await login('admin', 'atlas-admin');
  check('el mánager entra con sus credenciales', admin.status === 200, `status ${admin.status}`);

  const playerJar = relogin.jar;
  const roster = await call('GET', '/api/roster');
  const players = roster.json?.players || [];
  check('la plantilla trae a los 16 jugadores', players.length === 16, `${players.length}`);
  check('cada jugador trae estadísticas', players.every((p) => p.stats && typeof p.stats.played === 'number'));

  /* Un mánager que además juega: dar permisos no puede borrarlo del roster. */
  const promotable = players.find((p) => p.id !== candidate.id);
  await sql('UPDATE players SET is_admin = true WHERE id = $1', [promotable.id]);
  const afterPromotion = await call('GET', '/api/roster');
  const stillListed = (afterPromotion.json?.players || []).some((p) => p.id === promotable.id);
  check('un jugador con permisos de mánager sigue en la plantilla', stillListed, promotable.id);
  check(
    'y conserva su dorsal y su posición',
    (afterPromotion.json?.players || []).some(
      (p) => p.id === promotable.id && p.number === promotable.number && p.position === promotable.position,
    ),
  );
  await sql('UPDATE players SET is_admin = false WHERE id = $1', [promotable.id]);

  /* La cuenta técnica de administración no es jugador: no sale ni ficha. */
  check('la cuenta de administración no aparece en la plantilla', !players.some((p) => p.username === 'admin'));

  const adminCheckin = await call('POST', '/api/checkin/me', {
    body: { date: new Date().toISOString().slice(0, 10), status: 'yes' },
    jar: admin.jar,
  });
  check('la cuenta que no juega no firma check-in', adminCheckin.status === 400, `status ${adminCheckin.status}`);

  // Los jugadores tienen que estar en PostgreSQL de verdad, no en memoria.
  const stored = await sql('SELECT count(*)::int AS n FROM players');
  check('los jugadores están guardados en la base de datos', stored[0].n === 17, `${stored[0].n}`);

  // El once de prueba incluye portero y central a propósito: son las
  // posiciones a las que suma una portería a cero.
  const keeper = players.find((p) => p.position === 'POR' && p.id !== candidate.id);
  const centreBack = players.find((p) => p.position === 'DFC' && p.id !== candidate.id && p.id !== keeper?.id);
  const rest = players
    .filter((p) => ![candidate.id, keeper?.id, centreBack?.id].includes(p.id))
    .slice(0, 1)
    .map((p) => p.id);
  const squad = [candidate.id, keeper?.id, centreBack?.id, ...rest].filter(Boolean);
  const date = new Date().toISOString().slice(0, 10);
  const items = squad.map((playerId, index) => ({
    playerId,
    x: 0.2 + index * 0.2,
    y: 0.3 + index * 0.1,
    vertical: true,
  }));

  const publishAsPlayer = await call('POST', `/api/matches/${date}/publish`, {
    body: { formation: '4-3-3', items },
    jar: playerJar,
  });
  check('un jugador no puede publicar el once', publishAsPlayer.status === 403, `status ${publishAsPlayer.status}`);

  const published = await call('POST', `/api/matches/${date}/publish`, {
    body: { formation: '4-3-3', items },
    jar: admin.jar,
  });
  check('el mánager publica el once del día', published.status === 200, `status ${published.status} ${published.text.slice(0, 140)}`);
  check('el partido queda como publicado', published.json?.match?.published === true);
  check('el partido lista los 4 que jugaron', published.json?.match?.playerIds?.length === 4);

  const lineup = await call('GET', `/api/lineup?date=${date}`);
  check('la pizarra informa del partido publicado', lineup.json?.match?.published === true);
  check('la pizarra trae el roster embebido', Array.isArray(lineup.json?.roster) && lineup.json.roster.length === 16);

  /* ---------------------------------------------- Notas 1-11 sin repetir */

  const targets = squad.filter((id) => id !== candidate.id);
  const repeated = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [targets[0]]: 5, [targets[1]]: 5 } },
    jar: playerJar,
  });
  check('no se puede repetir una nota en la misma papeleta', repeated.status === 409, `status ${repeated.status}`);

  const outOfRange = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [targets[0]]: 12 } },
    jar: playerJar,
  });
  check('una nota fuera de 1-11 se rechaza', outOfRange.status === 400, `status ${outOfRange.status}`);

  const selfVote = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [candidate.id]: 11 } },
    jar: playerJar,
  });
  check(
    'no se puede votar a uno mismo',
    selfVote.status === 200 && Object.keys(selfVote.json.match.myScores).length === 0,
    `status ${selfVote.status}`,
  );

  const valid = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [targets[0]]: 11, [targets[1]]: 7, [targets[2]]: 3 } },
    jar: playerJar,
  });
  check('una papeleta válida se guarda', valid.status === 200, `status ${valid.status}`);
  check('el votante recupera sus notas', Object.keys(valid.json?.match?.myScores || {}).length === 3);

  const outsider = players.find((p) => !squad.includes(p.id));
  const outsiderLogin = await login(outsider.username, 'atlas-prueba-no-existe');
  check('un compañero sin cuenta todavía no puede entrar', outsiderLogin.status === 401, `status ${outsiderLogin.status}`);

  const voteAdmin = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [targets[0]]: 9 } },
    jar: admin.jar,
  });
  check('el mánager no vota aunque sea admin', voteAdmin.status === 403, `status ${voteAdmin.status}`);

  /* ---------------------------------------------- Estadísticas */

  const statsRes = await call('PATCH', `/api/matches/${date}/stats/${squad[0]}`, {
    body: { goals: 2, assists: 1 },
    jar: admin.jar,
  });
  check('el mánager anota goles y asistencias', statsRes.status === 200, `status ${statsRes.status}`);
  check('los goles guardados son 2', statsRes.json?.stats?.goals === 2);

  const asPlayer = await call('PATCH', `/api/matches/${date}/stats/${squad[1]}`, {
    body: { goals: 5 },
    jar: playerJar,
  });
  check('un jugador no puede tocar las estadísticas', asPlayer.status === 403, `status ${asPlayer.status}`);

  const rosterAfter = await call('GET', '/api/roster');
  const updatedPlayers = rosterAfter.json?.players || [];
  const scorer = updatedPlayers.find((p) => p.id === squad[0]);
  check('el goleador suma su partido jugado', scorer?.stats?.played === 1, `${scorer?.stats?.played}`);
  check('el goleador suma 2 goles', scorer?.stats?.goals === 2, `${scorer?.stats?.goals}`);
  check('el goleador suma 1 asistencia', scorer?.stats?.assists === 1, `${scorer?.stats?.assists}`);

  const rated = updatedPlayers.find((p) => p.id === targets[0]);
  check('quien recibió un 11 lo ve reflejado de media', rated?.stats?.average === 11, `${rated?.stats?.average}`);
  check('quien recibió un 11 cuenta un voto', rated?.stats?.votes === 1, `${rated?.stats?.votes}`);

  const untouched = updatedPlayers.find((p) => p.id === outsider.id);
  check('quien no jugó no suma partidos', untouched?.stats?.played === 0, `${untouched?.stats?.played}`);

  /* ------------------------------------------ Porterías imbatidas */

  const notAdmin = await call('PATCH', `/api/matches/${date}/clean-sheet`, {
    body: { cleanSheet: true },
    jar: playerJar,
  });
  check('un jugador no puede marcar la portería a cero', notAdmin.status === 403, `status ${notAdmin.status}`);

  const clean = await call('PATCH', `/api/matches/${date}/clean-sheet`, {
    body: { cleanSheet: true },
    jar: admin.jar,
  });
  check('el mánager marca la portería a cero', clean.status === 200, `status ${clean.status}`);
  check('la portería a cero queda guardada', clean.json?.cleanSheet === true);

  const afterCleanSheet = await call('GET', '/api/roster');
  const csPlayers = afterCleanSheet.json?.players || [];
  const gk = csPlayers.find((p) => p.id === keeper?.id);
  const df = csPlayers.find((p) => p.id === centreBack?.id);
  const fw = csPlayers.find((p) => p.id === rest[0]);
  check('el portero suma una portería imbatida', gk?.stats?.cleanSheets === 1, `${gk?.stats?.cleanSheets}`);
  check('el central suma una portería imbatida', df?.stats?.cleanSheets === 1, `${df?.stats?.cleanSheets}`);
  check('el jugador de campo no la suma', fw?.stats?.cleanSheets === 0, `${fw?.stats?.cleanSheets}`);
  check(
    'solo porteros y centrales muestran la estadística',
    gk?.stats?.cleanSheetsEligible === true && fw?.stats?.cleanSheetsEligible === false,
  );

  const offAgain = await call('PATCH', `/api/matches/${date}/clean-sheet`, {
    body: { cleanSheet: false },
    jar: admin.jar,
  });
  check('se puede desmarcar la portería a cero', offAgain.json?.cleanSheet === false);

  const afterOff = await call('GET', '/api/roster');
  check(
    'al desmarcarla, la estadística vuelve a cero',
    afterOff.json?.players?.find((p) => p.id === keeper?.id)?.stats?.cleanSheets === 0,
  );

  const missing = await call('PATCH', '/api/matches/2000-01-01/clean-sheet', {
    body: { cleanSheet: true },
    jar: admin.jar,
  });
  check('no se puede marcar un día sin partido', missing.status === 404, `status ${missing.status}`);

  /* ---------------------------------------------- Restablecer cuenta */

  const resetWrong = await call('POST', `/api/players/${candidate.id}/reset-account`, { jar: playerJar });
  check('un jugador no puede restablecer cuentas', resetWrong.status === 403, `status ${resetWrong.status}`);

  const reset = await call('POST', `/api/players/${candidate.id}/reset-account`, { jar: admin.jar });
  check('el mánager restablece la cuenta de un miembro', reset.status === 200, `status ${reset.status}`);
  check('la cuenta queda sin reclamar', reset.json?.player?.claimed === false);

  const afterReset = await call('POST', '/api/auth/login', {
    body: { username: candidate.username, password: 'atlas-prueba-1' },
  });
  check('la contraseña anterior deja de valer', afterReset.status === 401, `status ${afterReset.status}`);

  const backInPending = await call('GET', '/api/auth/available');
  check(
    'el ID vuelve a la lista de registro',
    (backInPending.json?.pending || []).some((p) => p.username === candidate.username),
  );

  const reclaim = await call('POST', '/api/auth/register', {
    body: { username: candidate.username, password: 'clave-nueva-123' },
  });
  check('el miembro puede volver a activar su cuenta', reclaim.status === 201, `status ${reclaim.status}`);

  /* ------------------------------- Sesión persistente entre reinicios */

  // Un reinicio del servidor no debe expulsar a quien ya estaba dentro:
  // esto es lo que hacía parecer que subir una foto te sacaba de la web.
  // Las sesiones viven en la tabla `sessions`, no en un fichero.
  const adminJar = {};
  const adminLogin = await call('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'atlas-admin' },
    jar: adminJar,
  });
  check('el mánager entra', adminLogin.status === 200, `status ${adminLogin.status}`);
  check('el mánager recibe su cookie de sesión', Boolean(adminJar.cookie), 'sin cookie');

  const sessions = await countSessions();
  check('la sesión se guarda en la base de datos', sessions > 0, `${sessions}`);

  // La prueba de fuego: la sesión guardada tiene que servir para volver a
  // entrar sin credenciales, como tras un reinicio del servidor.
  const resumed = await call('GET', '/api/auth/me', { jar: adminJar });
  check(
    'la sesión guardada sigue identificando al mánager',
    resumed.json?.user?.username === 'admin',
    JSON.stringify(resumed.json?.user?.username),
  );

  /* ---------------------------------------------- Ayudas y pruebas */

  // Una ayuda es gente de fuera que completa el once: no es plantilla, no tiene
  // cuenta y no debe colarse ni en las cartas ni en el check-in.
  const guestName = 'Invitado de prueba';
  const newGuest = await call('POST', '/api/guests', { body: { name: guestName }, jar: admin.jar });
  check('el mánager añade una ayuda', newGuest.status === 201, `status ${newGuest.status} ${newGuest.text.slice(0, 120)}`);
  const guestId = newGuest.json?.guest?.id;
  check('la ayuda se marca como de fuera y no como jugador', newGuest.json?.guest?.isGuest === true && newGuest.json?.guest?.isPlayer === false);

  const againGuest = await call('POST', '/api/guests', { body: { name: guestName }, jar: admin.jar });
  check(
    'repetir el nombre reutiliza la misma ficha',
    againGuest.status === 200 && againGuest.json?.guest?.id === guestId,
    `status ${againGuest.status}`,
  );

  const secondGuest = await call('POST', '/api/guests', { body: { name: 'Segundo invitado' }, jar: admin.jar });
  check('puede haber varias ayudas a la vez', secondGuest.status === 201 && secondGuest.json?.guest?.id !== guestId);

  const guestList = await call('GET', '/api/guests', { jar: admin.jar });
  check('la lista de ayudas trae las dos', (guestList.json?.guests || []).length === 2, `${(guestList.json?.guests || []).length}`);

  const guestAsPlayer = await call('POST', '/api/guests', { body: { name: 'Cuela que no' }, jar: playerJar });
  check('un jugador no puede añadir ayudas', guestAsPlayer.status === 403, `status ${guestAsPlayer.status}`);

  const rosterWithGuest = await call('GET', '/api/roster');
  check(
    'la ayuda no aparece en las cartas de la plantilla',
    !(rosterWithGuest.json?.players || []).some((p) => p.id === guestId),
  );

  const checkinWithGuest = await call('GET', `/api/checkin?date=${date}`, { jar: admin.jar });
  check(
    'la ayuda no entra en la lista de check-in',
    !(checkinWithGuest.json?.roster || []).some((r) => r.player.id === guestId),
  );

  const guestLogin = await login(newGuest.json?.guest?.username, 'lo-que-sea-123');
  check('una ayuda no puede iniciar sesión', guestLogin.status === 401, `status ${guestLogin.status}`);

  const available = await call('GET', '/api/auth/available');
  check(
    'una ayuda no aparece como ID pendiente de registro',
    !(available.json?.pending || []).some((p) => p.id === guestId || p.username === guestName),
  );

  const renamed = await call('PATCH', `/api/guests/${guestId}`, {
    body: { name: 'Invitado renombrado' },
    jar: admin.jar,
  });
  check(
    'renombrar conserva la ficha',
    renamed.status === 200 && renamed.json?.guest?.id === guestId && renamed.json?.guest?.displayName === 'Invitado renombrado',
    `status ${renamed.status}`,
  );

  // El once admite ayudas junto a la plantilla: son fichas del campo igual.
  const itemsWithGuest = [...items, { playerId: guestId, x: 0.5, y: 0.1, vertical: true }];
  const publishedWithGuest = await call('POST', `/api/matches/${date}/publish`, {
    body: { formation: '4-3-3', items: itemsWithGuest },
    jar: admin.jar,
  });
  check('se puede publicar un once con una ayuda', publishedWithGuest.status === 200, `status ${publishedWithGuest.status}`);
  check(
    'la ayuda queda entre las fichas del once',
    (publishedWithGuest.json?.match?.items || []).some((i) => i.playerId === guestId),
  );

  const lineupWithGuest = await call('GET', `/api/lineup?date=${date}`);
  check(
    'la pizarra pública recibe la ayuda del once para poder pintarla',
    (lineupWithGuest.json?.guests || []).some((g) => g.id === guestId),
    JSON.stringify((lineupWithGuest.json?.guests || []).map((g) => g.id)),
  );

  const voteGuest = await call('POST', `/api/matches/${date}/ratings`, {
    body: { scores: { [guestId]: 11 } },
    jar: playerJar,
  });
  check(
    'no se puede puntuar a una ayuda',
    voteGuest.status === 200 && Object.keys(voteGuest.json?.match?.myScores || {}).length === 0,
    `status ${voteGuest.status}`,
  );

  const removedGuest = await call('DELETE', `/api/guests/${guestId}`, { jar: admin.jar });
  check('el mánager borra una ayuda', removedGuest.status === 200, `status ${removedGuest.status}`);
  const lineupAfterDelete = await call('GET', `/api/lineup?date=${date}`);
  check(
    'la ayuda borrada desaparece de la pizarra',
    !(lineupAfterDelete.json?.guests || []).some((g) => g.id === guestId),
  );

  /* ---------------------------------------------- Limpieza */

  const unpublish = await call('DELETE', `/api/matches/${date}`, { jar: admin.jar });
  check('el mánager puede retirar el once del día', unpublish.status === 200, `status ${unpublish.status}`);

  const cleaned = await call('GET', '/api/roster');
  const afterClean = cleaned.json?.players?.find((p) => p.id === squad[0]);
  check('al retirar el partido se limpian las estadísticas', afterClean?.stats?.played === 0, `${afterClean?.stats?.played}`);

  console.log(`\n${passed} correctas, ${failed} fallidas\n`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('Error inesperado en las pruebas:', error);
  process.exit(1);
});
