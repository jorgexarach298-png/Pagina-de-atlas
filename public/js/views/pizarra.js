'use strict';

import { api } from '../api.js';
import {
  $, escapeHtml, html, initials, toast, confirmAction, pickPhoto, openModal, todayISO, hashParam,
} from '../utils.js';

const BENCH_ORDER = ['POR', 'DFC', 'LI', 'LD', 'MC', 'DC'];

/** Zona donde cae una ayuda al subirla: al no tener posición, va al centro. */
const GUEST_ZONE = 'MC';

/** Etiqueta y tono de cada estado de convocatoria. */
const STATUS_LABEL = {
  yes: { label: 'Estará', tone: 'yes' },
  no: { label: 'No puede', tone: 'no' },
  late: { label: 'Llega tarde', tone: 'late' },
  maybe: { label: 'Duda', tone: 'maybe' },
};

/**
 * Formación 4-3-3 en campo VERTICAL.
 * `y` = 0 es la portería rival (arriba) y `y` = 1 la nuestra (abajo).
 */
const FORMATION_433 = [
  { position: 'POR', x: 0.5, y: 0.93 },
  { position: 'DFC', x: 0.17, y: 0.74 },
  { position: 'DFC', x: 0.39, y: 0.77 },
  { position: 'DFC', x: 0.61, y: 0.77 },
  { position: 'DFC', x: 0.83, y: 0.74 },
  { position: 'MC', x: 0.27, y: 0.47 },
  { position: 'MC', x: 0.5, y: 0.43 },
  { position: 'MC', x: 0.73, y: 0.47 },
  { position: 'DC', x: 0.24, y: 0.21 },
  { position: 'DC', x: 0.5, y: 0.17 },
  { position: 'DC', x: 0.76, y: 0.21 },
];

/** Zona natural de cada posición: dónde cae un jugador al pulsar «Añadir». */
const ZONE = {
  POR: { x: 0.5, y: 0.92 },
  DFC: { x: 0.5, y: 0.74 },
  LI: { x: 0.17, y: 0.6 },
  LD: { x: 0.83, y: 0.6 },
  MC: { x: 0.5, y: 0.45 },
  DC: { x: 0.5, y: 0.2 },
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * El campo pasó de horizontal a vertical. Las alineaciones guardadas antes
 * traen `x` en el eje largo, así que se intercambian los ejes.
 */
function migrateSlot(item) {
  const x = clamp01(item.x);
  const y = clamp01(item.y);
  if (item.vertical) return { x, y };
  return { x: y, y: 1 - x };
}

/**
 * Vista Pizarra táctica, en vertical.
 *
 * Las fichas se colocan de tres maneras, para que funcione igual con ratón y
 * con el dedo: arrastrando desde la plantilla, pulsando «Añadir», o
 * seleccionando la carta y tocando el césped.
 */
export async function renderPizarra(ctx) {
  let date = hashParam('date', todayISO());

  const load = async () => {
    const [data] = await Promise.all([api.lineup(date), api.roster()]);
    const players = data.roster || [];
    const positions = data.positions || [];
    ctx.state.positions = positions;

    const isAdmin = Boolean(ctx.state.user?.isAdmin);
    const statuses = data.statuses || {};
    const canSeeStatus = ctx.state.user != null;
    // El mánager abre la jornada publicando el once; hasta entonces no hay notas.
    const match = data.match || { published: false };

    // Ayudas y pruebas: fichas de gente de fuera. Al mánager le llega su lista
    // completa para gestionarlas; al resto, solo las que están en el once que
    // ve, para poder pintar el campo.
    let guests = data.guests || [];

    if (!players.length) {
      ctx.outlet.innerHTML =
        '<p class="empty-state"><b>Sin jugadores</b>Añade miembros a la plantilla para colocarlos en el campo.</p>';
      return;
    }

    /**
     * Las ayudas no son de la plantilla, pero ocupan una ficha igual: donde se
     * resuelve un id del campo hay que mirar en las dos listas.
     */
    const personById = (id) => players.find((p) => p.id === id) || guests.find((g) => g.id === id) || null;
    const isGuest = (id) => guests.some((g) => g.id === id);

    const slots = new Map();
    // Quien no es mánager ve el once publicado; el mánager trabaja sobre su
    // borrador, que puede tener cambios todavía sin publicar.
    const sourceItems = !isAdmin && match.published ? match.items : data.lineup.items;
    for (const item of sourceItems || []) {
      if (personById(item.playerId)) slots.set(item.playerId, migrateSlot(item));
    }

    // Notas que este jugador ya puso ese día (voto propio, no se enseña al resto).
    const myScores = { ...(match.myScores || {}) };

    const toneOf = (playerId) => (isGuest(playerId) ? 'guest' : STATUS_LABEL[statuses[playerId]]?.tone || 'pending');
    const labelOf = (playerId) =>
      isGuest(playerId) ? 'Ayuda de fuera' : STATUS_LABEL[statuses[playerId]]?.label || 'Sin responder';

    ctx.outlet.innerHTML = `
      <section class="section" style="margin-top:0">
        <div class="section__head">
          <h1 class="section__title"><small>Táctica</small>Pizarra ATLAS</h1>
          <div class="head-tools">
            <div class="field">
              <label for="pv-date">Convocatoria</label>
              <input class="input" type="date" id="pv-date" value="${escapeHtml(date)}" />
            </div>
          </div>
        </div>

        <p class="section__hint" style="margin-bottom:1rem">
          ${
            isAdmin
              ? 'Arrastra una carta al campo, o púlsala y luego toca el césped. El color de cada ficha es su respuesta al check-in.'
              : 'Alineación guardada por el cuerpo técnico. El color de cada ficha es la respuesta al check-in.'
          }
        </p>

        <div class="board-legend" id="board-legend"></div>

        <div class="board-layout">
          <div class="board-shell">
            <div class="board" id="board">
              <span class="board__mark board__half"></span>
              <span class="board__mark board__circle"></span>
              <span class="board__mark board__box board__box--bottom"></span>
              <span class="board__mark board__box board__box--top"></span>
              <span class="board__mark board__goal board__goal--bottom"></span>
              <span class="board__mark board__goal board__goal--top"></span>
            </div>
            ${
              isAdmin
                ? `<div class="board-actions" style="margin-top:.9rem">
                     <button class="btn btn--primary" id="save-board">Guardar borrador</button>
                     <button class="btn btn--ghost" id="auto-board">Colocar 4-3-3</button>
                     <button class="btn btn--ghost" id="clear-board">Vaciar campo</button>
                   </div>
                   <div class="board-actions" style="margin-top:.6rem">
                     <button class="btn btn--primary" id="publish-board"></button>
                   </div>`
                : ''
            }
            <p class="board-meta" id="board-meta" style="margin-top:.7rem"></p>
          </div>

          <aside class="board-tools">
            <div class="panel">
              <h3 class="panel__title">Plantilla</h3>
              ${
                canSeeStatus
                  ? '<p class="login-hint" style="margin:0 0 .6rem">El color indica su check-in del día.</p>'
                  : ''
              }
              <div class="bench" id="bench"></div>
            </div>

            ${
              isAdmin
                ? `<div class="panel">
                     <h3 class="panel__title">Ayudas y pruebas</h3>
                     <p class="login-hint" style="margin:0 0 .6rem">
                       Gente de fuera que completa el once. No son de la plantilla: no salen en las
                       cartas, no firman check-in y no reciben notas.
                     </p>
                     <div class="guest-add">
                       <input class="input" id="guest-name" placeholder="Nombre de la ayuda" maxlength="40" />
                       <button class="btn btn--primary btn--sm" id="guest-add">＋ Añadir</button>
                     </div>
                     <div class="guest-list" id="guest-list"></div>
                   </div>`
                : ''
            }

            <div class="panel" id="rating-panel">
              <h3 class="panel__title">Notas del día</h3>
              <div class="rating-panel" id="rating-host"></div>
            </div>

            <div class="panel">
              <h3 class="panel__title">Cómo funciona</h3>
              <p class="login-hint">
                ${
                  isAdmin
                    ? 'Coloca el once y pulsa <strong>Publicar once del día</strong>. A partir de ahí, cada jugador que haya entrado podrá puntuar a sus compañeros.'
                    : 'Cada ficha lleva el nombre y el dorsal, así que la táctica se entiende de un vistazo.'
                }
              </p>
            </div>
          </aside>
        </div>
      </section>
    `;

    const board = $('#board', ctx.outlet);
    const bench = $('#bench', ctx.outlet);
    const legendHost = $('#board-legend', ctx.outlet);

    let dirty = false;
    let selectedId = null;

    const setMeta = (text) => {
      const meta = $('#board-meta', ctx.outlet);
      if (meta) meta.textContent = text;
    };
    const markDirty = () => {
      dirty = true;
      setMeta('● Cambios sin guardar');
    };

    const primaryPosition = (player) => {
      const position = positions.find((p) => p.key === player.position);
      return position ? position.label : player.position;
    };

    const sortedPlayers = [...players].sort((a, b) => {
      const order = BENCH_ORDER.indexOf(a.position) - BENCH_ORDER.indexOf(b.position);
      if (order !== 0) return order;
      return (parseInt(a.number, 10) || 99) - (parseInt(b.number, 10) || 99);
    });

    /** Separa fichas amontonadas para que ninguna quede oculta bajo otra. */
    const freeSpot = (base) => {
      let spot = { ...base };
      let step = 0;
      while (
        [...slots.values()].some((s) => Math.hypot(s.x - spot.x, s.y - spot.y) < 0.075) &&
        step < 40
      ) {
        spot = {
          x: clamp01(base.x + Math.cos(step) * 0.06),
          y: clamp01(base.y + Math.sin(step) * 0.06),
        };
        step += 1;
      }
      return spot;
    };

    const renderLegend = () => {
      if (!canSeeStatus) {
        legendHost.innerHTML =
          '<span class="board-legend__item status-chip status-chip--pending">Entra con tu cuenta para ver la convocatoria</span>';
        return;
      }
      const total = players.length;
      const answered = Object.keys(statuses).length;
      legendHost.innerHTML = Object.entries(STATUS_LABEL)
        .map(
          ([key, meta]) => `
          <span class="board-legend__item status-chip status-chip--${key}">
            ${meta.label} <b>${Object.values(statuses).filter((s) => s === key).length}</b>
          </span>
        `,
        )
        .join('')
        .concat(
          `<span class="board-legend__item status-chip status-chip--pending">Sin responder <b>${Math.max(
            0,
            total - answered,
          )}</b></span>`,
        );
    };

    const renderBench = () => {
      bench.classList.toggle('is-editable', isAdmin);
      bench.innerHTML = sortedPlayers
        .map((player) => {
          const placed = slots.has(player.id);
          return `
          <div class="bench__item bench__item--${toneOf(player.id)} ${
            placed ? 'is-placed' : ''
          } ${selectedId === player.id ? 'is-selected' : ''}" data-bench="${escapeHtml(player.id)}">
            <span class="bench__avatar">
              ${
                player.photo
                  ? `<img src="${escapeHtml(player.photo)}" alt="" draggable="false" />`
                  : `<span>${escapeHtml(initials(player.displayName))}</span>`
              }
            </span>
            <span class="bench__num">${escapeHtml(player.number)}</span>
            <span class="bench__body">
              <span class="bench__name">${escapeHtml(player.displayName)}</span>
              <span class="bench__pos">${escapeHtml(player.position)}${
                canSeeStatus ? ` · ${escapeHtml(labelOf(player.id))}` : ''
              }</span>
            </span>
            ${
              isAdmin
                ? `<span class="bench__grip" title="Arrastra desde aquí para subir al campo" aria-hidden="true">⠿</span>`
                : ''
            }
            ${
              isAdmin
                ? placed
                  ? `<button class="btn btn--sm btn--ghost" data-remove="${escapeHtml(
                      player.id,
                    )}" title="Bajar al banquillo">Bajar</button>`
                  : `<button class="btn btn--sm btn--ghost" data-add="${escapeHtml(
                      player.id,
                    )}" title="Subir al campo">Añadir</button>`
                : ''
            }
          </div>
        `;
        })
        .join('');

      if (!isAdmin) return;

      bench.querySelectorAll('[data-add]').forEach((button) => {
        button.addEventListener('click', () => {
          const player = players.find((p) => p.id === button.dataset.add);
          if (!player) return;
          slots.set(player.id, freeSpot(ZONE[player.position] || ZONE.MC));
          selectedId = null;
          renderAll();
          markDirty();
        });
      });

      bench.querySelectorAll('[data-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          slots.delete(button.dataset.remove);
          if (selectedId === button.dataset.remove) selectedId = null;
          renderAll();
          markDirty();
        });
      });

      bench.querySelectorAll('[data-bench]').forEach((item) => {
        item.addEventListener('pointerdown', (event) => {
          if (event.target.closest('button')) return;
          // Con el dedo, el asa (avatar y dorsal) arrastra la carta al campo.
          // El resto de la carta queda para tocar y seleccionar, o para deslizar
          // la lista, que en el móvil no cabe entera.
          const soloTap =
            event.pointerType === 'touch' &&
            !event.target.closest('.bench__avatar, .bench__num, .bench__grip');
          startDragFromBench(event, item, item.dataset.bench, { soloTap });
        });
      });

      // Con el ratón, el botón «Añadir» también sirve para arrastrar la carta al
      // campo; si no se mueve el puntero, el clic del botón la coloca igual.
      bench.querySelectorAll('[data-add]').forEach((button) => {
        button.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'touch') return;
          const item = button.closest('.bench__item');
          startDragFromBench(event, item, button.dataset.add, { desdeBoton: true });
        });
      });
    };

    /**
     * Panel de ayudas. Cada ayuda se puede subir al campo (o bajar), cambiarle
     * el nombre y ponerle foto; borrarla la quita también del campo.
     */
    const renderGuests = () => {
      const host = $('#guest-list', ctx.outlet);
      if (!host) return;

      if (!guests.length) {
        host.innerHTML = '<p class="login-hint" style="margin:0">Todavía no hay ninguna. Escribe un nombre y pulsa «Añadir».</p>';
        return;
      }

      host.innerHTML = guests
        .map((guest) => {
          const placed = slots.has(guest.id);
          return `
          <div class="guest-item ${placed ? 'is-placed' : ''}" data-guest="${escapeHtml(guest.id)}">
            <span class="guest-item__avatar">
              ${
                guest.photo
                  ? `<img src="${escapeHtml(guest.photo)}" alt="" draggable="false" />`
                  : `<span>${escapeHtml(initials(guest.displayName))}</span>`
              }
            </span>
            <span class="guest-item__body">
              <span class="guest-item__name">${escapeHtml(guest.displayName)}</span>
              <span class="guest-item__pos">${escapeHtml(labelOf(guest.id))}</span>
            </span>
            <span class="guest-item__tools">
              ${
                placed
                  ? `<button class="btn btn--sm btn--ghost" data-guest-remove="${escapeHtml(
                      guest.id,
                    )}" title="Bajar al banquillo">Bajar</button>`
                  : `<button class="btn btn--sm btn--ghost" data-guest-add="${escapeHtml(
                      guest.id,
                    )}" title="Subir al campo">Añadir</button>`
              }
              <button class="btn btn--sm btn--ghost" data-guest-photo="${escapeHtml(
                guest.id,
              )}" title="Poner foto">Foto</button>
              <button class="btn btn--sm btn--ghost" data-guest-edit="${escapeHtml(
                guest.id,
              )}" title="Cambiar el nombre">✎</button>
            </span>
          </div>
        `;
        })
        .join('');

      host.querySelectorAll('[data-guest-add]').forEach((button) => {
        button.addEventListener('click', () => {
          const guest = guests.find((g) => g.id === button.dataset.guestAdd);
          if (!guest) return;
          slots.set(guest.id, freeSpot(ZONE[GUEST_ZONE]));
          selectedId = null;
          renderAll();
          markDirty();
        });
      });

      host.querySelectorAll('[data-guest-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          slots.delete(button.dataset.guestRemove);
          if (selectedId === button.dataset.guestRemove) selectedId = null;
          renderAll();
          markDirty();
        });
      });

      host.querySelectorAll('[data-guest-photo]').forEach((button) => {
        button.addEventListener('click', () => uploadGuestPhoto(button.dataset.guestPhoto));
      });

      host.querySelectorAll('[data-guest-edit]').forEach((button) => {
        button.addEventListener('click', () => editGuest(button.dataset.guestEdit));
      });

      // Arrastrar una ayuda al campo, igual que una carta de la plantilla.
      host.querySelectorAll('[data-guest]').forEach((item) => {
        item.addEventListener('pointerdown', (event) => {
          if (event.target.closest('button')) return;
          startDragFromBench(event, item, item.dataset.guest, {
            soloTap: event.pointerType === 'touch' && !event.target.closest('.guest-item__avatar'),
          });
        });
      });
    };

    /** Añade una ayuda por nombre. Si ya existía, la reutiliza. */
    const addGuest = async () => {
      const input = $('#guest-name', ctx.outlet);
      const name = input?.value.trim();
      if (!name) {
        toast('Escribe el nombre de la ayuda', 'error');
        return;
      }
      try {
        const { guest } = await api.createGuest(name);
        const known = guests.some((g) => g.id === guest.id);
        // Se toca solo la lista de ayudas: recargar la pizarra entera tiraría
        // las cartas que el mánager ya haya colocado sin guardar.
        if (!known) guests = [...guests, guest];
        input.value = '';
        renderGuests();
        toast(known ? `«${guest.displayName}» ya estaba en la lista` : `Ayuda «${guest.displayName}» añadida`);
      } catch (error) {
        toast(error.message, 'error');
      }
    };

    /** Sube la foto de una ayuda y refresca su ficha, sin tocar el campo. */
    async function uploadGuestPhoto(guestId) {
      try {
        const dataUrl = await pickPhoto();
        if (!dataUrl) return;
        const { guest } = await api.updateGuest(guestId, { photo: dataUrl });
        guests = guests.map((g) => (g.id === guestId ? { ...g, photo: guest.photo } : g));
        renderGuests();
        renderTokens();
        toast('Foto de la ayuda actualizada');
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    function editGuest(guestId) {
      const guest = guests.find((g) => g.id === guestId);
      if (!guest) return;

      const form = html(`
        <div class="field">
          <label for="eg-name">Nombre de la ayuda</label>
          <input class="input" id="eg-name" value="${escapeHtml(guest.displayName)}" maxlength="40" />
          <p class="login-hint">Cambiar el nombre conserva su ficha en el campo y lo ya anotado.</p>
        </div>
      `);

      openModal({
        title: `Ayuda: ${guest.displayName}`,
        body: form,
        actions: [
          { label: 'Cancelar', variant: 'ghost' },
          {
            label: 'Eliminar',
            variant: 'danger',
            onClick: async ({ close }) => {
              if (
                !(await confirmAction(
                  `¿Borrar la ayuda «${guest.displayName}»? Se quitará del campo y de las alineaciones guardadas.`,
                ))
              ) {
                return false;
              }
              try {
                await api.deleteGuest(guest.id);
                guests = guests.filter((g) => g.id !== guest.id);
                slots.delete(guest.id);
                if (selectedId === guest.id) selectedId = null;
                close();
                renderAll();
                toast('Ayuda eliminada');
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
              try {
                const { guest: saved } = await api.updateGuest(guest.id, {
                  name: $('#eg-name', form).value,
                });
                guests = guests.map((g) => (g.id === guest.id ? { ...g, ...saved } : g));
                close();
                renderAll();
                toast('Ayuda actualizada');
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

    const renderTokens = () => {
      board.querySelectorAll('.token').forEach((token) => token.remove());
      for (const [playerId, slot] of slots) {
        const player = personById(playerId);
        if (!player) continue;

        const guest = isGuest(playerId);
        const token = document.createElement('button');
        token.type = 'button';
        token.className = `token token--${toneOf(playerId)} ${guest ? 'token--guest' : ''} ${
          selectedId === playerId ? 'is-selected' : ''
        }`;
        token.dataset.player = playerId;
        token.style.left = `${slot.x * 100}%`;
        token.style.top = `${slot.y * 100}%`;
        token.title = guest
          ? `${player.displayName} · Ayuda de fuera`
          : `${player.displayName} · ${primaryPosition(player)} · ${labelOf(playerId)}`;
        token.innerHTML = `
          <span class="token__avatar">
            ${
              player.photo
                ? `<img src="${escapeHtml(player.photo)}" alt="" draggable="false" />`
                : `<span>${escapeHtml(initials(player.displayName))}</span>`
            }
            ${guest ? '<span class="token__tag">AYUDA</span>' : `<span class="token__num">${escapeHtml(player.number)}</span>`}
          </span>
          <span class="token__name">${escapeHtml(player.displayName)}</span>
        `;
        if (isAdmin) {
          token.addEventListener('pointerdown', (event) => startDragToken(event, token, playerId));
        }
        board.append(token);
      }
      board.classList.toggle('is-picking', Boolean(selectedId));
    };

    const renderAll = () => {
      renderTokens();
      renderBench();
      renderGuests();
      renderLegend();
      renderRatings();
    };

    /* ------------------------------------------------------- Notas del día */

    /**
     * Panel de notas. Solo aparece cuando el mánager ha publicado el once del
     * día: entonces quien haya jugado puntúa a sus compañeros del 1 al 11, sin
     * repetir ninguna nota en la misma papeleta.
     */
    const renderRatings = () => {
      const host = $('#rating-host', ctx.outlet);
      const panel = $('#rating-panel', ctx.outlet);
      if (!host || !panel) return;

      if (!match.published) {
        panel.hidden = !isAdmin;
        host.innerHTML = `<p class="rating-panel__state rating-panel__state--locked">
            Todavía no has publicado el once de este día. Al publicarlo se habilitan las notas.
          </p>`;
        return;
      }

      panel.hidden = false;
      const playingIds = match.playerIds || [];

      if (isAdmin) {
        renderMatchStats(host, playingIds);
        return;
      }

      if (!ctx.state.user) {
        host.innerHTML = `<p class="rating-panel__state rating-panel__state--locked">
            Entra con tu cuenta para puntuar. Solo puntúan los jugadores que entraron en el once.
          </p>`;
        return;
      }

      if (!match.canVote) {
        host.innerHTML = `<p class="rating-panel__state rating-panel__state--locked">
            ${
              isAdmin
                ? 'Vista de mánager: aquí ves quién ha votado ya, pero las notas las ponen los jugadores.'
                : 'Este día no entraste en el once, así que no puntúas. Puedes ver la alineación.'
            }
            <br />Papeletas recibidas: <strong>${match.ballots || 0}</strong>
          </p>`;
        return;
      }

      const rivals = playingIds
        .filter((id) => id !== ctx.state.user.id)
        .map((id) => players.find((p) => p.id === id))
        .filter(Boolean);

      const usedNotes = new Map();
      for (const [targetId, value] of Object.entries(myScores)) usedNotes.set(Number(value), targetId);

      host.innerHTML = `
        <p class="rating-panel__state rating-panel__state--open">
          Puntúa del <strong>1</strong> al <strong>11</strong>. No puedes repetir una nota ni puntuarte a ti mismo.
        </p>
        <div class="rating-list">
          ${rivals.map((player) => renderRatingRow(player, usedNotes)).join('')}
        </div>
        <div class="rating-panel__foot">
          <button class="btn btn--primary btn--sm" id="save-ratings">Guardar notas</button>
          <span class="login-hint" id="rating-progress">${Object.keys(myScores).length}/${rivals.length} puestos</span>
        </div>
      `;

      host.querySelectorAll('[data-note]').forEach((button) => {
        button.addEventListener('click', () => {
          const targetId = button.dataset.target;
          const note = Number(button.dataset.note);
          // La nota ya asignada a otro: primero hay que quitarla de allí.
          const owner = [...usedNotes.entries()].find(([, id]) => id === targetId);
          if (owner && owner[0] !== note) usedNotes.delete(owner[0]);
          if (myScores[targetId] === note) {
            delete myScores[targetId];
          } else {
            myScores[targetId] = note;
            usedNotes.set(note, targetId);
          }
          renderRatings();
        });
      });

      $('#save-ratings', host).addEventListener('click', async () => {
        try {
          const { match: updated } = await api.saveRatings(date, myScores);
          Object.assign(match, updated);
          toast('Notas guardadas');
          renderRatings();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    };

    /**
     * Vista de mánager: goles y asistencias de cada jugador del once. Son los
     * datos que alimentan las estadísticas de las cartas de la Plantilla.
     */
    function renderMatchStats(host, playingIds) {
      const rows = playingIds
        .map((id) => players.find((p) => p.id === id))
        .filter(Boolean);

      host.innerHTML = `
        <p class="rating-panel__state rating-panel__state--open">
          Anota goles y asistencias del partido. Las notas las ponen los jugadores desde su cuenta.
          <br />Papeletas recibidas: <strong>${match.ballots || 0}</strong>/${rows.length}
        </p>
        <div class="rating-list">
          ${rows
            .map((player) => {
              const line = (match.stats || {})[player.id] || { goals: 0, assists: 0 };
              const avg = (match.averages || {})[player.id]?.average;
              return `
              <div class="stat-row" data-stat-row="${escapeHtml(player.id)}">
                <span class="rating-row__who">
                  <span class="rating-row__num">${escapeHtml(player.number)}</span>
                  <span class="rating-row__name">${escapeHtml(player.displayName)}</span>
                </span>
                <span class="stat-row__fields">
                  <label>G <input class="input input--tiny" type="number" min="0" max="99"
                     data-goals value="${line.goals || 0}" /></label>
                  <label>A <input class="input input--tiny" type="number" min="0" max="99"
                     data-assists value="${line.assists || 0}" /></label>
                  <span class="rating-row__avg">${
                    avg !== undefined ? Number(avg).toFixed(1) : '—'
                  }</span>
                </span>
              </div>
            `;
            })
            .join('')}
        </div>
        <div class="rating-panel__foot">
          <label class="clean-sheet-toggle">
            <input type="checkbox" id="clean-sheet" ${match.cleanSheet ? 'checked' : ''} />
            Portería a cero (solo suma a porteros y centrales)
          </label>
          <button class="btn btn--primary btn--sm" id="save-stats">Guardar estadísticas</button>
        </div>
      `;

      $('#save-stats', host).addEventListener('click', async () => {
        try {
          const rowsToSave = [...host.querySelectorAll('[data-stat-row]')];
          for (const row of rowsToSave) {
            await api.setMatchStats(date, row.dataset.statRow, {
              goals: $('[data-goals]', row).value,
              assists: $('[data-assists]', row).value,
            });
          }
          await api.setCleanSheet(date, $('#clean-sheet', host).checked);
          toast('Estadísticas guardadas');
          await load();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    /** Una fila: el compañero a la izquierda y las notas 1-11 a la derecha. */
    function renderRatingRow(player, usedNotes) {
      const mine = myScores[player.id];
      const takenByOthers = (note) => usedNotes.has(note) && usedNotes.get(note) !== player.id;
      const avg = (match.averages || {})[player.id]?.average;
      return `
        <div class="rating-row ${player.id === ctx.state.user.id ? 'rating-row--mine' : ''}">
          <span class="rating-row__who">
            <span class="rating-row__num">${escapeHtml(player.number)}</span>
            <span class="rating-row__name">${escapeHtml(player.displayName)}</span>
          </span>
          ${
            avg !== undefined
              ? `<span class="rating-row__avg" title="Nota media de los compañeros">${Number(avg).toFixed(1)}</span>`
              : ''
          }
          <div class="note-grid" style="grid-column:1/-1">
            ${Array.from({ length: 11 }, (_, i) => i + 1)
              .map(
                (note) => `
              <button type="button" class="note-btn ${mine === note ? 'is-on' : ''}"
                      data-note="${note}" data-target="${escapeHtml(player.id)}"
                      ${takenByOthers(note) ? 'disabled' : ''}
                      title="${
                        takenByOthers(note)
                          ? `El ${note} ya está puesto a otro compañero`
                          : `Poner un ${note}`
                      }">${note}</button>
            `,
              )
              .join('')}
          </div>
        </div>
      `;
    }

    /* ------------------------------------------------------- Arrastre */

    const pointerToSlot = (event) => {
      const rect = board.getBoundingClientRect();
      return {
        x: clamp01((event.clientX - rect.left) / rect.width),
        y: clamp01((event.clientY - rect.top) / rect.height),
      };
    };

    const isOutside = (event) => {
      const rect = board.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    /**
     * Arrastre desde la plantilla. Si el navegador cancela el gesto (por ejemplo
     * al hacer scroll en el móvil) o el dedo no se mueve, la carta queda
     * seleccionada para colocarla tocando el campo: así nunca se pierde.
     *
     * Con el ratón hay que llamar a `preventDefault()` para que el navegador no
     * seleccione el texto de la interfaz mientras se arrastra. Con el dedo, en
     * cambio, no se llama: bloquearlo impediría desplazar el banquillo, que en
     * el móvil es más alto que su caja.
     *
     * `soloTap` se usa al tocar la carta fuera del asa: un toque sin movimiento
     * la selecciona, y un deslizamiento se deja al navegador para que desplace
     * la lista en vez de arrastrar la carta sin querer.
     *
     * `desdeBoton` es para el botón «Añadir»: si el puntero no se mueve, no se
     * toca la selección y deja que el clic del botón coloque la carta.
     */
    function startDragFromBench(event, item, playerId, { soloTap = false, desdeBoton = false } = {}) {
      // Arrastrar una carta no debe arrastrar también el texto seleccionado.
      window.getSelection()?.removeAllRanges();
      if (event.pointerType !== 'touch') event.preventDefault();
      if (!desdeBoton) item.classList.add('is-dragging');

      const start = { x: event.clientX, y: event.clientY };
      let ghost = null;
      let moved = false;

      const move = (moveEvent) => {
        if (!isAdmin) return;
        if (!moved) {
          if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 6) return;
          moved = true;
          if (soloTap) return;
          ghost = document.createElement('div');
          ghost.className = 'token-ghost';
          const player = personById(playerId);
          ghost.textContent = player ? (isGuest(playerId) ? '★' : player.number) : '';
          board.append(ghost);
        }
        if (soloTap) return;
        const slot = pointerToSlot(moveEvent);
        ghost.style.left = `${slot.x * 100}%`;
        ghost.style.top = `${slot.y * 100}%`;
      };

      const detach = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
        item.classList.remove('is-dragging');
        ghost?.remove();
      };

      const up = (upEvent) => {
        detach();
        if (!isAdmin) {
          // Quien solo mira no puede colocar: sus toques no cambian nada.
          window.getSelection()?.removeAllRanges();
          return;
        }
        // Deslizamiento sobre la carta fuera del asa: era scroll de la lista.
        if (soloTap && moved) return;
        // Sin movimiento desde el botón: ya lo coloca su propio clic.
        if (desdeBoton && !moved) return;
        if (moved && !isOutside(upEvent)) {
          slots.set(playerId, pointerToSlot(upEvent));
          selectedId = null;
          renderAll();
          markDirty();
          return;
        }
        if (!moved) {
          selectedId = selectedId === playerId ? null : playerId;
          renderAll();
        }
      };

      const cancel = () => {
        detach();
        if (!isAdmin || soloTap) return;
        selectedId = playerId;
        renderAll();
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
    }

    /** Arrastre de una ficha ya colocada en el campo. */
    function startDragToken(event, token, playerId) {
      if (!isAdmin) return;
      event.preventDefault();
      token.setPointerCapture?.(event.pointerId);
      token.classList.add('is-dragging');

      let moved = false;

      const move = (moveEvent) => {
        moved = true;
        slots.set(playerId, pointerToSlot(moveEvent));
        markDirty();
        const slot = slots.get(playerId);
        token.style.left = `${slot.x * 100}%`;
        token.style.top = `${slot.y * 100}%`;
      };

      const detach = () => {
        token.classList.remove('is-dragging');
        token.removeEventListener('pointermove', move);
        token.removeEventListener('pointerup', up);
        token.removeEventListener('pointercancel', cancel);
      };

      const up = (upEvent) => {
        detach();
        if (!moved) {
          selectedId = selectedId === playerId ? null : playerId;
          renderAll();
          return;
        }
        if (isOutside(upEvent)) {
          slots.delete(playerId);
          selectedId = null;
          renderAll();
          markDirty();
          return;
        }
        renderBench();
      };

      const cancel = () => detach(); // se queda donde estaba: no se pierde

      token.addEventListener('pointermove', move);
      token.addEventListener('pointerup', up);
      token.addEventListener('pointercancel', cancel);
    }

    // Tocar el césped coloca o mueve la ficha seleccionada.
    if (isAdmin) {
      board.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.token') || !selectedId) return;
        event.preventDefault();
        slots.set(selectedId, pointerToSlot(event));
        selectedId = null;
        renderAll();
        markDirty();
      });
    }

    /* ------------------------------------------------------- Acciones */

    /** El botón de publicar cambia de texto según haya o no un once ese día. */
    function paintPublishState() {
      const button = $('#publish-board', ctx.outlet);
      if (!button) return;
      button.textContent = match.published
        ? 'Publicar de nuevo (sustituir el once)'
        : 'Publicar once del día';
    }

    if (isAdmin) {
      // Alta de ayuda: con el botón o pulsando Enter en el campo del nombre.
      $('#guest-add', ctx.outlet)?.addEventListener('click', addGuest);
      $('#guest-name', ctx.outlet)?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addGuest();
      });

      $('#save-board', ctx.outlet).addEventListener('click', async () => {
        try {
          await api.saveLineup({
            formation: '4-3-3',
            items: [...slots].map(([playerId, slot]) => ({
              playerId,
              x: slot.x,
              y: slot.y,
              vertical: true,
            })),
          });
          dirty = false;
          setMeta('Alineación guardada en el servidor.');
          toast('Alineación guardada');
        } catch (error) {
          toast(error.message, 'error');
        }
      });

      $('#auto-board', ctx.outlet).addEventListener('click', () => {
        slots.clear();
        selectedId = null;
        for (const entry of FORMATION_433) {
          const taken = new Set(slots.keys());
          const candidate = sortedPlayers.find((p) => p.position === entry.position && !taken.has(p.id));
          if (candidate) slots.set(candidate.id, { x: entry.x, y: entry.y });
        }
        renderAll();
        markDirty();
      });

      $('#clear-board', ctx.outlet).addEventListener('click', async () => {
        if (!(await confirmAction('¿Vaciar el campo? Se quitarán todas las fichas.'))) return;
        slots.clear();
        selectedId = null;
        renderAll();
        markDirty();
      });

      // Publicar es el gesto que abre la jornada de notas. Si ya había un once
      // publicado ese día, avisa de que se sustituye.
      $('#publish-board', ctx.outlet).addEventListener('click', async () => {
        if (!slots.size) {
          toast('Coloca al menos un jugador antes de publicar', 'error');
          return;
        }
        if (
          match.published
          && !(await confirmAction(
            'Ya hay un once publicado ese día. ¿Lo sustituyes por el actual? Las notas ya puestas se conservan.',
          ))
        ) {
          return;
        }
        try {
          const { match: published } = await api.publishMatch(date, {
            formation: '4-3-3',
            items: [...slots].map(([playerId, slot]) => ({
              playerId,
              x: slot.x,
              y: slot.y,
              vertical: true,
            })),
          });
          Object.assign(match, published);
          dirty = false;
          toast('Once publicado: ya se pueden poner notas');
          await load();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    $('#pv-date', ctx.outlet).addEventListener('change', (event) => {
      date = event.target.value || todayISO();
      load();
    });

    renderAll();
    paintPublishState();
    if (data.lineup.updatedAt) {
      setMeta(`Última actualización: ${new Date(data.lineup.updatedAt).toLocaleString('es-ES')}`);
    } else {
      setMeta('Todavía sin alineación guardada');
    }

    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  };

  await load();
}
