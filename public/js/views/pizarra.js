'use strict';

import { api } from '../api.js';
import { $, escapeHtml, initials, toast, confirmAction } from '../utils.js';

const BENCH_ORDER = ['POR', 'DFC', 'LI', 'LD', 'MC', 'DC'];

/**
 * Vista Pizarra táctica: arrastra las cartas de la plantilla al campo.
 * El administrador guarda la alineación; el resto la ve en modo lectura.
 */
export async function renderPizarra(ctx) {
  const [{ lineup }, { players, positions }] = await Promise.all([api.lineup(), api.roster()]);

  if (!players.length) {
    ctx.outlet.innerHTML =
      '<p class="empty-state"><b>Sin jugadores</b>Añade miembros a la plantilla para colocarlos en el campo.</p>';
    return;
  }

  const slots = new Map();
  for (const item of lineup.items || []) {
    if (players.some((p) => p.id === item.playerId)) {
      slots.set(item.playerId, { x: item.x, y: item.y });
    }
  }

  const isAdmin = Boolean(ctx.state.user?.isAdmin);
  ctx.state.positions = positions;

  ctx.outlet.innerHTML = `
    <section class="section" style="margin-top:0">
      <div class="section__head">
        <h1 class="section__title"><small>Táctica</small>Pizarra ATLAS</h1>
        <div class="head-tools">
          <p class="section__hint">
            ${
              isAdmin
                ? 'Arrastra una carta desde el banquillo al campo. Mueve las fichas para ajustar el dibujo y pulsa «Guardar alineación».'
                : 'Esta es la alineación guardada por el cuerpo técnico. Solo lectura.'
            }
          </p>
        </div>
      </div>

      <div class="board-layout">
        <div class="board-shell">
          <div class="board" id="board">
            <span class="board__mark board__half"></span>
            <span class="board__mark board__circle"></span>
            <span class="board__mark board__box board__box--left"></span>
            <span class="board__mark board__box board__box--right"></span>
            <span class="board__mark board__goal board__goal--left"></span>
            <span class="board__mark board__goal board__goal--right"></span>
          </div>
          ${
            isAdmin
              ? `<div class="board-actions" style="margin-top:.9rem">
                   <button class="btn btn--primary" id="save-board">Guardar alineación</button>
                   <button class="btn btn--ghost" id="clear-board">Vaciar campo</button>
                   <button class="btn btn--ghost" id="auto-board">Colocar 4-3-3</button>
                 </div>`
              : ''
          }
          <p class="board-meta" id="board-meta" style="margin-top:.7rem"></p>
        </div>

        <aside class="board-tools">
          <div class="panel">
            <h3 class="panel__title">Banquillo</h3>
            <div class="bench" id="bench"></div>
          </div>
          <div class="panel">
            <h3 class="panel__title">Cómo funciona</h3>
            <p class="login-hint">
              Coloca cada carta dentro del campo. El nombre y el dorsal viajan con la ficha,
              así que cualquiera entiende la táctica de un vistazo.
            </p>
          </div>
        </aside>
      </div>
    </section>
  `;

  const board = $('#board', ctx.outlet);
  const bench = $('#bench', ctx.outlet);
  let dirty = false;

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

  const renderBench = () => {
    bench.innerHTML = sortedPlayers
      .map(
        (player) => `
        <button class="bench__item ${slots.has(player.id) ? 'is-placed' : ''}" data-bench="${escapeHtml(
          player.id,
        )}" ${isAdmin ? '' : 'disabled'}>
          <span class="bench__num">${escapeHtml(player.number)}</span>
          <span class="bench__name">${escapeHtml(player.displayName)}</span>
          <span class="bench__pos">${escapeHtml(player.position)}</span>
        </button>
      `,
      )
      .join('');

    if (isAdmin) {
      bench.querySelectorAll('[data-bench]').forEach((item) => {
        item.addEventListener('pointerdown', (event) => startDragFromBench(event, item.dataset.bench));
      });
    }
  };

  const renderTokens = () => {
    board.querySelectorAll('.token').forEach((token) => token.remove());
    for (const [playerId, slot] of slots) {
      const player = players.find((p) => p.id === playerId);
      if (!player) continue;
      const token = document.createElement('button');
      token.type = 'button';
      token.className = 'token';
      token.dataset.player = player.id;
      token.style.left = `${slot.x * 100}%`;
      token.style.top = `${slot.y * 100}%`;
      token.title = `${player.displayName} · ${primaryPosition(player)}`;
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
      if (isAdmin) token.addEventListener('pointerdown', (event) => startDragToken(event, token, player.id));
      board.append(token);
    }
    renderBench();
  };

  /* --------------------------------------------------------- Arrastre */

  const pointerToSlot = (event) => {
    const rect = board.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  function startDragFromBench(event, playerId) {
    if (!isAdmin) return;
    event.preventDefault();
    const slot = pointerToSlot(event);
    slots.set(playerId, slot);
    renderTokens();
    markDirty();
    const token = board.querySelector(`[data-player="${CSS.escape(playerId)}"]`);
    if (token) startDragToken(event, token, playerId, true);
  }

  function startDragToken(event, token, playerId, isNew = false) {
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

    const end = (upEvent) => {
      token.classList.remove('is-dragging');
      token.removeEventListener('pointermove', move);
      token.removeEventListener('pointerup', end);
      token.removeEventListener('pointercancel', end);

      // Un toque sin movimiento sobre una ficha la devuelve al banquillo.
      const rect = board.getBoundingClientRect();
      const outside =
        upEvent.clientX < rect.left ||
        upEvent.clientX > rect.right ||
        upEvent.clientY < rect.top ||
        upEvent.clientY > rect.bottom;
      if (isNew && !moved) return;
      if (outside) {
        slots.delete(playerId);
        renderTokens();
        markDirty();
        return;
      }
      renderBench();
    };

    token.addEventListener('pointermove', move);
    token.addEventListener('pointerup', end);
    token.addEventListener('pointercancel', end);
  }

  /* --------------------------------------------------------- Acciones */

  if (isAdmin) {
    $('#save-board', ctx.outlet).addEventListener('click', async () => {
      try {
        await api.saveLineup({
          formation: 'custom',
          items: [...slots].map(([playerId, slot]) => ({ playerId, x: slot.x, y: slot.y })),
        });
        dirty = false;
        setMeta(`Alineación guardada en el servidor.`);
        toast('Alineación guardada');
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    $('#clear-board', ctx.outlet).addEventListener('click', async () => {
      if (!(await confirmAction('¿Vaciar el campo? Se quitarán todas las fichas.'))) return;
      slots.clear();
      renderTokens();
      markDirty();
    });

    $('#auto-board', ctx.outlet).addEventListener('click', () => {
      slots.clear();
      const lineup433 = [
        { position: 'POR', x: 0.06, y: 0.5 },
        { position: 'DFC', x: 0.24, y: 0.25 },
        { position: 'DFC', x: 0.24, y: 0.5 },
        { position: 'DFC', x: 0.24, y: 0.75 },
        { position: 'LI', x: 0.4, y: 0.12 },
        { position: 'LD', x: 0.4, y: 0.88 },
        { position: 'MC', x: 0.46, y: 0.5 },
        { position: 'MC', x: 0.55, y: 0.3 },
        { position: 'MC', x: 0.55, y: 0.7 },
        { position: 'DC', x: 0.75, y: 0.2 },
        { position: 'DC', x: 0.78, y: 0.5 },
        { position: 'DC', x: 0.75, y: 0.8 },
      ];
      for (const entry of lineup433) {
        const taken = new Set([...slots.keys()]);
        const candidate = sortedPlayers.find((p) => p.position === entry.position && !taken.has(p.id));
        if (candidate) slots.set(candidate.id, { x: entry.x, y: entry.y });
      }
      renderTokens();
      markDirty();
    });
  }

  renderTokens();
  if (dirty) setMeta('● Cambios sin guardar');
  else if (lineup.updatedAt) setMeta(`Última actualización: ${new Date(lineup.updatedAt).toLocaleString('es-ES')}`);
  else setMeta('Todavía sin alineación guardada');

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}