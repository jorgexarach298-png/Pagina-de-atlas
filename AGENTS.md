# AGENTS.md

## Proyecto
Web oficial del club ATLAS (EA SPORTS FC 27 Clubes Pro). Interfaz en español.
Node/Express + SPA en JavaScript puro (sin build step ni frameworks) + persistencia JSON.

## Comandos
- `npm install` — instalar dependencias.
- `npm start` — arrancar en http://localhost:3000 (`PORT` configurable).
- No hay suite de tests. Verificar con `curl` contra la API o con el navegador
  (Puppeteer con el Chromium del sistema sirve para probar los flujos táctiles).

## Arquitectura
- `server.js` — Express, sesiones (`express-session`), guardas `requireAdmin` /
  `requireAuth`, API REST bajo `/api/*` y servido estático de `public/` y `/uploads`.
- `lib/store.js` — única fuente de datos. `loadDatabase()` crea y siembra
  `data/atlas.json` si no existe. Exporta CRUD y utilidades de fecha
  (`todayISO()`, `dateInTimeZone()`). La zona horaria por defecto es `Europe/Madrid`.
- `lib/uploads.js` — convierte data URLs de imagen en ficheros dentro de `data/uploads/`
  y devuelve la ruta pública `/uploads/<archivo>`.
- `public/js/app.js` — router por hash, estado de sesión y render de cabecera.
- `public/js/auth.js` — formulario de acceso/registro compartido por el modal de la
  cabecera y la página de check-in. `createAuthForm()` devuelve `{ el, submit() }`;
  los `id` de los campos llevan sufijo para no chocar entre instancias.
- `public/js/views/*.js` — una vista por sección: `home`, `roster`, `pizarra`,
  `checkin`, `history`. Exportan `render<Nombre>(context)`.
- `public/js/api.js` — envoltorio `fetch` con `credentials: 'include'`.
- `public/js/utils.js` — helpers compartidos (`$`, `escapeHtml`, `html`, `toast`,
  `openModal`, `confirmAction`, `pickPhoto`, `hashParam`, fechas).

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
- No hay registro público: la plantilla se siembra en el primer arranque y cada
  miembro entra con el ID que ya figura en ella (`POST /api/auth/login`). El ID es
  insensible a mayúsculas.
- Contraseña inicial de cada miembro: `atlas` + su dorsal (p. ej. `atlas9`).
- Los administradores son jugadores normales con `isAdmin: true` (no hay cuenta
  `admin` aparte). En la semilla son `antoniogarciagal`, `RodriKTV`, `habixuelo75`
  y `Angelotss`; el resto de jugadores no lo es.
- `requireAdmin` protege la pizarra (guardar alineación), la plantilla (CRUD),
  la historia y el check-in de otros. Como los admins son jugadores, siguen
  contando en el check-in y firmando su propia respuesta.
- El secreto de sesión se persiste en `data/session.key` para que los inicios de
  sesión sobrevivan a un reinicio; se puede sobrescribir con `SESSION_SECRET`.

## Pizarra táctica
- El campo es **vertical** (proporción 3/4). En las coordenadas, `y = 0` es la
  portería rival (arriba) y `y = 1` la nuestra (abajo).
- `lib/store.js` guarda `vertical: true` en cada ficha colocada. Las alineaciones
  guardadas antes del cambio traen los ejes horizontales y `migrateSlot()` los
  intercambia al leerlas; no hay que tocar los datos a mano.
- Se coloca una carta de tres formas, para que ratón y dedo funcionen igual:
  arrastrando desde el banquillo, pulsando «Añadir», o tocando la carta y luego
  el césped. En un móvil vertical el campo y el banquillo no caben a la vez, así
  que el flujo de tocar-y-colocar es el importante ahí.
- `.token` lleva `touch-action: none`: sin eso el navegador interpreta el gesto
  como scroll y dispara `pointercancel`.
- En el banquillo la regla es la contraria. Con 16 cartas mide ~905 px dentro de
  una caja de 340 px, así que tiene que poder desplazarse con el dedo. Por eso
  `.bench__item` usa `touch-action: pan-y` y **no** se llama a `preventDefault()`
  en su `pointerdown`: bloquearlo dejaba la lista sin scroll en el móvil.
  - Con el dedo, arrastrar al campo se hace desde el asa (`.bench__avatar`,
    `.bench__num`, `.bench__grip`), que sí lleva `touch-action: none`. Tocar el
    resto de la carta la selecciona, y deslizar sobre ella desplaza la lista.
  - Con el ratón se arrastra desde cualquier punto de la carta, incluido el
    botón «Añadir» (`desdeBoton`), y la selección nativa se corta con
    `preventDefault()`, que en ratón no estorba.
- El banquillo marca `is-editable` solo al admin: sin eso los demás usuarios ven
  el cursor de agarre en cartas que no pueden mover.
- El aro de cada ficha refleja la convocatoria del día (`token--yes`/`no`/`late`/
  `maybe`). Ese dato solo se envía a quien ha iniciado sesión: la pizarra es
  pública, pero quién viene al partido no.
- La foto del jugador se pinta dentro del aro (`.token__avatar img`) y el dorsal
  queda como insignia. El selector del hueco de iniciales es
  `.token__avatar span:not(.token__num)`: al ser `.token__num` un `span` hermano,
  un `.token__avatar span` a secas le daba `width/height: 100%` y el dorsal
  tapaba la foto entera con un disco dorado.
- `.board-shell` y `.board-tools` llevan `min-width: 0`. Sin ello, como hijos de
  una rejilla, conservan su ancho mínimo de contenido (~376px) y en el móvil el
  panel y el banquillo se salían de la pantalla por la derecha y se veían
  cortados.

## Arrancar y parar

`./atlas.sh` controla el servidor. En este entorno el puerto **12000** es el que
da URL pública (`work-1-...`); `npm start` usa el 3000.

```
./atlas.sh start     # arranca en segundo plano (aguanta que cierres la terminal)
./atlas.sh status    # dice si esta vivo, y con que resultado responde
./atlas.sh restart   # reinicia; util si se queda colgado
./atlas.sh stop      # lo detiene
./atlas.sh start 3000   # opcional: otro puerto
```

El proceso se lanza con `setsid nohup`, deja el log en `data/server.log` y el PID
en `data/server.pid`. `start` no duplica si ya hay uno, y si encuentra un
`node server.js` suelto (sin pidfile) lo detiene antes de arrancar. `pid_vivo()`
comprueba además que el PID del pidfile sigue siendo un `node server.js`: tras un
reinicio del contenedor el número puede reutilizarse por otro proceso y el
pidfile viejo bloqueaba el arranque.

## Persistencia y auto-arranque

Solo `/workspace` es un volumen propio que sobrevive a los reinicios del
contenedor; `/home`, `/etc` y `/tmp` viven en un overlay efímero. Por eso el
código y `data/` (incluidas las fotos de `data/uploads/`) persisten, pero
cualquier cosa escrita fuera de `/workspace` se pierde.

Lo que **no** sobrevive es el proceso: el runtime apaga el contenedor por
inactividad (`OH_RUNTIME_IDLE_TIMEOUT_SECONDS`) y al volver arranca uno nuevo, así
que `node server.js` no se relanza solo. Para cubrirlo, `.openhands/hooks.json`
define un hook `session_start` (async) que ejecuta `./atlas.sh start`; es
idempotente, así que si el servidor ya está vivo no hace nada. Verificado: al
lanzar una conversación con ese `hook_config`, el servidor se levanta solo.

Ese hook solo actúa cuando la conversación recibe el `hook_config` (el runtime lo
entrega vía `POST /api/hooks` con `project_dir`); no se autocargan por sí solos
en todas las conversaciones, así que no sustituye a `./atlas.sh start`.
No hay cron, systemd ni supervisor en este contenedor, de modo que no existe un
auto-arranque a nivel de servicio: si la web deja de responder, ejecuta
`./atlas.sh start`.

## Estado de datos
`data/atlas.json`, `data/session.key` y `data/uploads/*` están en `.gitignore`
(solo se versiona `data/uploads/.gitkeep`). Para volver al estado inicial basta
con borrar `data/atlas.json` y `data/session.key` y reiniciar el servidor.

## Riesgos conocidos
- La persistencia es un único fichero JSON reescrito en cada cambio: no hay bloqueo
  entre procesos. Ejecutar una sola instancia del servidor.
