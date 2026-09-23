'use strict';

/**
 * Contraseñas y generación de identificadores.
 *
 * Va aparte de `store.js` para que los módulos que solo necesitan comprobar una
 * contraseña (la migración, las pruebas) no arrastren todo el acceso a datos.
 */

const crypto = require('crypto');

/** El ID de un miembro derivado de su nombre: minúsculas, sin acentos, con guiones. */
function slugId(username) {
  return (
    String(username)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || crypto.randomUUID().slice(0, 8)
  );
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

/**
 * Contraseña que usaban las cuentas antiguas (`atlas` + dorsal). Ya no se asigna
 * a nadie: se conserva solo para detectar en la migración quién seguía con ella
 * puesta y dejar su cuenta sin reclamar.
 */
function defaultPasswordFor(number) {
  return `atlas${number}`;
}

module.exports = { slugId, hashPassword, verifyPassword, defaultPasswordFor };
