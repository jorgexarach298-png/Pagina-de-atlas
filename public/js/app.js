'use strict';

import { api } from './api.js';
import { $, escapeHtml, html, initials, openModal, pickPhoto, toast, todayISO } from './utils.js';
import { createAuthForm } from './auth.js';

import { renderHome } from './views/home.js';
import { renderRoster } from './views/roster.js';
import { renderPizarra } from './views/pizarra.js';
import { renderCheckin } from './views/checkin.js';
import { renderHistory } from './views/history.js';

const ROUTES = {
  inicio: { title: 'Inicio', render: renderHome },
  plantilla: { title: 'Plantilla', render: renderRoster },
  pizarra: { title: 'Pizarra', render: renderPizarra },
  checkin: { title: 'Check-in', render: renderCheckin },
  historia: { title: 'Historia', render: renderHistory },
};

const state = { user: null, club: {}, positions: [], toastShown: false };

const ctx = {
  state,
  get outlet() {
    return $('#view');
  },
  mount(markup) {
    $('#view').innerHTML = markup;
  },
  onUserChange: () => paintSession(),
  // Las vistas lo necesitan para ofrecer un botón de acceso en su propio
  // contenido: si solo se puede entrar desde la cabecera, media web (la portada,
  // el check-in) te dice «inicia sesión» sin darte dónde.
  openLogin,
  reload: () => render(),
};

/* ------------------------------------------------------------ Sesión */

function paintSession() {
  const host = $('#session');
  const user = state.user;

  if (!user) {
    host.innerHTML = `<button class="btn btn--primary" id="open-login">Entrar</button>`;
    $('#open-login').addEventListener('click', () => openLogin(() => reload()));
    return;
  }

  host.innerHTML = `
    <button class="session__who" id="open-account" title="Tu cuenta">
      ${
        user.photo
          ? `<img class="session__avatar" src="${escapeHtml(user.photo)}" alt="" />`
          : `<span class="session__avatar" style="display:grid;place-items:center;font-size:.7rem;font-weight:700">${escapeHtml(
              initials(user.displayName),
            )}</span>`
      }
      <span class="session__meta">
        <b>${escapeHtml(user.displayName)}</b>
        <span>${
          user.isPlayer
            ? `${escapeHtml(user.position)}${user.isAdmin ? ' · Administrador' : ''}`
            : 'Administrador'
        }</span>
      </span>
    </button>
  `;
  $('#open-account').addEventListener('click', openAccount);
}

function openLogin(onDone, initialTab = 'login') {
  const auth = createAuthForm({
    positions: state.positions,
    onDone: (user) => {
      state.user = user;
      paintSession();
      onDone?.(user);
    },
  });
  // Permite abrir el diálogo directamente en «Registrarme» (botón de la portada).
  if (initialTab === 'register') auth.showTab('register');

  openModal({
    title: 'Acceso a ATLAS',
    body: auth.el,
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      {
        label: 'Entrar',
        variant: 'primary',
        keepOpen: false,
        onClick: async ({ close }) => {
          const user = await auth.submit();
          if (!user) return false;
          close();
          return true;
        },
      },
    ],
    onMount: ({ veil }) => {
      veil.querySelector('input')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        veil.querySelector('.btn--primary')?.click();
      });
    },
  });
}

function openAccount() {
  const user = state.user;
  if (!user) return;

  const photoBox = html(`
    <div style="display:flex;align-items:center;gap:1rem">
      ${
        user.photo
          ? `<img class="session__avatar" style="width:72px;height:72px" src="${escapeHtml(user.photo)}" alt="" />`
          : `<span class="session__avatar" style="width:72px;height:72px;display:grid;place-items:center;font-size:1.2rem">${escapeHtml(
              initials(user.displayName),
            )}</span>`
      }
      <div style="display:flex;flex-direction:column;gap:.4rem">
        <button class="btn btn--sm" id="ac-photo">Cambiar mi foto</button>
        ${user.photo ? '<button class="btn btn--sm btn--danger" id="ac-photo-clear">Quitar foto</button>' : ''}
      </div>
    </div>
  `);

  const body = html(`
    <div style="display:flex;flex-direction:column;gap:1.2rem">
      <div id="ac-photo-host"></div>
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1">
          <label for="ac-name">Nombre en la carta</label>
          <input class="input" id="ac-name" value="${escapeHtml(user.displayName)}" maxlength="40" />
        </div>
        <div class="field">
          <label>ID de acceso</label>
          <input class="input" value="${escapeHtml(user.username)}" disabled />
        </div>
        <div class="field">
          <label>Dorsal</label>
          <input class="input" value="${escapeHtml(user.number)}" disabled />
        </div>
      </div>
      <div class="form-grid" style="border-top:1px solid var(--line);padding-top:1rem">
        <div class="field">
          <label for="ac-old">Contraseña actual</label>
          <input class="input" id="ac-old" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label for="ac-new">Nueva contraseña</label>
          <input class="input" id="ac-new" type="password" autocomplete="new-password" />
        </div>
      </div>
      <p class="login-hint">
        Dorsal, posición e ID los gestiona el administrador. Si algo no cuadra, avísale.
      </p>
    </div>
  `);

  body.querySelector('#ac-photo-host').append(photoBox);

  $('#ac-photo', photoBox).addEventListener('click', async () => {
    try {
      const dataUrl = await pickPhoto();
      if (!dataUrl) return;
      const { user: updated } = await api.updateMe({ photo: dataUrl });
      state.user = updated;
      paintSession();
      toast('Foto actualizada');
      handle.close();
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#ac-photo-clear', photoBox)?.addEventListener('click', async () => {
    try {
      const { user: updated } = await api.updateMe({ photo: null });
      state.user = updated;
      paintSession();
      toast('Foto quitada');
      handle.close();
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const handle = openModal({
    title: 'Mi cuenta',
    body,
    actions: [
      {
        label: 'Cerrar sesión',
        variant: 'danger',
        keepOpen: true,
        onClick: async () => {
          await api.logout();
          state.user = null;
          paintSession();
          handle.close();
          toast('Sesión cerrada');
          reload();
        },
      },
      {
        label: 'Guardar',
        variant: 'primary',
        onClick: async ({ close }) => {
          const displayName = $('#ac-name', body).value.trim();
          const oldPass = $('#ac-old', body).value;
          const newPass = $('#ac-new', body).value;
          try {
            if (displayName && displayName !== user.displayName) {
              const { user: updated } = await api.updateMe({ displayName });
              state.user = updated;
            }
            if (newPass) {
              await api.changePassword(oldPass, newPass);
              toast('Contraseña cambiada');
            } else {
              toast('Datos guardados');
            }
            paintSession();
            close();
            reload();
          } catch (error) {
            toast(error.message, 'error');
            return false;
          }
          return true;
        },
      },
    ],
  });

}

/* ------------------------------------------------------------ Router */

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  const name = hash || 'inicio';
  return ROUTES[name] ? name : 'inicio';
}

async function render() {
  const name = currentRoute();
  const route = ROUTES[name];

  document.title = `ATLAS · ${route.title} — FC27 Clubes Pro`;
  document.querySelectorAll('#nav a').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.view === name);
  });

  $('#view').innerHTML = '<p class="loader">Cargando…</p>';
  try {
    await route.render(ctx);
  } catch (error) {
    if (error.status === 401) {
      // Se avisa antes de abrir el acceso, para que no parezca que la web
      // «expulsa» sin más: casi siempre es que la sesión ha caducado.
      toast('Tu sesión ha caducado. Vuelve a entrar.', 'error');
      $('#view').innerHTML = '<p class="loader">Sesión caducada. Vuelve a entrar.</p>';
      state.user = null;
      paintSession();
      openLogin(() => reload());
      return;
    }
    console.error(error);
    $('#view').innerHTML = `<p class="empty-state"><b>Algo ha fallado</b>${escapeHtml(error.message)}</p>`;
  }
  paintFooter();
}

function paintFooter() {
  const tagline = state.club?.tagline;
  if (tagline) $('#footer-tagline').textContent = tagline;
  $('#footer-updated').textContent = `Hoy es ${todayISO()}`;
  const admins = state.user?.isAdmin ? 'Sesión de administrador' : state.user ? `Sesión: ${state.user.username}` : 'Visita pública';
  $('#footer-admin').textContent = admins;
}

function reload() {
  return render();
}

/* ------------------------------------------------------------ Arranque */

async function boot() {
  paintSession();
  try {
    const { user } = await api.me();
    state.user = user;
  } catch {
    state.user = null;
  }
  paintSession();

  // Posiciones y datos del club: los necesita el formulario de registro.
  try {
    const { positions, club } = await api.roster();
    state.positions = positions || [];
    state.club = club || {};
  } catch {
    /* el registro usará la lista por defecto */
  }

  window.addEventListener('hashchange', render);

  // Si cualquier llamada se queda sin sesión (por ejemplo al subir una foto),
  // se avisa y se pide entrar de nuevo en lugar de dejar la pantalla a medias.
  window.addEventListener('atlas:unauthorized', () => {
    if (!state.user) return;
    state.user = null;
    paintSession();
    toast('Tu sesión ha caducado. Vuelve a entrar.', 'error');
    openLogin(() => reload());
  });

  await render();
}

boot();