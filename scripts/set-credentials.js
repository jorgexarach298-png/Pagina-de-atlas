'use strict';

/**
 * Da permisos de mánager a un miembro y/o cambia su contraseña.
 *
 *   node scripts/set-credentials.js <ID> <contraseña> [--admin|--no-admin]
 *   node scripts/set-credentials.js <ID> --password <contraseña> [...]
 *
 * Se hace por script y no a mano en la base de datos para que la contraseña se
 * guarde con el mismo `scrypt` + sal que usa la web: escribiéndola directamente
 * con SQL quedaría un hash que el login no sabría comprobar.
 *
 * Dar permisos NO saca al miembro de la plantilla: `is_admin` da acceso al
 * panel y `is_player` es lo que lo mantiene en las cartas. Un mánager que juega
 * conserva su dorsal, su posición y su sitio en la pizarra.
 *
 * Es idempotente: repetirlo solo vuelve a aplicar lo que se pida.
 */

const db = require('../lib/db');
const { hashPassword } = require('../lib/passwords');

function usage() {
  console.log('Uso: node scripts/set-credentials.js <ID> <contraseña> [--admin|--no-admin]');
  console.log('     node scripts/set-credentials.js <ID> --password <contraseña> [--admin|--no-admin]');
  console.log('');
  console.log('Ejemplos:');
  console.log('  node scripts/set-credentials.js RodriKTV mk3Nphp2 --admin');
  console.log('  node scripts/set-credentials.js admin 123456780');
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  let username = null;
  let password = null;
  let admin = null;

  while (args.length) {
    const token = args.shift();
    if (token === '--admin') admin = true;
    else if (token === '--no-admin') admin = false;
    else if (token === '--password') password = args.shift();
    else if (!username) username = token;
    else if (password === null) password = token;
    else usage();
  }

  if (!username || !password) usage();
  return { username, password: String(password), admin };
}

async function main() {
  const { username, password, admin } = parseArgs(process.argv.slice(2));

  await db.ensureSchema();

  const { rows } = await db.query('SELECT * FROM players WHERE lower(username) = lower($1)', [username]);
  const player = rows[0];
  if (!player) {
    console.error(`No existe ningún miembro con el ID «${username}».`);
    process.exit(1);
  }

  const { salt, hash } = hashPassword(password);
  const nextAdmin = admin === null ? player.is_admin : admin;

  const { rows: updated } = await db.query(
    `UPDATE players
        SET password_salt = $2, password_hash = $3, claimed = true,
            is_admin = $4, updated_at = now()
      WHERE id = $1
      RETURNING username, display_name, number, position, is_admin, is_player`,
    [player.id, salt, hash, nextAdmin],
  );

  const row = updated[0];
  console.log('Credenciales actualizadas:');
  console.log(`  ID:         ${row.username}`);
  console.log(`  Nombre:     ${row.display_name}`);
  console.log(`  Dorsal:     ${row.number || '(sin dorsal)'}`);
  console.log(`  Posición:   ${row.position}`);
  console.log(`  Contraseña: (actualizada)`);
  console.log(`  Mánager:    ${row.is_admin ? 'sí' : 'no'}`);
  console.log(`  En plantilla: ${row.is_player ? 'sí' : 'no — es una cuenta solo de administración'}`);
  if (row.is_admin && row.is_player) {
    console.log('');
    console.log('Nota: al ser mánager y jugador a la vez, sigue apareciendo en la Plantilla,');
    console.log('      en la Pizarra y puede firmar su propio check-in.');
  }
}

main()
  .then(() => db.close())
  .catch(async (error) => {
    console.error('No se pudieron actualizar las credenciales:', error.message);
    await db.close().catch(() => {});
    process.exit(1);
  });
