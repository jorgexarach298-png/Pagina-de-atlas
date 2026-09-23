'use strict';

/**
 * Migra los datos del antiguo `data/atlas.json` a PostgreSQL.
 *
 *   node scripts/migrate-json-to-db.js [ruta/al/atlas.json]
 *
 * Es idempotente: se puede repetir sin duplicar nada, porque cada fila se
 * inserta por su clave. Migra también el fichero de sesiones y el secreto, para
 * que quien estuviera dentro no tenga que volver a entrar.
 *
 * Uso típico contra Supabase:
 *
 *   DATABASE_URL="postgresql://...supabase..." node scripts/migrate-json-to-db.js
 */

const fs = require('fs');
const path = require('path');

const db = require('../lib/db');

const source = process.argv[2] || path.join(__dirname, '..', 'data', 'atlas.json');

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`No se pudo leer ${file}: ${error.message}`);
  }
}

function slugId(username) {
  return (
    String(username)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'jugador'
  );
}

async function migrate() {
  const data = loadJson(source);
  if (!data) {
    console.log(`No hay nada que migrar: no existe ${source}.`);
    return;
  }

  await db.ensureSchema();

  const counts = { players: 0, lineup: 0, matches: 0, checkins: 0, history: 0, sessions: 0 };

  await db.transaction(async (client) => {
    /* ------------------------------------------------ Jugadores */
    for (const player of data.players || []) {
      const credentials = player.credentials || {};
      await client.query(
        `INSERT INTO players (id, number, username, display_name, position, photo, is_admin, sort_order, claimed, password_salt, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           number = EXCLUDED.number, username = EXCLUDED.username,
           display_name = EXCLUDED.display_name, position = EXCLUDED.position,
           photo = EXCLUDED.photo, is_admin = EXCLUDED.is_admin,
           sort_order = EXCLUDED.sort_order, claimed = EXCLUDED.claimed,
           password_salt = EXCLUDED.password_salt, password_hash = EXCLUDED.password_hash,
           updated_at = now()`,
        [
          player.id || slugId(player.username),
          String(player.number ?? ''),
          player.username,
          player.displayName || player.username,
          player.position,
          player.photo || null,
          Boolean(player.isAdmin),
          Number.isInteger(player.order) ? player.order : counts.players,
          Boolean(player.claimed),
          credentials.salt || '',
          credentials.hash || '',
        ],
      );
      counts.players += 1;
    }

    /* ------------------------------------------------ Alineación guardada */
    const lineup = data.lineup || { formation: '4-3-3', items: [] };
    await client.query(
      `INSERT INTO lineup (id, formation) VALUES (true, $1)
       ON CONFLICT (id) DO UPDATE SET formation = EXCLUDED.formation, updated_at = now()`,
      [String(lineup.formation || '4-3-3').slice(0, 40)],
    );
    await client.query('DELETE FROM lineup_items');
    let order = 0;
    for (const item of lineup.items || []) {
      if (!item?.playerId) continue;
      await client.query(
        `INSERT INTO lineup_items (player_id, x, y, vertical, position)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_id) DO NOTHING`,
        [item.playerId, Number(item.x) || 0.5, Number(item.y) || 0.5, item.vertical !== false, order],
      );
      order += 1;
      counts.lineup += 1;
    }

    /* ------------------------------------------------ Partidos */
    for (const match of data.matches || []) {
      await client.query(
        `INSERT INTO matches (date, formation, note, clean_sheet, published_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (date) DO UPDATE SET
           formation = EXCLUDED.formation, note = EXCLUDED.note,
           clean_sheet = EXCLUDED.clean_sheet, published_at = EXCLUDED.published_at`,
        [
          match.date,
          match.formation || '4-3-3',
          match.note || '',
          Boolean(match.cleanSheet),
          match.publishedAt || null,
        ],
      );

      let pos = 0;
      for (const item of match.items || []) {
        if (!item?.playerId) continue;
        await client.query(
          `INSERT INTO match_items (match_date, player_id, x, y, vertical, position)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (match_date, player_id) DO UPDATE SET
             x = EXCLUDED.x, y = EXCLUDED.y, vertical = EXCLUDED.vertical, position = EXCLUDED.position`,
          [match.date, item.playerId, Number(item.x) || 0.5, Number(item.y) || 0.5, item.vertical !== false, pos],
        );
        pos += 1;
      }

      for (const [playerId, line] of Object.entries(match.stats || {})) {
        await client.query(
          `INSERT INTO match_stats (match_date, player_id, goals, assists)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (match_date, player_id) DO UPDATE SET goals = EXCLUDED.goals, assists = EXCLUDED.assists`,
          [match.date, playerId, Number(line?.goals) || 0, Number(line?.assists) || 0],
        );
      }

      for (const [voterId, ballot] of Object.entries(match.ballots || {})) {
        await client.query(
          `INSERT INTO match_ballots (match_date, voter_id) VALUES ($1,$2)
           ON CONFLICT (match_date, voter_id) DO NOTHING`,
          [match.date, voterId],
        );
        for (const [targetId, score] of Object.entries(ballot?.scores || {})) {
          await client.query(
            `INSERT INTO match_scores (match_date, voter_id, target_id, score)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (match_date, voter_id, target_id) DO UPDATE SET score = EXCLUDED.score`,
            [match.date, voterId, targetId, Number(score)],
          );
        }
      }
      counts.matches += 1;
    }

    /* ------------------------------------------------ Check-in */
    for (const session of data.sessions || []) {
      await client.query(
        `INSERT INTO checkin_days (date, note) VALUES ($1,$2)
         ON CONFLICT (date) DO UPDATE SET note = EXCLUDED.note`,
        [session.date, session.note || ''],
      );
      for (const [playerId, entry] of Object.entries(session.entries || {})) {
        await client.query(
          `INSERT INTO checkins (date, player_id, status, message)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (date, player_id) DO UPDATE SET
             status = EXCLUDED.status, message = EXCLUDED.message`,
          [session.date, playerId, entry.status, entry.message || ''],
        );
        counts.checkins += 1;
      }
    }

    /* ------------------------------------------------ Historia */
    let position = 0;
    for (const entry of data.history || []) {
      await client.query(
        `INSERT INTO history (id, title, date, body, image, pinned, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, date = EXCLUDED.date, body = EXCLUDED.body,
           image = EXCLUDED.image, pinned = EXCLUDED.pinned`,
        [entry.id, entry.title, entry.date, entry.body || '', entry.image || null, Boolean(entry.pinned), position],
      );
      position += 1;
      counts.history += 1;
    }

    /* ------------------------------------------------ Club */
    if (data.club) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('club', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(data.club)],
      );
    }
  });

  /* ------------------------------------------------ Sesiones y secreto */
  const sessions = loadJson(path.join(path.dirname(source), 'sessions.json'));
  for (const [sid, entry] of Object.entries(sessions?.sessions || {})) {
    await db.query(
      `INSERT INTO sessions (sid, data, expires) VALUES ($1,$2,$3)
       ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires`,
      [sid, entry.data, entry.expires ?? null],
    );
    counts.sessions += 1;
  }

  // El secreto de sesión pasa a la base de datos para que las cookies que ya
  // están en los navegadores sigan valiendo tras la migración.
  const keyFile = path.join(path.dirname(source), 'session.key');
  if (fs.existsSync(keyFile)) {
    const secret = fs.readFileSync(keyFile, 'utf8').trim();
    if (secret.length >= 32) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ('session_secret', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [secret],
      );
      console.log('Secreto de sesión migrado: las sesiones abiertas siguen valiendo.');
    }
  }

  console.log('Migración completada:');
  console.log(`  jugadores:  ${counts.players}`);
  console.log(`  alineación: ${counts.lineup} fichas`);
  console.log(`  partidos:   ${counts.matches}`);
  console.log(`  check-ins:  ${counts.checkins}`);
  console.log(`  historia:   ${counts.history}`);
  console.log(`  sesiones:   ${counts.sessions}`);
  console.log('\nLas fotos siguen en data/uploads/ y se sirven desde /uploads.');
}

migrate()
  .then(() => db.close())
  .catch(async (error) => {
    console.error('La migración falló:', error.message);
    await db.close().catch(() => {});
    process.exit(1);
  });
