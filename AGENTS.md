# AGENTS.md

## Proyecto
Web oficial del club ATLAS (EA SPORTS FC 27 Clubes Pro). Interfaz en español.
Node/Express + SPA en JavaScript puro (sin build step ni frameworks) + persistencia JSON.

## Comandos
- `npm install` — instalar dependencias.
- `npm start` — arrancar en http://localhost:3000 (`PORT` configurable).
- No hay suite de tests. Verificar con `curl` contra la API o con el navegador.

## Arquitectura
- `server.js` — Express, sesiones (`express-session`), guardas `requireAdmin` /
  `requireAuth`, API REST bajo `/api/*` y servido estático de `public/` y `/uploads`.
- `lib/store.js` — única fuente de datos. `loadDatabase()` crea y siembra
  `data/atlas.json` si no existe. Exporta CRUD y utilidades de fecha
  (`todayISO()`, `dateInTimeZone()`). La zona horaria por defecto es `Europe/Madrid`.
- `lib/uploads.js` — convierte data URLs de imagen en ficheros dentro de `data/uploads/`
  y devuelve la ruta pública `/uploads/<archivo>`.
- `public/js/app.js` — router por hash, estado de sesión y render de cabecera.
- `public/js/views/*.js` — una vista por sección: `home`, `roster`, `pizarra`,
  `checkin`, `history`. Exportan `render<Nombre>(context)`.
- `public/js/api.js` — envoltorio `fetch` con `credentials: 'include'`.
- `public/js/utils.js` — helpers compartidos (`$`, `escapeHtml`, `html`, `toast`,
  `openModal`, `confirmAction`, `pickPhoto`, fechas).

## Convenciones
- Todo el texto de la interfaz va en español.
- Los módulos del navegador usan ESM (`import`/`export`). Por eso
  `node --check public/js/**` falla: es esperado, no son módulos CommonJS.
  Para validar sintaxis del frontend hay que cargar la página en el navegador.
- Escapar siempre los datos de usuario con `escapeHtml` antes de insertarlos en HTML.
- Los ids de jugador se derivan del username (minúsculas, no alfanumérico a guion).

## Identidad visual y paleta
- El escudo vive en `public/img/escudo.png` y se usa en la cabecera, la portada
  (`.hero__crest`) y el favicon. La paleta se deriva de él y se define como variables
  CSS al principio de `public/css/styles.css`:
  fondo azul marino (`--ink-*`), oro de marca (`--accent` `#e3b85c`), azul acero
  (`--sky`), carmesí (`--danger`), ámbar (`--amber`) y marfil (`--paper`).
- El verde `--ok` **no** está en el escudo: se reserva para estados positivos
  (check-in «Estará», confirmados). No usarlo como color de marca.
- El verde del campo de la pizarra (`.board`) es intencional (césped), no lo cambies
  al retematizar.

## Verificación visual
- Capturar con Chromium headless. Las animaciones `.reveal` quedan congeladas en
  `--virtual-time-budget`, así que hay que añadir `--force-prefers-reduced-motion`
  o la página sale casi en negro aunque el DOM sea correcto:
  `chromium --headless --no-sandbox --disable-gpu --force-prefers-reduced-motion \`
  `  --window-size=1440,1100 --virtual-time-budget=9000 --screenshot=/tmp/x.png URL`
- `--dump-dom` sirve para confirmar que el contenido se renderiza aunque el
  screenshot salga oscuro.

## Autenticación
- Admin por defecto: `admin` / `atlas-admin` (configurable con `ATLAS_ADMIN_USER`
  y `ATLAS_ADMIN_PASSWORD`).
- Contraseña inicial de cada miembro: `atlas` + su dorsal (p. ej. `atlas9`).
- El secreto de sesión se persiste en `data/session.key` para que los inicios de
  sesión sobrevivan a un reinicio; se puede sobrescribir con `SESSION_SECRET`.

## Estado de datos
`data/atlas.json`, `data/session.key` y `data/uploads/*` están en `.gitignore`
(solo se versiona `data/uploads/.gitkeep`). Para volver al estado inicial basta
con borrar `data/atlas.json` y `data/session.key` y reiniciar el servidor.

## Riesgos conocidos
- La persistencia es un único fichero JSON reescrito en cada cambio: no hay bloqueo
  entre procesos. Ejecutar una sola instancia del servidor.
