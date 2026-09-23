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
        Entra con el ID con el que apareces en la plantilla.
      </p>
    </div>

    <div data-pane="register" hidden>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field">
          <label for="${uid}-rg-user">Tu ID en la plantilla</label>
          <input class="input" id="${uid}-rg-user" autocomplete="username" placeholder="ej. tonii_gk" />
        </div>
        <div class="field">
          <label for="${uid}-rg-pass">Contraseña que quieres usar</label>
          <input class="input" id="${uid}-rg-pass" type="password" autocomplete="new-password"
                 placeholder="mínimo 6 caracteres" />
        </div>
      </div>
      <p class="login-hint" id="${uid}-rg-hint"></p>
    </div>
  `;

  let mode = 'login';

  /** Muestra qué IDs de la plantilla siguen sin cuenta, para orientar al que llega. */
  const paintHint = async () => {
    const hint = $(`#${uid}-rg-hint`, el);
    if (!hint) return;
    try {
      const { pending } = await api.pendingAccounts();
      hint.innerHTML = pending.length
        ? `Solo pueden registrarse los IDs de la plantilla. Sin cuenta todavía:
           <strong>${pending.map((p) => escapeHtml(p.username)).join(', ')}</strong>.`
        : 'Todos los IDs de la plantilla ya tienen cuenta. Entra con tu contraseña.';
    } catch {
      hint.textContent = 'Escribe el ID con el que apareces en la plantilla del club.';
    }
  };
  paintHint();

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
              password: $(`#${uid}-rg-pass`, el).value,
            })
          : await api.login($(`#${uid}-lg-user`, el).value.trim(), $(`#${uid}-lg-pass`, el).value);
      toast(
        mode === 'register'
          ? `Cuenta activada. Bienvenido, ${user.displayName}`
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
