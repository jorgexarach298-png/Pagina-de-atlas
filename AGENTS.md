# AGENTS.md

## Proyecto
Web oficial del club ATLAS (EA SPORTS FC 27 Clubes Pro). Interfaz en español.
Node/Express + SPA en JavaScript puro (sin build step ni frameworks) +
**PostgreSQL** (compatible con Supabase).

## Comandos
- `npm install` — instalar dependencias.
- `npm start` — arrancar en http://localhost:3000 (`PORT` configurable).
- `npm run migrate` — volcar el antiguo `data/atlas.json` a la base de datos.
- `npm test` — suite completa (API + interfaz). Ver la sección «Pruebas».

## Base de datos
- PostgreSQL. La conexión sale de `DATABASE_URL` / `ATLAS_DATABASE_URL`, o de las
  variables estándar (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`). `.env` se lee
  al arrancar (`lib/env.js`); ver `.env.example`.
- `lib/db.js` — pool, `query()`, `transaction()` y `ensureSchema()`.
  - Se redefinen los *type parsers* de `pg`. **DATE se devuelve como cadena**
    (`YYYY-MM-DD`), porque todo el código compara fechas como texto. TIMESTAMP y
    TIMESTAMPTZ se normalizan a ISO: PostgreSQL escribe el desfase como `+00` y
    `new Date()` solo acepta `+00:00`, así que hay que arreglarlo antes de parsear.
  - `double precision` en `x`/`y` (no `real`) para no perder precisión al guardar.
- `lib/db-schema.js` — la DDL, en un único sitio, para que las pruebas creen
  exactamente la misma estructura.
- Las claves ajenas van **en cascada**: borrar un jugador o retirar un partido limpia
  fichas, estadísticas, papeletas y check-ins sin código extra.
- `lib/store.js` — única fuente de datos, **todo asíncrono**. Mantiene la misma forma
  de objeto que la versión JSON, así que el frontend no cambió.
  - `init()` crea el esquema y, si `players` está vacía, siembra la plantilla.
  - El `session_secret` se guarda en `settings`: en la nube el disco es efímero y un
    secreto nuevo en cada arranque invalidaría todas las sesiones.

## Pruebas
- `tests/run.js` levanta un servidor por suite en el puerto `4123` contra una base de
  datos **aparte** (`ATLAS_TEST_DATABASE_URL`, por defecto `atlas_test`), que se vacía
  (`DROP SCHEMA public CASCADE`) antes de cada suite. Nunca apuntar a la base del club.
- `tests/api.test.js` — API con `fetch` y gestión manual de la cookie de sesión.
  **La cookie se llama `atlas.sid`** (no `connect.sid`): usar el nombre equivocado
  hace que todas las peticiones autenticadas devuelvan 401. Tiene un helper `sql()`
  para comprobar en la base de datos lo que no se ve por la API.
- `tests/ui.test.js` — Puppeteer con el Chromium del sistema (`/usr/bin/chromium`,
  o `CHROME_PATH`). Tres trampas que cuestan tiempo:
  - `page.goto()` al **mismo hash** no recarga la SPA; hay que añadir algo a la URL
    (p. ej. `#/pizarra?date=...`) para forzar el re-render.
  - Los modales se **apilan** en el DOM (`confirmAction` sobre el modal de edición),
    así que hay que leer el **último** `.modal`, no el primero.
  - Los `ElementHandle` de listas que se repintan (el banquillo) quedan obsoletos:
    volver a consultarlos en cada iteración.

## Arquitectura
- `server.js` — Express, sesiones (`express-session`), guardas `requireAdmin` /
  `requireAuth`, API REST bajo `/api/*` y servido estático de `public/` y `/uploads`.
  - `buildApp()` es **async** y monta los middlewares en orden: sesión → estáticos →
    rutas → respaldo de la SPA → errores. Las rutas se registran dentro de
    `registerRoutes()`, y no al cargar el módulo, porque el middleware de sesión
    necesita un secreto que se lee de la base de datos: hasta que no está, ninguna
    ruta debe existir (Express atiende en orden de registro).
  - `express-session` se instala dentro de `buildApp()`, no en el cuerpo del módulo.
    Si se registra después de las rutas, no se aplica a ninguna y **todo** devuelve 401.
  - El servidor no escucha hasta que `store.init()` termina: conectar y crear el
    esquema son operaciones de red.
- `lib/store.js` — única fuente de datos. Exporta CRUD y utilidades de fecha
  (`todayISO()`, `dateInTimeZone()`). La zona horaria por defecto es `Europe/Madrid`.
  - **Cuentas:** los miembros no tienen contraseña inicial. `claimAccount()` activa una
    cuenta desde su ID de plantilla y `resetAccount()` la devuelve a ese estado.
    `defaultPasswordFor()` se conserva solo para detectar cuentas antiguas en la
    migración; no se asigna a nadie.
  - **Partidos:** `matches` guarda un partido por fecha, con `match_items` (el once),
    `match_ballots`/`match_scores` (papeletas de notas 1-11), `match_stats`
    (goles/asistencias) y `clean_sheet` (portería a cero del equipo). `rosterStats()`
    calcula PJ, goles, asistencias y media de notas, y es lo que alimenta las cartas.
  - **Porterías imbatidas:** `clean_sheet` es del partido, no de cada jugador. Suma solo
    a `CLEAN_SHEET_POSITIONS` (`POR`, `DFC`) y solo si el jugador entró en el once. Las
    cartas de esas dos posiciones muestran una columna «Imbatidas»; el resto no, porque
    `cleanSheetsEligible` va en las estadísticas de cada jugador.
- `lib/session-store.js` — almacén de sesiones en la tabla `sessions`, para que un
  reinicio del servidor no expulse a quien estaba dentro. Antes era un fichero
  (`data/sessions.json`) con volcado diferido y `touch()` que solo reescribía cada 12 h;
  con PostgreSQL eso sobra: cada `touch()` es un `UPDATE` de una fila, y el
  `session_secret` vive en `settings` para que las cookies sobrevivan al reinicio.
- `lib/uploads.js` — convierte data URLs de imagen en ficheros dentro de `data/uploads/`
  y devuelve la ruta pública `/uploads/<archivo>`. La base de datos guarda la ruta, no
  la imagen: mover los ficheros a un almacenamiento en la nube está pendiente.
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
- **Nunca llamar a `close()` a secas** en un modal: resuelve a `window.close()` y el
  navegador cierra la pestaña, lo que parece que la web te ha expulsado. Los modales
  devuelven un manejador con `.close()`; usar ese (`handle.close()`).

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

## Formulario de acceso (`public/js/auth.js`)
- `createAuthForm()` se monta en **dos** sitios: el modal de la cabecera
  (`app.js`) y la página de check-in (`views/checkin.js`). Dentro del modal los
  botones los pone `openModal` en su pie, así que ahí se llama sin `withButton`.
  **Fuera del modal no hay pie**: hay que pasar `withButton: true` o el formulario
  se queda sin forma de enviarse. Ese fue el fallo de «no aparece el botón»: el
  check-in montaba el formulario a secas.
- Al añadir un sitio nuevo que monte este formulario, pasar `withButton: true`
  salvo que ya haya un pie propio del que colgar el botón.
- Las pruebas de UI **no** cubrían el check-in; ahora sí (bloque «Check-in desde
  fuera del modal» en `tests/ui.test.js`), y usan un contexto de navegador sin
  cookies para verlo como lo ve alguien sin sesión.

## Autenticación
- Admin por defecto: `admin` / `atlas-admin` (configurable con `ATLAS_ADMIN_USER`
  y `ATLAS_ADMIN_PASSWORD`). Solo se usa al sembrar la base de datos la primera vez.
  En la instalación del club las credenciales ya están cambiadas: ver «Accesos» del
  `README.md`. Para fijarlas en cualquier entorno: `node scripts/set-credentials.js`.
- Los miembros **no** tienen contraseña inicial: activan su cuenta desde «Registrarme»
  con su ID de plantilla. Solo se admiten IDs que ya existan, así que
  `POST /api/auth/register` no crea jugadores nuevos (`claimAccount()`).
- **`is_admin` y `is_player` son cosas distintas.** `is_admin` da acceso al panel;
  `is_player` decide si alguien es jugador (sale en la Plantilla, en la Pizarra y
  firma check-in). Antes solo existía `is_admin` y el roster filtraba con él, así que
  dar permisos a un jugador lo borraba de su propia plantilla. Un mánager que juega
  lleva `is_admin = true` **y** `is_player = true`; la cuenta técnica `admin` lleva
  `is_player = false`. Al filtrar el roster, usar `is_player`, nunca `is_admin`.
- El secreto de sesión se guarda en `settings` (no en `data/session.key`) para que los
  inicios de sesión sobrevivan a un reinicio incluso con disco efímero; se puede
  sobrescribir con `SESSION_SECRET`.

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
`node server.js` suelto (sin pidfile) lo detiene antes de arrancar.

**Ojo:** el servidor no se relanza solo cuando el contenedor se reinicia. Si la
web deja de responder, ejecuta `./atlas.sh start`. El código sobrevive a esos
reinicios y los datos están en PostgreSQL, así que tampoco se pierden.

`atlas.sh` avisa si no encuentra `DATABASE_URL` ni `.env`: sin base de datos el
servidor no arranca. Espera hasta 30 s a que responda, porque conectar a una base
de datos en la nube puede tardar más que en local.

### Recuperarse de un reinicio del contenedor

En este entorno el contenedor se recrea de vez en cuando y **se lleva por delante
PostgreSQL**: desaparece el binario y el clúster. La clave está en dónde se guardan los
datos:

- `/workspace` es un **volumen ext4 persistente** (`/dev/nvme0n2`): sobrevive.
- `/` es un overlay **efímero**: se resetea, y con él `/var/lib/postgresql`.

Por eso el clúster del club **no** vive en `/var/lib/postgresql`, sino en
**`/workspace/pgdata/data`**, creado con `initdb` directamente ahí. El usuario
`postgres` recibe `chown` de ese directorio para poder escribir.

```
./atlas.sh start                 # arranca la BD sola si esta parada
./scripts/setup-postgres.sh      # o los pasos en detalle
./scripts/setup-postgres.sh 3000 # opcional: otro puerto
```

El script es idempotente y **nunca pisa los datos**: solo importa `data/atlas.json` si
la base de datos no tiene tablas. Dos detalles que costaron un fallo cada uno:

- `/workspace/pgdata` es `700` y de `postgres`, así que el usuario normal **no puede
  leerlo**: hay que comprobar con `sudo test -d`, no `test -d`. Sin eso el script cree
  que no existe el clúster e intenta recrearlo encima de los datos.
- Al reinstalar PostgreSQL, el usuario `postgres` puede recibir **otro UID** y los
  ficheros siguen siendo del antiguo: el script compara UIDs y hace `chown -R` si no
  coinciden.

Si ya no queda `data/atlas.json` (porque el club trabaja solo contra la base de datos),
solo se puede restaurar desde una copia. Por eso, para producción, lo suyo es apuntar
el `.env` a Supabase y no depender del volumen del contenedor.

## Estado de datos
Los datos del club viven en PostgreSQL. Solo quedan ficheros locales en `data/`:
`data/uploads/*` (fotos), `data/session.key` (respaldo del secreto si la base de datos
no admite escritura), `server.log` y `server.pid`. El antiguo `data/atlas.json` y
`data/sessions.json` ya no se usan: se migran con `npm run migrate`.

## Riesgos conocidos
- Ya no hay un fichero JSON reescrito entero: cada cambio escribe solo sus filas, así
  que varias instancias del servidor pueden convivir sobre la misma base de datos.
- Las **fotos** siguen siendo ficheros locales, no filas de la base de datos. Con el
  servidor en la nube y disco efímero, `data/uploads/` se pierde al redeploy: para
  producción habría que moverlas a Supabase Storage o S3.
- El plan gratuito de Supabase limita el número de conexiones: mantener
  `ATLAS_DB_POOL` bajo (5 por defecto) y usar la cadena del *pooler* (puerto 6543).
