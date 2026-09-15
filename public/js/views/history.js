'use strict';

import { api } from '../api.js';
import { $, html, escapeHtml, toast, openModal, confirmAction, pickPhoto, todayISO } from '../utils.js';

/**
 * Vista Historia del club: línea temporal con las entradas que publica el admin.
 */
export async function renderHistory(ctx) {
  await paint(ctx);
}

async function paint(ctx) {
  const { entries, club } = await api.history();
  const isAdmin = Boolean(ctx.state.user?.isAdmin);

  ctx.outlet.innerHTML = `
    <section class="section" style="margin-top:0">
      <div class="section__head">
        <h1 class="section__title"><small>Memoria</small>Historia del club</h1>
        <div class="head-tools">
          <p class="section__hint">${escapeHtml(club?.tagline || 'Un escudo, once corazones.')}</p>
          ${isAdmin ? '<button class="btn btn--primary" id="add-history">＋ Nueva entrada</button>' : ''}
        </div>
      </div>

      ${
        entries.length
          ? `<div class="timeline">${entries.map((entry) => renderEntry(entry, isAdmin)).join('')}</div>`
          : `<p class="empty-state"><b>Todavía sin páginas</b>
               Aquí se irá escribiendo la historia de ATLAS: temporadas, ascensos y noches de copa.
             </p>`
      }
    </section>
  `;

  ctx.outlet.querySelectorAll('.timeline__item').forEach((item, index) => {
    item.classList.add('reveal');
    item.style.animationDelay = `${Math.min(index * 70, 500)}ms`;
  });

  $('#add-history', ctx.outlet)?.addEventListener('click', () => editEntry(null, ctx));

  if (isAdmin) {
    ctx.outlet.querySelectorAll('[data-history-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = entries.find((e) => e.id === button.dataset.historyEdit);
        editEntry(entry, ctx);
      });
    });
  }
}

function renderEntry(entry, isAdmin) {
  return `
    <article class="timeline__item">
      <p class="timeline__date">
        ${escapeHtml(entry.date || '')}${entry.pinned ? ' · ★ destacada' : ''}
      </p>
      <h2 class="timeline__title">${escapeHtml(entry.title)}</h2>
      ${
        entry.body
          ? `<p class="timeline__body">${escapeHtml(entry.body).replace(/\n/g, '<br />')}</p>`
          : ''
      }
      ${
        entry.image
          ? `<div class="timeline__media"><img src="${escapeHtml(entry.image)}" alt="" loading="lazy" /></div>`
          : ''
      }
      ${
        isAdmin
          ? `<div class="timeline__admin">
               <button class="btn btn--sm btn--ghost" data-history-edit="${escapeHtml(entry.id)}">✎ Editar</button>
             </div>`
          : ''
      }
    </article>
  `;
}

function editEntry(entry, ctx) {
  const isNew = !entry;
  const draft = { image: entry?.image || null, pendingImage: null };

  const form = html(`
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1">
        <label for="h-title">Título</label>
        <input class="input" id="h-title" maxlength="120" placeholder="Ej. Campeones de la Liga Pro"
               value="${escapeHtml(entry?.title || '')}" />
      </div>
      <div class="field">
        <label for="h-date">Fecha o temporada</label>
        <input class="input" id="h-date" maxlength="40" placeholder="2026" value="${escapeHtml(
          entry?.date || todayISO(),
        )}" />
      </div>
      <div class="field" style="justify-content:flex-end">
        <label style="display:flex;align-items:center;gap:.5rem;text-transform:none;letter-spacing:0">
          <input type="checkbox" id="h-pinned" ${entry?.pinned ? 'checked' : ''} style="width:auto" />
          Destacar arriba
        </label>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="h-body">Relato</label>
        <textarea class="textarea" id="h-body" placeholder="Cuenta qué pasó...">${escapeHtml(
          entry?.body || '',
        )}</textarea>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>Imagen (opcional)</label>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" type="button" id="h-pick">Elegir imagen</button>
          <button class="btn btn--sm btn--danger" type="button" id="h-clear" ${
            entry?.image ? '' : 'hidden'
          }>Quitar</button>
          <span class="login-hint" id="h-file">${entry?.image ? 'Imagen actual' : 'Sin imagen'}</span>
        </div>
      </div>
    </div>
  `);

  $('#h-pick', form).addEventListener('click', async () => {
    try {
      const dataUrl = await pickPhoto(1024);
      if (!dataUrl) return;
      draft.pendingImage = dataUrl;
      draft.image = dataUrl;
      $('#h-file', form).textContent = 'Nueva imagen lista para subir';
      $('#h-clear', form).hidden = false;
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#h-clear', form).addEventListener('click', () => {
    draft.pendingImage = null;
    draft.image = null;
    $('#h-file', form).textContent = 'Sin imagen';
    $('#h-clear', form).hidden = true;
  });

  openModal({
    title: isNew ? 'Nueva entrada de historia' : 'Editar entrada',
    body: form,
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      ...(isNew
        ? []
        : [
            {
              label: 'Eliminar',
              variant: 'danger',
              onClick: async ({ close }) => {
                if (!(await confirmAction(`¿Eliminar «${entry.title}»?`))) return false;
                try {
                  await api.deleteHistory(entry.id);
                  toast('Entrada eliminada');
                  close();
                  await paint(ctx);
                } catch (error) {
                  toast(error.message, 'error');
                }
                return false;
              },
            },
          ]),
      {
        label: isNew ? 'Publicar' : 'Guardar',
        variant: 'primary',
        onClick: async ({ close }) => {
          const payload = {
            title: $('#h-title', form).value.trim(),
            date: $('#h-date', form).value.trim(),
            body: $('#h-body', form).value.trim(),
            pinned: $('#h-pinned', form).checked,
          };
          if (!payload.title) {
            toast('Ponle un título a la entrada', 'error');
            return false;
          }
          try {
            if (isNew) {
              await api.createHistory({ ...payload, image: draft.pendingImage });
            } else {
              if (draft.pendingImage !== null || draft.image !== entry.image) {
                payload.image = draft.pendingImage;
              }
              await api.updateHistory(entry.id, payload);
            }
            toast(isNew ? 'Entrada publicada' : 'Entrada actualizada');
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
