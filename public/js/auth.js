'use strict';

import { api } from './api.js';
import { $, toast } from './utils.js';

/** Contador para que cada formulario tenga `id` únicos en el documento. */
let authFormCount = 0;

/**
 * Formulario de acceso compartido por el modal, la página de acceso y el check-in.
 * No hay registro: cada miembro ya existe en la plantilla y entra con su ID.
 * Devuelve el elemento y un `submit()` que resuelve el usuario o devuelve false.
 */
export function createAuthForm({ onDone } = {}) {
  // El modal de acceso y la página de check-in pueden tener un formulario montado
  // a la vez: sin sufijo, los `id` chocarían y los `label for` apuntarían a otro.
  const uid = `au${(authFormCount += 1)}`;

  const el = document.createElement('div');
  el.className = 'auth';
  el.innerHTML = `
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
      Entra con el ID con el que apareces en la plantilla y tu contraseña.
      Si no la recuerdas, pídele al administrador que te la reinicie.
    </p>
  `;

  /** Envía el formulario. Devuelve el usuario, o false si hay error. */
  const submit = async () => {
    try {
      const { user } = await api.login(
        $(`#${uid}-lg-user`, el).value.trim(),
        $(`#${uid}-lg-pass`, el).value,
      );
      toast(`Bienvenido, ${user.displayName}`);
      onDone?.(user);
      return user;
    } catch (error) {
      toast(error.message, 'error');
      return false;
    }
  };

  return { el, submit };
}

