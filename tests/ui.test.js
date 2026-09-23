'use strict';

/**
 * Pruebas de interfaz con un navegador real. Recorren los flujos que toca el
 * usuario: registro por ID de plantilla, cartas con estadísticas, banquillo,
 * publicación del once y notas 1-11 sin repetir.
 *
 * Uso: node tests/ui.test.js <base>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://127.0.0.1:4123';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.log(`FALLO ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(page, fn, { timeout = 10000, message = 'condición' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(120);
  }
  throw new Error(`Se agotó el tiempo esperando: ${message}`);
}

/** Espera a que aparezca un aviso con cierto texto. */
const waitToast = (page, pattern) =>
  waitFor(
    page,
    async () => {
      const text = await page.$eval('#toasts', (el) => el.textContent).catch(() => '');
      return pattern.test(text) ? text : null;
    },
    { message: `aviso ${pattern}` },
  );

/** Inicia sesión desde el modal de la cabecera. */
async function login(page, username, password) {
  await page.goto(`${BASE}/#/inicio`, { waitUntil: 'networkidle2' });
  await page.click('#open-login');
  await waitFor(page, () => page.$('#au1-lg-user'), { message: 'formulario de acceso' });
  await page.type('#au1-lg-user', username);
  await page.type('#au1-lg-pass', password);
  await page.click('.modal__foot .btn--primary');
  await waitFor(page, () => page.$('#open-account'), { message: 'sesión iniciada' });
}

(async () => {
  console.log(`\nATLAS · pruebas de interfaz contra ${BASE}\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const errors = [];
  const badResponses = [];
  const watch = (page, tag) => {
    page.on('console', (msg) => {
      // Los recursos que fallan también llegan como error de consola; se
      // registran aparte con su URL, así que aquí se ignoran para no duplicar.
      if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) {
        errors.push(`${tag}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => errors.push(`${tag}: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${tag}: ${res.status()} ${res.url()}`);
    });
  };

  try {
    const publicPage = await browser.newPage();
    watch(publicPage, 'publico');
    await publicPage.setViewport({ width: 1440, height: 1000 });

    /* ------------------------------------------------ Registro por ID */

    await publicPage.goto(`${BASE}/#/inicio`, { waitUntil: 'networkidle2' });
    await publicPage.click('#open-login');
    await waitFor(publicPage, () => publicPage.$('[data-tab="register"]'), { message: 'pestaña de registro' });
    await publicPage.click('[data-tab="register"]');

    const hintText = await waitFor(
      publicPage,
      async () => {
        const text = await publicPage.$eval('#au1-rg-hint', (el) => el.textContent.trim());
        return text.length > 10 ? text : null;
      },
      { message: 'pista con los IDs pendientes' },
    );
    check('el registro explica que solo vale un ID de la plantilla', /plantilla/i.test(hintText), hintText.slice(0, 90));
    check('el registro lista IDs sin cuenta', /Cristiano|totocuero|adrimarquezj/i.test(hintText), hintText.slice(0, 90));

    check('el registro ya no pide dorsal', (await publicPage.$('#au1-rg-number')) === null);
    check('el registro ya no pide posición', (await publicPage.$('#au1-rg-pos')) === null);

    await publicPage.type('#au1-rg-user', 'jugador_fantasma_99');
    await publicPage.type('#au1-rg-pass', 'clave-de-prueba');
    await publicPage.click('.modal__foot .btn--primary');
    const rejected = await waitToast(publicPage, /plantilla/i);
    check('un ID inventado es rechazado con un aviso', /plantilla/i.test(rejected), rejected.slice(0, 90));

    /* ------------------------------------------------ Cartas de la Plantilla */

    await publicPage.goto(`${BASE}/#/plantilla`, { waitUntil: 'networkidle2' });
    await waitFor(publicPage, () => publicPage.$('.card'), { message: 'cartas de la plantilla' });

    const cardCount = await publicPage.$$eval('.card', (cards) => cards.length);
    check('la Plantilla muestra las 16 cartas', cardCount === 16, `${cardCount}`);

    const statsBoxes = await publicPage.$$eval('.card__stats', (els) => els.length);
    check('cada carta muestra sus estadísticas', statsBoxes === 16, `${statsBoxes}`);

    const statsLabels = await publicPage.$eval('.card__stats', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    check('las estadísticas son PJ, goles y asistencias', /PJ.*Goles.*Asist/i.test(statsLabels), statsLabels);

    const ratings = await publicPage.$$eval('.card__rating', (els) => els.length);
    check('cada carta tiene hueco para la nota media', ratings === 16, `${ratings}`);

    const emptyRating = await publicPage.$eval('.card__rating', (el) => el.textContent.trim());
    check('sin notas, la media aparece vacía', emptyRating === '—', emptyRating);

    /* ------------------------------------------------ Candidato y once */

    const pending = await publicPage.evaluate(async () => (await fetch('/api/auth/available')).json());
    const candidate = pending.pending[0];
    const roster = await publicPage.evaluate(async () => (await fetch('/api/roster')).json());
    const candidateId = roster.players.find((p) => p.username === candidate.username).id;
    const squad = [candidateId, ...roster.players.filter((p) => p.id !== candidateId).slice(0, 3).map((p) => p.id)];
    const date = new Date().toISOString().slice(0, 10);

    /* ------------------------------------------------ Pizarra: banquillo */

    const adminPage = await browser.newPage();
    watch(adminPage, 'admin');
    await adminPage.setViewport({ width: 1440, height: 1000 });
    await login(adminPage, 'admin', 'atlas-admin');
    await adminPage.goto(`${BASE}/#/pizarra`, { waitUntil: 'networkidle2' });
    await waitFor(adminPage, () => adminPage.$('#bench'), { message: 'banquillo' });

    const bench = await adminPage.$eval('#bench', (el) => {
      const rect = el.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), items: el.children.length };
    });
    check('el banquillo lista a los 16', bench.items === 16, `${bench.items}`);
    check('el banquillo es más alto que los 340px de antes', bench.height > 420, `${bench.height}px`);
    check('el banquillo es ancho para leer los nombres', bench.width > 280, `${bench.width}px`);

    // El banquillo se repinta al colocar cada carta, así que el botón se
    // vuelve a localizar en cada vuelta en vez de guardar referencias viejas.
    for (let i = 0; i < 4; i += 1) {
      const buttons = await adminPage.$$('[data-add]');
      await buttons[0].click();
      await sleep(200);
    }
    const tokens = await adminPage.$$eval('.token', (els) => els.length);
    check('«Añadir» sube jugadores al campo', tokens === 4, `${tokens}`);

    const publishLabel = await adminPage.$eval('#publish-board', (el) => el.textContent.trim());
    check('el botón invita a publicar el once', /Publicar once del día/i.test(publishLabel), publishLabel);

    /* ------------------------------------------------ El candidato se registra */

    const context = await browser.createBrowserContext();
    const playerPage = await context.newPage();
    watch(playerPage, 'jugador');
    await playerPage.setViewport({ width: 1280, height: 900 });

    await playerPage.goto(`${BASE}/#/inicio`, { waitUntil: 'networkidle2' });
    await playerPage.click('#open-login');
    await waitFor(playerPage, () => playerPage.$('[data-tab="register"]'), { message: 'registro' });
    await playerPage.click('[data-tab="register"]');
    await playerPage.type('#au1-rg-user', candidate.username);
    await playerPage.type('#au1-rg-pass', 'clave-de-prueba');
    await playerPage.click('.modal__foot .btn--primary');
    await waitFor(playerPage, () => playerPage.$('#open-account'), { message: 'cuenta activada' });

    const sessionName = await playerPage.$eval('#open-account .session__meta b', (el) => el.textContent.trim());
    check('el miembro activa su cuenta con su ID', sessionName.length > 0, sessionName);
    check(
      'entra como jugador, no como administrador',
      (await playerPage.$eval('#open-account .session__meta span', (el) => el.textContent.trim())) !== 'Administrador',
    );

    /* ------------------------------------------------ Publicar el once del día */

    const publishResult = await adminPage.evaluate(
      async ({ d, ids }) => {
        const res = await fetch(`/api/matches/${d}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            formation: '4-3-3',
            items: ids.map((playerId, index) => ({
              playerId,
              x: 0.2 + index * 0.2,
              y: 0.3 + index * 0.1,
              vertical: true,
            })),
          }),
        });
        return { status: res.status, body: await res.text() };
      },
      { d: date, ids: squad },
    );
    check('el once se publica por la interfaz del mánager', publishResult.status === 200, `${publishResult.status} ${publishResult.body.slice(0, 140)}`);

    // Un `goto` al mismo hash no recarga la página, así que se añade la fecha
    // a la URL para forzar el re-render de la pizarra.
    await adminPage.goto(`${BASE}/#/pizarra?date=${date}`, { waitUntil: 'networkidle2' });
    await waitFor(adminPage, () => adminPage.$('#save-stats'), { message: 'editor de estadísticas' });

    const statRows = await adminPage.$$eval('[data-stat-row]', (els) => els.length);
    check('el editor de estadísticas lista a los 4 del once', statRows === 4, `${statRows}`);

    await adminPage.$eval('[data-stat-row] [data-goals]', (el) => {
      el.value = '2';
    });
    await adminPage.$eval('[data-stat-row] [data-assists]', (el) => {
      el.value = '1';
    });
    await adminPage.click('#clean-sheet');
    await adminPage.click('#save-stats');
    await waitToast(adminPage, /Estadísticas guardadas/);

    /* ------------------------------------------------ Estadísticas en las cartas */

    await adminPage.goto(`${BASE}/#/plantilla`, { waitUntil: 'networkidle2' });
    await waitFor(adminPage, () => adminPage.$('.card'), { message: 'cartas' });
    const cardStats = await adminPage.$$eval('.card__stats', (els) =>
      els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
    );
    const played = cardStats.filter((t) => /PJ\s*1/.test(t)).length;
    check('los 4 del once suman un partido jugado', played === 4, `${played}`);
    check('los 2 goles anotados salen en la carta', cardStats.some((t) => /Goles\s*2/.test(t)), cardStats.join(' | ').slice(0, 120));
    check('la asistencia anotada sale en la carta', cardStats.some((t) => /Asist\.\s*1/.test(t)), cardStats.join(' | ').slice(0, 120));

    // La portería a cero solo la enseñan portero y central.
    const cleanSheetCards = cardStats.filter((t) => /Imbatidas\s*1/.test(t)).length;
    check('portero y central muestran su portería imbatida', cleanSheetCards === 2, `${cleanSheetCards}`);

    /* ------------------------------------------------ Notas 1-11 sin repetir */

    await playerPage.goto(`${BASE}/#/pizarra`, { waitUntil: 'networkidle2' });
    await waitFor(playerPage, () => playerPage.$('.rating-list'), { message: 'panel de notas' });

    const ratingRows = await playerPage.$$eval('.rating-row', (els) => els.length);
    check('quien juega ve a sus 3 compañeros para puntuar', ratingRows === 3, `${ratingRows}`);

    const noteButtons = await playerPage.$$eval('.note-btn', (els) => els.length);
    check('cada compañero ofrece notas del 1 al 11', noteButtons === 33, `${noteButtons}`);

    await playerPage.$eval('.rating-row:nth-child(1) .note-btn:nth-child(5)', (el) => el.click());
    await sleep(250);
    const blocked = await playerPage.$$eval('.rating-row:nth-child(2) .note-btn', (els) =>
      els.filter((el) => el.disabled).map((el) => el.textContent.trim()),
    );
    check('una nota ya usada se bloquea en el resto', blocked.includes('5'), blocked.join(','));

    await playerPage.$eval('.rating-row:nth-child(2) .note-btn:nth-child(7)', (el) => el.click());
    await sleep(150);
    await playerPage.$eval('.rating-row:nth-child(3) .note-btn:nth-child(3)', (el) => el.click());
    await sleep(150);

    const progress = await playerPage.$eval('#rating-progress', (el) => el.textContent.trim());
    check('el progreso de la papeleta se actualiza', /3\/3/.test(progress), progress);

    await playerPage.click('#save-ratings');
    await waitToast(playerPage, /Notas guardadas/);

    /* ------------------------------------------------ La media en la Plantilla */

    await playerPage.goto(`${BASE}/#/plantilla`, { waitUntil: 'networkidle2' });
    await waitFor(playerPage, () => playerPage.$('.card__rating'), { message: 'medias' });
    const averages = await playerPage.$$eval('.card__rating', (els) =>
      els.map((el) => el.textContent.trim()).filter((t) => t !== '—'),
    );
    check('las notas puestas se reflejan como media', averages.length === 3, `${averages.join(',')}`);
    // Al primero se le puso un 5, al segundo un 7 y al tercero un 3.
    check(
      'las medias coinciden con las notas puestas',
      ['5.0', '7.0', '3.0'].every((note) => averages.includes(note)),
      averages.join(','),
    );

    /* ------------------------------------------------ Restablecer cuenta */

    await adminPage.goto(`${BASE}/#/plantilla`, { waitUntil: 'networkidle2' });
    await waitFor(adminPage, () => adminPage.$('.card'), { message: 'cartas' });

    // Los registrados no llevan marca; los 15 restantes sí.
    const flags = await adminPage.$$eval('.card__flag', (els) => els.length);
    check('las cartas marcan quién no ha activado su cuenta', flags === 15, `${flags}`);

    // Se abre la ficha del miembro que sí se registró, que es el único cuya
    // cuenta tiene sentido restablecer.
    const targetIndex = await adminPage.evaluate((username) => {
      const cards = [...document.querySelectorAll('.card')];
      return cards.findIndex((card) => card.textContent.includes(`ID: ${username}`));
    }, candidate.username);
    check('el miembro registrado tiene su carta en la Plantilla', targetIndex >= 0, `índice ${targetIndex}`);

    const editButtons = await adminPage.$$('[data-edit]');
    check('el mánager tiene el botón de editar en cada carta', editButtons.length === 16, `${editButtons.length}`);

    await editButtons[targetIndex].click();
    const resetButton = await waitFor(
      adminPage,
      async () => {
        const buttons = await adminPage.$$('.modal__foot .btn');
        for (const button of buttons) {
          const label = await button.evaluate((el) => el.textContent.trim());
          if (/Restablecer cuenta/i.test(label)) return button;
        }
        return null;
      },
      { message: 'botón de restablecer cuenta' },
    );
    check('el modal de edición ofrece restablecer la cuenta', Boolean(resetButton));

    await resetButton.click();

    // El diálogo de confirmación se apila sobre el de edición, así que hay que
    // mirar el último modal para no pulsar «Eliminar» del formulario de debajo.
    const confirmButton = await waitFor(
      adminPage,
      async () => {
        const last = await adminPage.evaluate(() => {
          const modals = document.querySelectorAll('.modal');
          const modal = modals[modals.length - 1];
          if (!modal) return null;
          const body = modal.querySelector('.modal__body')?.textContent || '';
          const button = [...modal.querySelectorAll('.modal__foot .btn')].find((el) =>
            /Sí, continuar/i.test(el.textContent),
          );
          return { body, hasButton: Boolean(button), total: modals.length };
        });
        return last && last.total >= 2 && /Devolver el acceso/i.test(last.body) && last.hasButton ? last : null;
      },
      { message: 'confirmación de restablecer cuenta' },
    );

    await adminPage.evaluate(() => {
      const modals = document.querySelectorAll('.modal');
      const modal = modals[modals.length - 1];
      const button = [...modal.querySelectorAll('.modal__foot .btn')].find((el) =>
        /Sí, continuar/i.test(el.textContent),
      );
      button.click();
    });
    await waitToast(adminPage, /Cuenta restablecida/);

    const pendingAfterReset = await adminPage.evaluate(async () => (await fetch('/api/auth/available')).json());
    check(
      'tras restablecer, el ID vuelve a la lista de registro',
      pendingAfterReset.pending.length === 16,
      `${pendingAfterReset.pending.length}`,
    );

    /* ------------------------ Foto de perfil desde "Mi cuenta" ---------- */

    // Este flujo se rompía en silencio: el modal llamaba a una función
    // `close()` que no existía, así que el navegador cerraba la pestaña en vez
    // del cuadro de diálogo y parecía que la web te había expulsado.
    await adminPage.goto(`${BASE}/#/plantilla`, { waitUntil: 'networkidle2' });
    await waitFor(adminPage, () => adminPage.$('.card'), { message: 'cartas' });
    await adminPage.click('#open-account');
    await waitFor(adminPage, () => adminPage.$('#ac-photo'), { message: 'botón de foto en Mi cuenta' });
    await adminPage.click('#ac-photo');

    const uploader = await waitFor(adminPage, () => adminPage.$('input[type=file]'), { message: 'selector de archivo' });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const tmpPhoto = path.join(os.tmpdir(), `atlas-foto-${Date.now()}.png`);
    fs.writeFileSync(tmpPhoto, png);
    await uploader.uploadFile(tmpPhoto);
    await waitToast(adminPage, /Foto actualizada/);

    check('la foto de Mi cuenta se guarda sin sacarte de la web', true);
    check(
      'al guardar la foto se sigue con la sesión abierta',
      await adminPage.$('#open-account').then(Boolean),
    );
    check(
      'el modal de Mi cuenta se cierra al guardar la foto',
      (await adminPage.$('#ac-photo')) === null,
    );
    fs.rmSync(tmpPhoto, { force: true });

    /* ------------------------------------------------ Limpieza */

    const removed = await adminPage.evaluate(async (d) => {
      return (await fetch(`/api/matches/${d}`, { method: 'DELETE' })).status;
    }, date);
    check('el once de prueba se retira', removed === 200, `${removed}`);

    // El único 404 esperado es el rechazo del ID inventado del principio.
    const unexpected = badResponses.filter((entry) => !/api\/auth\/register/.test(entry));
    check('sin respuestas de error inesperadas', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
    check('sin errores de consola en la interfaz', errors.length === 0, errors.slice(0, 3).join(' | '));

    await context.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} correctas, ${failed} fallidas\n`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('Error inesperado en las pruebas de interfaz:', error);
  process.exit(1);
});
