'use strict';

import { api } from '../api.js';
import { $, escapeHtml, initials, toast, confirmAction, todayISO, hashParam } from '../utils.js';

const BENCH_ORDER = ['POR', 'DFC', 'LI', 'LD', 'MC', 'DC'];

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
    const [data, roster] = await Promise.all([api.lineup(date), api.roster()]);
    const players = roster.players;
    const positions = roster.positions || [];
    ctx.state.positions = positions;

    const isAdmin = Boolean(ctx.state.user?.isAdmin);
    const statuses = data.statuses || {};
    const canSeeStatus = ctx.state.user != null;

    if (!players.length) {
      ctx.outlet.innerHTML =
        '<p class="empty-state"><b>Sin jugadores</b>Añade miembros a la plantilla para colocarlos en el campo.</p>';
      return;
    }

    const slots = new Map();
    for (const item of data.lineup.items || []) {
      if (players.some((p) => p.id === item.playerId)) slots.set(item.playerId, migrateSlot(item));
    }

    const toneOf = (playerId) => STATUS_LABEL[statuses[playerId]]?.tone || 'pending';
    const labelOf = (playerId) => STATUS_LABEL[statuses[playerId]]?.label || 'Sin responder';

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
                     <button class="btn btn--primary" id="save-board">Guardar alineación</button>
                     <button class="btn btn--ghost" id="auto-board">Colocar 4-3-3</button>
                     <button class="btn btn--ghost" id="clear-board">Vaciar campo</button>
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
            <div class="panel">
              <h3 class="panel__title">Cómo funciona</h3>
              <p class="login-hint">
                ${
                  isAdmin
                    ? 'Pulsa <strong>Añadir</strong> para subir a alguien al campo. También puedes arrastrar la carta o seleccionarla y tocar el césped.'
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

    const renderTokens = () => {
      board.querySelectorAll('.token').forEach((token) => token.remove());
      for (const [playerId, slot] of slots) {
        const player = players.find((p) => p.id === playerId);
        if (!player) continue;

        const token = document.createElement('button');
        token.type = 'button';
        token.className = `token token--${toneOf(playerId)} ${
          selectedId === playerId ? 'is-selected' : ''
        }`;
        token.dataset.player = playerId;
        token.style.left = `${slot.x * 100}%`;
        token.style.top = `${slot.y * 100}%`;
        token.title = `${player.displayName} · ${primaryPosition(player)} · ${labelOf(playerId)}`;
        token.innerHTML = `
          <span class="token__avatar">
            ${
              player.photo
                ? `<img src="${escapeHtml(player.photo)}" alt="" draggable="false" />`
                : `<span>${escapeHtml(initials(player.displayName))}</span>`
            }
            <span class="token__num">${escapeHtml(player.number)}</span>
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
      renderLegend();
    };

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
          const player = players.find((p) => p.id === playerId);
          ghost.textContent = player ? player.number : '';
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

    if (isAdmin) {
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
    }

    $('#pv-date', ctx.outlet).addEventListener('change', (event) => {
      date = event.target.value || todayISO();
      load();
    });

    renderAll();
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
