'use strict';

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Crea un elemento a partir de HTML en cadena. */
export function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup).trim();
  return template.content.firstElementChild;
}

export function initials(name) {
  const clean = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const DATE_FMT = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
const DAY_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: '2-digit', month: 'long' });

export function formatDate(value) {
  const date = toDate(value);
  return date ? DATE_FMT.format(date) : String(value || '');
}

export function formatDayLong(value) {
  const date = toDate(value);
  return date ? DAY_FMT.format(date) : String(value || '');
}

function toDate(value) {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function relativeDate(value) {
  const date = toDate(value);
  if (!date) return '';
  const days = Math.round((date - new Date()) / 86400000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${Math.abs(days)} días`;
}

export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ----------------------------------------------------------- Avisos */

export function toast(message, kind = 'ok') {
  const host = $('#toasts');
  if (!host) return;
  const node = html(`<div class="toast ${kind === 'error' ? 'toast--error' : ''}">${escapeHtml(message)}</div>`);
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateX(20px)';
    setTimeout(() => node.remove(), 320);
  }, 3600);
}

/* ----------------------------------------------------------- Modales */

export function openModal({ title, body, actions = [], onMount }) {
  const root = $('#modal-root');
  const veil = html(`
    <div class="modal-veil" role="dialog" aria-modal="true">
      <div class="modal">
        <header class="modal__head">
          <h2 class="modal__title">${escapeHtml(title)}</h2>
          <button class="btn btn--icon btn--ghost" data-close aria-label="Cerrar">✕</button>
        </header>
        <div class="modal__body"></div>
        <footer class="modal__foot"></footer>
      </div>
    </div>
  `);

  const bodyHost = $('.modal__body', veil);
  const footHost = $('.modal__foot', veil);
  if (typeof body === 'string') bodyHost.innerHTML = body;
  else if (body) bodyHost.append(body);

  const close = () => {
    veil.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  for (const action of actions) {
    const button = html(
      `<button class="btn ${action.variant ? `btn--${action.variant}` : ''}">${escapeHtml(action.label)}</button>`,
    );
    button.addEventListener('click', async () => {
      if (action.onClick && (await action.onClick({ close, bodyHost })) === false) return;
      if (action.keepOpen !== true) close();
    });
    footHost.append(button);
  }

  veil.addEventListener('click', (event) => {
    if (event.target === veil) close();
  });
  $('[data-close]', veil).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  root.append(veil);
  if (onMount) onMount({ veil, bodyHost, close });
  const focusable = veil.querySelector('input, textarea, select, button.btn--primary');
  focusable?.focus();
  return { veil, bodyHost, close };
}

export function confirmAction(message, { title = 'Confirmar', confirmLabel = 'Sí, continuar', danger = true } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="line-height:1.65;color:var(--muted)">${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancelar', variant: 'ghost', onClick: () => resolve(false) },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          onClick: () => resolve(true),
        },
      ],
    });
  });
}

/* ----------------------------------------------------------- Imágenes */

/**
 * Recorta la imagen al centro (cuadrada) y la reduce a `size` px, devolviendo
 * una data URL JPEG/WEBP lista para subir al servidor.
 */
export function fileToSquareDataUrl(file, size = 640) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No se seleccionó ninguna imagen'));
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen'));

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - side) / 2;
      const sy = (image.naturalHeight - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    image.src = url;
  });
}

/** Lee un parámetro de la parte de consulta del hash (p. ej. #/pizarra?date=...). */
export function hashParam(name, fallback = '') {
  const query = location.hash.split('?')[1] || '';
  const value = new URLSearchParams(query).get(name);
  return value || fallback;
}

/** Abre el selector de ficheros y devuelve la data URL cuadrada. */
export function pickPhoto(size = 640) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.className = 'sr-only';
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        resolve(await fileToSquareDataUrl(file, size));
      } catch (error) {
        reject(error);
      }
    });
    input.click();
  });
}
