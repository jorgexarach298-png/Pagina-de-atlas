'use strict';

import { api } from '../api.js';
import {
  $, html, escapeHtml, initials, toast, openModal, confirmAction, pickPhoto,
} from '../utils.js';

/**
 * Vista Plantilla: cada miembro se muestra como una carta tipo FUT.
 * El administrador puede subir o reemplazar la foto de cualquier miembro,
 * editar sus datos, crear nuevos miembros y eliminarlos.
 */
export async function renderRoster(ctx) {
  await paint(ctx);
}

async function paint(ctx) {
  const { players, positions, club } = await api.roster();
  ctx.state.positions = positions;
  ctx.state.club = club;
  window.__ATLAS_POSITIONS__ = positions;

  const groups = groupByPosition(players, positions);
  const isAdmin = Boolean(ctx.state.user?.isAdmin);

  ctx.outlet.innerHTML = `
    <section class="section" style="margin-top:0">
      <div class="section__head">
        <h1 class="section__title">
          <small>FC 27 · Clubes Pro</small>
          Plantilla ATLAS
        </h1>
        <div class="head-tools">
          <p class="section__hint">${players.length} miembros${
            isAdmin ? ' · pulsa «Foto» en cualquier carta para subir su imagen' : ''
          }</p>
          ${isAdmin ? '<button class="btn btn--primary" id="add-player">＋ Nuevo miembro</button>' : ''}
        </div>
      </div>
      ${
        groups.length
          ? groups.map((group) => renderGroup(group, ctx)).join('')
          : '<p class="empty-state"><b>Aún no hay cartas</b>El administrador puede añadir miembros desde aquí.</p>'
      }
    </section>
  `;

  ctx.outlet.querySelectorAll('.card').forEach((card, index) => {
    card.classList.add('reveal');
    card.style.animationDelay = `${Math.min(index * 45, 700)}ms`;
  });

  ctx.outlet.querySelectorAll('[data-photo]').forEach((button) => {
    button.addEventListener('click', () => uploadPhoto(button.dataset.photo, ctx));
  });
  ctx.outlet.querySelectorAll('[data-my-photo]').forEach((button) => {
    button.addEventListener('click', () => uploadMyPhoto(ctx));
  });
  ctx.outlet.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => editPlayer(button.dataset.edit, players, ctx));
  });
  $('#add-player', ctx.outlet)?.addEventListener('click', () => createPlayer(ctx));
}

function renderGroup(group, ctx) {
  return `
    <div class="roster-group">
      <h3 class="roster-group__title"><span>${group.icon}</span> ${escapeHtml(group.group)}</h3>
      <div class="card-grid">
        ${group.players.map((player) => renderCard(player, ctx)).join('')}
      </div>
    </div>
  `;
}

function renderCard(player, ctx) {
  const isAdmin = Boolean(ctx.state.user?.isAdmin);
  const isMe = ctx.state.user?.id === player.id;
  const isCaptain = ctx.state.club?.captainId === player.id;
  const position = (ctx.state.positions || []).find((p) => p.key === player.position);
  const label = position ? position.label : player.position;

  return `
    <article class="card ${isCaptain ? 'card--captain' : ''} ${isMe ? 'card--me' : ''}" data-player="${escapeHtml(player.id)}">
      ${isCaptain ? '<span class="card__badge-captain" title="Capitán">©</span>' : ''}
      ${isMe ? '<span class="card__pill card__pill--me">Tú</span>' : ''}
      <span class="card__pill">${escapeHtml(player.position)} · ${escapeHtml(label)}</span>
      <span class="card__number">${escapeHtml(player.number)}</span>
      <div class="card__media">
        ${
          player.photo
            ? `<img class="card__photo" src="${escapeHtml(player.photo)}" alt="Foto de ${escapeHtml(
                player.displayName,
              )}" loading="lazy" />`
            : `<div class="card__photo card__photo--empty" aria-hidden="true">${escapeHtml(
                initials(player.displayName),
              )}</div>`
        }
      </div>
      <div class="card__foot">
        <h3 class="card__name" title="${escapeHtml(player.displayName)}">${escapeHtml(player.displayName)}</h3>
        <p class="card__sub"><span>ID: ${escapeHtml(player.username)}</span></p>
      </div>
      ${
        isAdmin
          ? `<div class="card__admin">
               <button class="card__upload" data-photo="${escapeHtml(player.id)}" title="Subir foto">📷 Foto</button>
               <button class="card__upload" data-edit="${escapeHtml(player.id)}" title="Editar miembro">✎</button>
             </div>`
          : isMe
            ? `<div class="card__admin">
                 <button class="card__upload" data-my-photo title="Subir mi foto">📷 Mi foto</button>
               </div>`
            : ''
      }
    </article>
  `;
}

function groupByPosition(players, positions) {
  const groups = new Map();
  for (const position of positions) {
    if (!groups.has(position.group)) {
      groups.set(position.group, { group: position.group, icon: position.icon, keys: [] });
    }
    groups.get(position.group).keys.push(position.key);
  }
  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      players: players.filter((player) => entry.keys.includes(player.position)),
    }))
    .filter((entry) => entry.players.length);
}

/* ------------------------------------------------------- Acciones admin */

async function uploadPhoto(playerId, ctx) {
  try {
    const dataUrl = await pickPhoto();
    if (!dataUrl) return;
    await api.updatePlayer(playerId, { photo: dataUrl });
    toast('Foto actualizada');
    await paint(ctx);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Cada miembro sube su propia foto desde su carta de la Plantilla. */
async function uploadMyPhoto(ctx) {
  try {
    const dataUrl = await pickPhoto();
    if (!dataUrl) return;
    const { user } = await api.updateMe({ photo: dataUrl });
    ctx.state.user = user;
    ctx.onUserChange?.(user);
    toast('Tu foto está lista');
    await paint(ctx);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function positionOptions(selected) {
  return (window.__ATLAS_POSITIONS__ || [])
    .map(
      (p) =>
        `<option value="${escapeHtml(p.key)}" ${p.key === selected ? 'selected' : ''}>${escapeHtml(
          p.icon,
        )} ${escapeHtml(p.label)}</option>`,
    )
    .join('');
}

function editPlayer(playerId, players, ctx) {
  const player = players.find((p) => p.id === playerId);
  if (!player) return;

  const form = html(`
    <div class="form-grid">
      <div class="field">
        <label for="ep-number">Dorsal</label>
        <input class="input" id="ep-number" value="${escapeHtml(player.number)}" maxlength="3" />
      </div>
      <div class="field">
        <label for="ep-position">Posición</label>
        <select class="select" id="ep-position">${positionOptions(player.position)}</select>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="ep-display">Nombre en la carta</label>
        <input class="input" id="ep-display" value="${escapeHtml(player.displayName)}" maxlength="40" />
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="ep-username">ID de acceso</label>
        <input class="input" id="ep-username" value="${escapeHtml(player.username)}" maxlength="60" />
        <p class="login-hint">Es el ID con el que el miembro inicia sesión y firma el check-in.</p>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="ep-pass">Nueva contraseña (opcional)</label>
        <input class="input" id="ep-pass" type="text" placeholder="Vacío para no cambiarla" maxlength="60" />
      </div>
    </div>
  `);

  openModal({
    title: `Editar ${player.displayName}`,
    body: form,
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      {
        label: 'Eliminar',
        variant: 'danger',
        onClick: async ({ close }) => {
          if (!(await confirmAction(`¿Eliminar a ${player.displayName} de la plantilla?`))) return false;
          try {
            await api.deletePlayer(player.id);
            toast('Miembro eliminado');
            close();
            await paint(ctx);
          } catch (error) {
            toast(error.message, 'error');
          }
          return false;
        },
      },
      {
        label: 'Guardar',
        variant: 'primary',
        onClick: async ({ close }) => {
          const patch = {
            number: $('#ep-number', form).value.trim(),
            position: $('#ep-position', form).value,
            displayName: $('#ep-display', form).value.trim(),
            username: $('#ep-username', form).value.trim(),
          };
          const newPassword = $('#ep-pass', form).value.trim();
          if (newPassword) patch.newPassword = newPassword;
          try {
            await api.updatePlayer(player.id, patch);
            toast('Datos actualizados');
            close();
            await paint(ctx);
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

function createPlayer(ctx) {
  const form = html(`
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1">
        <label for="np-username">ID de acceso</label>
        <input class="input" id="np-username" placeholder="ej. tonii_gk" maxlength="60" />
      </div>
      <div class="field">
        <label for="np-number">Dorsal</label>
        <input class="input" id="np-number" placeholder="9" maxlength="3" />
      </div>
      <div class="field">
        <label for="np-position">Posición</label>
        <select class="select" id="np-position">${positionOptions()}</select>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="np-display">Nombre en la carta</label>
        <input class="input" id="np-display" placeholder="Igual que el ID si lo dejas vacío" maxlength="40" />
      </div>
    </div>
  `);

  openModal({
    title: 'Nuevo miembro',
    body: form,
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      {
        label: 'Crear',
        variant: 'primary',
        onClick: async ({ close }) => {
          try {
            await api.createPlayer({
              username: $('#np-username', form).value.trim(),
              number: $('#np-number', form).value.trim(),
              position: $('#np-position', form).value,
              displayName: $('#np-display', form).value.trim(),
            });
            toast('Miembro añadido');
            close();
            await paint(ctx);
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
