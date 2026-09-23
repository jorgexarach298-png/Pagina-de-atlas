'use strict';

import { api } from '../api.js';
import { $, escapeHtml, initials, toast, formatDayLong, relativeDate, todayISO, hashParam } from '../utils.js';
import { createAuthForm } from '../auth.js';

const STATUS_META = {
  yes: { label: 'Estará', icon: '✅' },
  no: { label: 'No puede', icon: '❌' },
  late: { label: 'Llega tarde', icon: '🕐' },
  maybe: { label: 'Duda', icon: '🤔' },
};

const COUNTERS = [
  { key: 'yes', label: 'Confirmados', tone: 'var(--accent)' },
  { key: 'no', label: 'Bajas', tone: 'var(--danger)' },
  { key: 'late', label: 'Tarde', tone: 'var(--amber)' },
  { key: 'maybe', label: 'Dudas', tone: 'var(--sky)' },
  { key: 'pending', label: 'Sin responder', tone: 'var(--dim)' },
];

/**
 * Vista Check-in: cada miembro, con su ID, confirma si viene al partido.
 * Verde = estará, rojo = no puede, ámbar = tarde, azul = duda.
 */
export async function renderCheckin(ctx) {
  let date = hashParam('date', todayISO());

  const load = async () => {
    const isAdmin = Boolean(ctx.state.user?.isAdmin);
    // Quien también juega firma su check-in aunque tenga permisos de mánager; la
    // cuenta técnica de administración no juega y por eso no firma.
    const canSign = Boolean(ctx.state.user?.isPlayer);

    if (!ctx.state.user) {
      ctx.outlet.innerHTML = loginPrompt();
      bindLogin(ctx, load);
      return;
    }

    const data = await api.checkin(date);
    ctx.state.checkin = data;

    ctx.outlet.innerHTML = `
      <section class="section" style="margin-top:0">
        <div class="section__head">
          <h1 class="section__title"><small>Convocatoria</small>Check-in ATLAS</h1>
          <div class="head-tools">
            <div class="field">
              <label for="ck-date">Fecha de la sesión</label>
              <input class="input" type="date" id="ck-date" value="${escapeHtml(date)}" />
            </div>
            <a class="btn btn--ghost" href="#/pizarra?date=${escapeHtml(date)}">Ver en la pizarra</a>
          </div>
        </div>

        <p class="section__hint" style="margin-bottom:1rem">
          ${escapeHtml(formatDayLong(date))} · ${escapeHtml(relativeDate(date))}
        </p>

        <div class="checkin-top">
          ${COUNTERS.map(
            (counter) => `
            <div class="counter" style="--tone:${counter.tone}">
              <b>${data.counts[counter.key] ?? 0}</b>
              <span>${counter.label}</span>
            </div>
          `,
          ).join('')}
        </div>

        ${
          canSign
            ? renderMyPanel(data, ctx.state.user)
            : isAdmin
              ? '<p class="section__hint" style="margin-bottom:1rem">Como administrador puedes corregir el estado de cualquiera: usa el botón del final de cada fila.</p>'
              : '<p class="section__hint" style="margin-bottom:1rem">Tu cuenta no juega, así que no firmas check-in. Puedes ver el estado del equipo.</p>'
        }

        <div class="roster-list">
          ${data.roster.map((row) => renderRow(row, ctx)).join('')}
        </div>

        ${
          data.past?.length
            ? `<div class="section" style="margin-top:2.5rem">
                 <div class="section__head">
                   <h2 class="section__title" style="font-size:1.3rem"><small>Registro</small>Últimas sesiones</h2>
                 </div>
                 <div class="history-strip">
                   ${data.past
                     .map(
                       (session) => `
                     <button class="mini-session" data-session="${escapeHtml(session.date)}">
                       <b>${escapeHtml(session.date)}</b>
                       <span>${session.counts.yes}/${data.total} confirmados</span>
                     </button>
                   `,
                     )
                     .join('')}
                 </div>
               </div>`
            : ''
        }
      </section>
    `;

    $('#ck-date', ctx.outlet).addEventListener('change', (event) => {
      date = event.target.value || todayISO();
      load();
    });

    ctx.outlet.querySelectorAll('[data-session]').forEach((button) => {
      button.addEventListener('click', () => {
        date = button.dataset.session;
        load();
      });
    });

    if (canSign) {
      ctx.outlet.querySelectorAll('[data-status]').forEach((button) => {
        button.addEventListener('click', () => sign(ctx, date, button.dataset.status, load));
      });
      $('#ck-message', ctx.outlet)?.addEventListener('blur', () => {
        const current = data.roster.find((row) => row.player.id === ctx.state.user.id);
        if (current?.status) sign(ctx, date, current.status, load, false);
      });
    }

    if (isAdmin) {
      ctx.outlet.querySelectorAll('[data-admin-status]').forEach((button) => {
        button.addEventListener('click', () => adminSet(ctx, date, button, load));
      });
    }
  };

  await load();
}

function renderMyPanel(data, user) {
  const row = data.roster.find((entry) => entry.player.id === user.id);
  const status = row?.status || null;

  return `
    <div class="checkin-mine">
      <h3>Tu respuesta para el ${escapeHtml(data.date)}</h3>
      <div class="checkin-options">
        ${Object.entries(STATUS_META)
          .map(
            ([key, meta]) => `
          <button class="checkin-option checkin-option--${key} ${status === key ? 'is-on' : ''}"
                  data-status="${key}">
            <span aria-hidden="true">${meta.icon}</span> ${meta.label}
          </button>
        `,
          )
          .join('')}
      </div>
      <div class="field" style="margin-top:1rem">
        <label for="ck-message">Mensaje para el equipo (opcional)</label>
        <input class="input" id="ck-message" maxlength="240"
               placeholder="Llego 10 min tarde, avisadme de la hora"
               value="${escapeHtml(row?.entry?.message || '')}" />
      </div>
    </div>
  `;
}

function renderRow(row, ctx) {
  const { player, status } = row;
  const meta = STATUS_META[status];
  const isAdmin = Boolean(ctx.state.user?.isAdmin);
  const isMe = ctx.state.user?.id === player.id;

  return `
    <div class="roster-row roster-row--${status || 'pending'} ${isMe ? 'is-me' : ''}">
      <span class="roster-row__num">${escapeHtml(player.number)}</span>
      ${
        player.photo
          ? `<img class="roster-row__avatar" src="${escapeHtml(player.photo)}" alt="" loading="lazy" />`
          : `<span class="roster-row__avatar" style="display:grid;place-items:center;font-size:.8rem;color:var(--muted)">${escapeHtml(
              initials(player.displayName),
            )}</span>`
      }
      <div class="roster-row__info">
        <p class="roster-row__name">${escapeHtml(player.displayName)}${isMe ? ' · tú' : ''}</p>
        <p class="roster-row__sub">
          ${escapeHtml(player.position)} · ID ${escapeHtml(player.username)}${
            row.entry?.message ? ` · “${escapeHtml(row.entry.message)}”` : ''
          }
        </p>
      </div>
      <span class="status-chip status-chip--${status || 'pending'}">
        ${meta ? `${meta.icon} ${meta.label}` : 'Sin responder'}
      </span>
      ${
        isAdmin
          ? `<div class="roster-row__admin">
               <button class="btn btn--sm btn--ghost" data-admin-status="yes" data-player="${escapeHtml(
                 player.id,
               )}" title="Marcar como confirmado">✅</button>
               <button class="btn btn--sm btn--ghost" data-admin-status="no" data-player="${escapeHtml(
                 player.id,
               )}" title="Marcar como baja">❌</button>
               <button class="btn btn--sm btn--ghost" data-admin-status="late" data-player="${escapeHtml(
                 player.id,
               )}" title="Marcar como tarde">🕐</button>
               <button class="btn btn--sm btn--ghost" data-admin-status="clear" data-player="${escapeHtml(
                 player.id,
               )}" title="Borrar respuesta">↺</button>
             </div>`
          : ''
      }
    </div>
  `;
}

function loginPrompt() {
  return `
    <section class="section" style="margin-top:0">
      <div class="section__head">
        <h1 class="section__title"><small>Convocatoria</small>Check-in ATLAS</h1>
      </div>
      <div class="login-grid">
        <div class="login-card">
          <h2 class="section__title" style="font-size:1.4rem">Identifícate para firmar</h2>
          <p class="section__hint">
            El check-in es para los miembros de la plantilla. Entra con el mismo ID que tienes
            en la web y marca si vienes al partido.
          </p>
          <div id="ck-auth"></div>
        </div>
        <div class="login-card">
          <h2 class="section__title" style="font-size:1.4rem">¿Cómo funciona?</h2>
          <ul class="login-hint" style="display:flex;flex-direction:column;gap:.6rem;margin:0;padding-left:1.1rem">
            <li>Entra con tu ID de la plantilla (p. ej. <code>tonii_gk</code>).</li>
            <li>Si aún no tienes cuenta, pestaña <strong>Registrarme</strong> y listo.</li>
            <li>Pulsa <strong>Estaré</strong> y tu fila se pondrá en verde ✅.</li>
            <li>Marca <strong>No puedo</strong> para avisar, o <strong>Tarde</strong> si llegas con retraso.</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function bindLogin(ctx, reload) {
  const auth = createAuthForm({
    positions: ctx.state.positions,
    // Aquí no hay modal que ponga el pie: el botón tiene que venir del formulario.
    withButton: true,
    onDone: async (user) => {
      ctx.state.user = user;
      ctx.onUserChange?.(user);
      ctx.outlet.innerHTML = '<p class="loader">Cargando check-in…</p>';
      await reload();
    },
  });
  $('#ck-auth', ctx.outlet).append(auth.el);
}

async function sign(ctx, date, status, reload, announce = true) {
  try {
    const message = $('#ck-message', ctx.outlet)?.value || '';
    await api.checkinMe({ date, status, message });
    if (announce) toast(`Respuesta guardada: ${STATUS_META[status].label}`);
    await reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function adminSet(ctx, date, button, reload) {
  try {
    await api.checkinAdmin({
      date,
      playerId: button.dataset.player,
      status: button.dataset.adminStatus,
    });
    await reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}
