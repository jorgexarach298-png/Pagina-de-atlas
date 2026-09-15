'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { UPLOAD_DIR, HttpError } = require('./store');

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Guarda una imagen enviada como data URL (el cliente la recorta y redimensiona
 * antes de subirla) y devuelve su ruta pública.
 */
function saveDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'Imagen inválida');
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new HttpError(400, 'Formato de imagen no soportado');

  const [, mime, payload] = match;
  const ext = ALLOWED[mime];
  if (!ext) throw new HttpError(400, 'Solo se admiten imágenes JPG, PNG o WEBP');

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'La imagen supera los 6 MB permitidos');

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

/** Borra un fichero previo de data/uploads, ignorando rutas externas o ausentes. */
function removeUpload(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/')) return false;
  const filename = path.basename(publicPath);
  const target = path.join(UPLOAD_DIR, filename);
  if (!target.startsWith(UPLOAD_DIR)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Reemplaza una foto devolviendo la ruta nueva y limpiando la anterior. */
function replaceUpload(previousPath, dataUrl) {
  const next = saveDataUrl(dataUrl);
  if (previousPath && previousPath !== next) removeUpload(previousPath);
  return next;
}

module.exports = { saveDataUrl, removeUpload, replaceUpload, MAX_BYTES };
