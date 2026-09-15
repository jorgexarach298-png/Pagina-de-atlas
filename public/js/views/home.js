'use strict';

import { api } from '../api.js';
import { escapeHtml, formatDayLong, initials, relativeDate, todayISO } from '../utils.js';

/**
 * Portada: identidad del club, resumen de convocatoria y últimos hitos.
 */
export async function renderHome(ctx) {
  const [roster, history, lineup] = await Promise.all([
    api.roster().catch(() => ({ players: [], club: {} })),
    api.history().catch(() => ({ entries: [], club: {} })),
    api.lineup().catch(() => ({ lineup: { items: [] } })),
  ]);

  const club = roster.club || {};
  ctx.state.positions = roster.positions || [];
  ctx.state.club = club;
  window.__ATLAS_POSITIONS__ = ctx.state.positions;

  const today = todayISO();
  let checkin = null;
  if (ctx.state.user) {
    checkin = await api.checkin(today).catch(() => null);
  }

  const latest = history.entries?.slice(0, 3) || [];
  const starters = (lineup.lineup?.items || []).length;
  const withPhoto = roster.players.filter((p) => p.photo).length;

  ctx.outlet.innerHTML = `
    <section class="hero reveal">
      <p class="hero__eyebrow">${escapeHtml(club.game || 'EA SPORTS FC 27 · Clubes Pro')}</p>
      <h1 class="hero__title">${escapeHtml(club.name || 'ATLAS')}</h1>
      <p class="hero__tagline">${escapeHtml(club.tagline || 'Un escudo, once corazones.')}</p>

      <div class="hero__stats">
        <div class="hero__stat"><b>${roster.players.length}</b><span>Miembros</span></div>
        <div class="hero__stat"><b>${withPhoto}</b><span>Cartas con foto</span></div>
        <div class="hero__stat"><b>${starters}</b><span>En la pizarra</span></div>
        <div class="hero__stat">
          <b>${checkin ? `${checkin.counts.yes}/${checkin.total}` : '—'}</b>
          <span>Confirmados hoy</span>
        </div>
      </div>

      <div class="hero__actions">
        <a class="btn btn--primary" href="#/plantilla">Ver la plantilla</a>
        <a class="btn" href="#/pizarra">Abrir la pizarra</a>
        <a class="btn btn--ghost" href="#/checkin">${ctx.state.user ? 'Firmar check-in' : 'Entrar al check-in'}</a>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title"><small>Convocatoria</small>Hoy · ${escapeHtml(formatDayLong(today))}</h2>
        <a class="btn btn--sm btn--ghost" href="#/checkin">Ir al check-in</a>
      </div>
      ${
        checkin
          ? renderCheckinSummary(checkin)
          : `<p class="empty-state"><b>Inicia sesión para ver tu convocatoria</b>
               Entra con tu ID de miembro y confirma si estarás en el próximo partido.</p>`
      }
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title"><small>Vestuario</small>Nuevas caras</h2>
        <a class="btn btn--sm btn--ghost" href="#/plantilla">Toda la plantilla</a>
      </div>
      <div class="card-grid">
        ${roster.players
          .slice(0, 4)
          .map(
            (player) => `
          <article class="card">
            <span class="card__pill">${escapeHtml(player.position)}</span>
            <span class="card__number">${escapeHtml(player.number)}</span>
            <div class="card__media">
              ${
                player.photo
                  ? `<img class="card__photo" src="${escapeHtml(player.photo)}" alt="" loading="lazy" />`
                  : `<div class="card__photo card__photo--empty" aria-hidden="true">${escapeHtml(
                      initials(player.displayName),
                    )}</div>`
              }
            </div>
            <div class="card__foot">
              <h3 class="card__name">${escapeHtml(player.displayName)}</h3>
              <p class="card__sub"><span>ID: ${escapeHtml(player.username)}</span></p>
            </div>
          </article>`,
          )
          .join('')}
      </div>
    </section>

    ${
      latest.length
        ? `<section class="section">
             <div class="section__head">
               <h2 class="section__title"><small>Memoria</small>Últimos hitos</h2>
               <a class="btn btn--sm btn--ghost" href="#/historia">Toda la historia</a>
             </div>
             <div class="timeline">
               ${latest
                 .map(
                   (entry) => `
                 <article class="timeline__item">
                   <p class="timeline__date">${escapeHtml(entry.date || '')}</p>
                   <h2 class="timeline__title">${escapeHtml(entry.title)}</h2>
                   ${
                     entry.body
                       ? `<p class="timeline__body">${escapeHtml(entry.body).slice(0, 220)}${
                           entry.body.length > 220 ? '…' : ''
                         }</p>`
                       : ''
                   }
                 </article>`,
                 )
                 .join('')}
             </div>
           </section>`
        : ''
    }
  `;

  ctx.outlet.querySelectorAll('.reveal').forEach((node, index) => {
    node.style.animationDelay = `${index * 90}ms`;
  });
}

function renderCheckinSummary(checkin) {
  const mine = checkin.roster.find((row) => row.status === 'yes') || [];
  const confirmed = checkin.roster.filter((row) => row.status === 'yes');
  const pending = checkin.counts.pending;

  return `
    <div class="checkin-top">
      <div class="counter" style="--tone:var(--accent)"><b>${confirmed.length}</b><span>Confirmados</span></div>
      <div class="counter" style="--tone:var(--danger)"><b>${checkin.counts.no}</b><span>Bajas</span></div>
      <div class="counter" style="--tone:var(--amber)"><b>${checkin.counts.late}</b><span>Llegan tarde</span></div>
      <div class="counter" style="--tone:var(--dim)"><b>${pending}</b><span>Sin responder</span></div>
    </div>
    ${
      confirmed.length
        ? `<div class="roster-list">
             ${confirmed
               .map(
                 (row) => `
              <div class="roster-row roster-row--yes">
                <span class="roster-row__num">${escapeHtml(row.player.number)}</span>
                <div class="roster-row__info">
                  <p class="roster-row__name">${escapeHtml(row.player.displayName)}</p>
                  <p class="roster-row__sub">${escapeHtml(row.player.position)}</p>
                </div>
                <span class="status-chip status-chip--yes">✅ Estará</span>
              </div>`,
               )
               .join('')}
           </div>`
        : `<p class="section__hint">Nadie ha firmado todavía. Sé el primero en el check-in.</p>`
    }
    <p class="section__hint" style="margin-top:.8rem">${escapeHtml(relativeDate(checkin.date))} · turno de ${escapeHtml(
      checkin.date,
    )}</p>
  `;
}
