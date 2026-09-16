'use strict';

import { api } from './api.js';
import { $, escapeHtml, toast } from './utils.js';

/** Posiciones de reserva si la API aún no ha respondido (el registro las necesita). */
export const POSITION_FALLBACK = [
  { key: 'POR', label: 'Portero', group: 'Portería' },
  { key: 'DFC', label: 'Defensa Central', group: 'Defensa' },
  { key: 'LI', label: 'Carrilero Izquierdo', group: 'Carrileros' },
  { key: 'LD', label: 'Carrilero Derecho', group: 'Carrileros' },
  { key: 'MC', label: 'Mediocentro', group: 'Mediocampo' },
  { key: 'DC', label: 'Delantero', group: 'Delantera' },
];

/** Contador para que cada formulario tenga `id` únicos en el documento. */
let authFormCount = 0;

/**
 * Formulario de acceso compartido por el modal, la página de acceso y el check-in.
 * Devuelve el elemento y un `submit()` que resuelve el usuario o devuelve false.
 */
export function createAuthForm({ positions = [], onDone } = {}) {
  const list = positions.length ? positions : POSITION_FALLBACK;
  // El modal de acceso y la página de check-in pueden tener un formulario montado
  // a la vez: sin sufijo, los `id` chocarían y los `label for` apuntarían a otro.
  const uid = `au${(authFormCount += 1)}`;

  const el = document.createElement('div');
  el.className = 'auth';
  el.innerHTML = `
    <div class="auth-tabs" role="tablist">
      <button class="auth-tab is-on" data-tab="login" role="tab" aria-selected="true">Entrar</button>
      <button class="auth-tab" data-tab="register" role="tab" aria-selected="false">Registrarme</button>
    </div>

    <div data-pane="login">
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field">
          <label for="${uid}-lg-user">ID de miembro</label>
          <input class="input" id="${uid}-lg-user" autocomplete="username" placeholder="tu ID en la plantilla" />
        </div>
        <div class="field">
          <label for="${uid}-lg-pass">Contraseña</label>
          <input class="input" id="${uid}-lg-pass" type="password" autocomplete="current-password" />
        </div>
      </div>
      <p class="login-hint">
        Entra con el ID con el que apareces en la plantilla. ¿Primera vez? Pásate a
        <strong>Registrarme</strong> y crea tu cuenta.
      </p>
    </div>

    <div data-pane="register" hidden>
      <div class="form-grid">
        <div class="field">
          <label for="${uid}-rg-user">ID de miembro</label>
          <input class="input" id="${uid}-rg-user" autocomplete="username" placeholder="cómo quieres aparecer" />
        </div>
        <div class="field">
          <label for="${uid}-rg-name">Nombre en la carta</label>
          <input class="input" id="${uid}-rg-name" maxlength="40" placeholder="tu nombre" />
        </div>
        <div class="field">
          <label for="${uid}-rg-number">Dorsal</label>
          <input class="input" id="${uid}-rg-number" inputmode="numeric" maxlength="2" placeholder="9" />
        </div>
        <div class="field">
          <label for="${uid}-rg-pos">Posición</label>
          <select class="input" id="${uid}-rg-pos">
            ${list
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.key)}">${escapeHtml(p.group)} · ${escapeHtml(p.label)}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label for="${uid}-rg-pass">Contraseña</label>
          <input class="input" id="${uid}-rg-pass" type="password" autocomplete="new-password"
                 placeholder="mínimo 6 caracteres" />
        </div>
      </div>
      <p class="login-hint">
        Al registrarte entras directamente: ya puedes firmar el check-in y subir tu foto
        desde tu carta en la Plantilla.
      </p>
    </div>
  `;

  let mode = 'login';

  const showTab = (next) => {
    mode = next;
    const isLogin = next === 'login';
    el.querySelectorAll('[data-tab]').forEach((tab) => {
      const on = tab.dataset.tab === next;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', String(on));
    });
    el.querySelector('[data-pane="login"]').hidden = !isLogin;
    el.querySelector('[data-pane="register"]').hidden = isLogin;
    el.querySelector('.auth-tab.is-on')?.focus();
  };

  el.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });

  /** Envía el formulario. Devuelve el usuario, o false si hay error. */
  const submit = async () => {
    try {
      const { user } =
        mode === 'register'
          ? await api.register({
              username: $(`#${uid}-rg-user`, el).value.trim(),
              displayName: $(`#${uid}-rg-name`, el).value.trim(),
              number: $(`#${uid}-rg-number`, el).value.trim(),
              position: $(`#${uid}-rg-pos`, el).value,
              password: $(`#${uid}-rg-pass`, el).value,
            })
          : await api.login($(`#${uid}-lg-user`, el).value.trim(), $(`#${uid}-lg-pass`, el).value);
      toast(
        mode === 'register'
          ? `Cuenta creada. Bienvenido, ${user.displayName}`
          : `Bienvenido, ${user.displayName}`,
      );
      onDone?.(user);
      return user;
    } catch (error) {
      toast(error.message, 'error');
      return false;
    }
  };

  return { el, submit, showTab, get mode() { return mode; } };
}
