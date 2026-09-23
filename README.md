# ATLAS · FC27 Clubes Pro

Web oficial del club **ATLAS** para EA SPORTS FC 27 Clubes Pro: plantilla con cartas
individuales, pizarra táctica, check-in de convocatoria e historia del club.

## Puesta en marcha

Los datos del club viven en **PostgreSQL** (compatible con **Supabase**). Para arrancar:

```bash
npm install
cp .env.example .env     # y pon tu DATABASE_URL
npm start                # http://localhost:3000
```

El servidor usa el puerto de la variable `PORT` (por defecto `3000`) y escucha en
`0.0.0.0`, así que también es accesible desde el túnel o la red local:

```bash
PORT=12000 npm start
```

Al arrancar por primera vez, si la base de datos está vacía, el servidor **crea el
esquema y siembra la plantilla** del club (los 16 jugadores y la cuenta del mánager).
No hace falta ejecutar nada más.

### Base de datos en Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **Connect → Connection string → URI**, copia la cadena del *pooler* (puerto
   `6543`, la recomendada para una web) y pégala en `.env`:

   ```
   DATABASE_URL=postgresql://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

3. Arranca el servidor. El esquema se crea solo en el esquema `public`.

Con las variables estándar de PostgreSQL (`PGHOST`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`) también funciona, sin necesidad de `DATABASE_URL`.

### Pasar los datos que ya tenías en JSON

Si venís de la versión anterior (con `data/atlas.json`), hay un migrador que conserva
jugadores, fotos, estadísticas, papeletas, check-ins, historia, sesiones abiertas y el
secreto de las cookies. Es idempotente: se puede repetir sin duplicar nada.

```bash
DATABASE_URL="postgresql://...supabase..." npm run migrate
```

**Las fotos siguen en `data/uploads/`** y se sirven desde `/uploads`. La base de datos
guarda la ruta, no la imagen; mover los ficheros a un almacenamiento en la nube
(Supabase Storage, S3) sería el paso siguiente.

### Si el contenedor se reinicia (solo en este entorno de desarrollo)

El contenedor se recrea de vez en cuando y **se lleva por delante PostgreSQL**, porque
sus datos viven en `/var/lib`, que es efímero. Para que eso no vuelva a pasar, la base
de datos del club vive en **`/workspace/pgdata`**, que es un volumen persistente: los
datos sobreviven a los reinicios igual que el código.

Un único comando deja todo en marcha (instala lo que falte, crea el cluster si no
existe, levanta el usuario y las bases y arranca la web):

```bash
./atlas.sh start              # ya arranca la base de datos solo si esta parada
./scripts/setup-postgres.sh   # o explicitamente, si prefieres ver los pasos
```

Es idempotente y **nunca pisa los datos**: solo importa `data/atlas.json` si la base
de datos no tiene todavía tablas.

Con **Supabase** configurado esto sobra: los datos viven fuera del contenedor y basta
con `./atlas.sh start`. De hecho es lo recomendado para producción, porque en la nube
el volumen local puede no existir.

## Accesos

| Cuenta | ID | Contraseña |
| --- | --- | --- |
| Administrador | `admin` | `123456780` |
| Mánager que además juega | `RodriKTV` | `mk3Nphp2` |
| Cada miembro | su ID de la lista | la que elija al activar su cuenta |

Los miembros **no** tienen contraseña inicial. Cada uno entra en **Registrarme** y
activa su cuenta escribiendo su ID de la plantilla (por ejemplo `tonii_gk`) y la
contraseña que quiera; a partir de ahí entra con ese mismo ID. Solo se admiten los
IDs que ya están en la plantilla, así que nadie de fuera puede crearse una cuenta.
El formulario muestra los IDs que siguen sin activar.

`admin` es la cuenta técnica: sirve para gestionar y no juega, así que no aparece
en la Plantilla ni firma check-in. `RodriKTV` es mánager **y** jugador a la vez:
conserva su dorsal y su posición, sale en su carta y firma su propio check-in.
Para dar permisos a alguien sin sacarlo de la plantilla:

```bash
node scripts/set-credentials.js <ID> <contraseña> --admin
```

Si alguien olvida su contraseña, el administrador abre su ficha en **Plantilla** (✎)
y pulsa **Restablecer cuenta**: el ID vuelve a la lista de registro y el miembro elige
una contraseña nueva.

### Variables de entorno

| Variable | Para qué sirve |
| --- | --- |
| `DATABASE_URL` / `ATLAS_DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `PORT` | Puerto del servidor (por defecto `3000`) |
| `SESSION_SECRET` | Secreto de las cookies. Si no se define, se guarda uno en la base de datos |
| `ATLAS_DB_SSL` | Fuerza TLS (`1`) aunque la cadena no lo pida |
| `ATLAS_DB_POOL` | Máximo de conexiones del pool (por defecto `5`) |
| `ATLAS_ADMIN_USER` / `ATLAS_ADMIN_PASSWORD` | Cuenta de mánager inicial |
| `ATLAS_TZ` | Zona horaria del «día de hoy» (por defecto `Europe/Madrid`) |
| `ATLAS_DATA_DIR` | Directorio de fotos y del `.env` local (por defecto `data/`) |

### Pruebas

Las pruebas necesitan su **propia** base de datos: se vacía antes de cada suite, así
que no deben apuntar a la del club.

```bash
createdb atlas_test    # solo la primera vez
npm test               # API + interfaz
npm run test:api
npm run test:ui
```

Por defecto usan `postgresql://atlas:atlas-dev-pass@127.0.0.1:5432/atlas_test`; se puede
cambiar con `ATLAS_TEST_DATABASE_URL`.

## Qué incluye

**Inicio** — identidad del club, contadores de convocatoria del día y últimos hitos.

**Plantilla** — cada miembro aparece como una carta con su dorsal, posición, ID, foto y
sus estadísticas (partidos jugados, goles, asistencias) junto a la nota media que le han
puesto sus compañeros. Las cartas de quien todavía no ha activado su cuenta llevan la marca
**Sin cuenta**. El administrador ve el botón **📷 Foto** sobre cada carta para subir o
reemplazar la imagen, y **✎** para editar dorsal, posición, nombre, ID y contraseña,
restablecer la cuenta, o eliminar al miembro. También puede crear miembros nuevos.

**Pizarra** — arrastra cartas del banquillo al campo para dibujar la táctica; cada ficha
muestra la foto y el nombre debajo. El mánager guarda el borrador con **Guardar borrador**,
usa las ayudas **Colocar 4-3-3** y **Vaciar campo**, y publica el once del día con
**Publicar once del día**. Una vez publicado, el resto de la plantilla lo ve en modo lectura
y puede **puntuar del 1 al 11** a los que jugaron: cada nota solo se puede usar una vez en
la misma papeleta y no se puede votar a uno mismo. El mánager anota después los goles y
asistencias de cada uno desde el mismo panel, y esos números alimentan las estadísticas de
la Plantilla.

**Check-in** — cada miembro entra con su ID y marca si estará en el partido. La fila se pone
en verde si vendrá, rojo si no puede, ámbar si llega tarde y azul si duda. Hay contadores,
mensaje opcional y un seleccionador de fecha con registro de sesiones anteriores.
El administrador puede corregir el estado de cualquiera.

**Historia** — línea temporal de entradas con fecha, relato e imagen, que el administrador
publica, edita, destaca o elimina.

## Estructura

```
server.js              Servidor Express y API REST
lib/db.js              Conexión a PostgreSQL y transacciones
lib/db-schema.js       Esquema de las tablas
lib/store.js           Consultas del club: plantilla, pizarra, check-in, historia
lib/session-store.js   Sesiones en la base de datos
lib/uploads.js         Guardado de fotos (data URL -> fichero)
lib/config.js          Rutas locales y error HTTP común
lib/env.js             Lector del fichero .env
public/index.html      Contenedor de la aplicación
public/css/styles.css  Diseño (noche de estadio + cartas tipo FUT)
public/js/app.js       Router, sesión y cabecera
public/js/views/       Vistas: home, roster, pizarra, checkin, history
public/img/escudo.png  Escudo del club (cabecera, portada y favicon)
tests/                 Pruebas de API y de interfaz
scripts/               Migrador del JSON antiguo a la base de datos
data/                  Fotos subidas y ficheros locales
.env.example           Plantilla de configuración (cópiala a .env)
```

Los datos del club se guardan en **PostgreSQL**. Las fotos son la excepción: siguen
siendo ficheros en `data/uploads/` y la base de datos guarda su ruta.

## Estructura de la base de datos

| Tabla | Qué guarda |
| --- | --- |
| `players` | Miembros, dorsales, posiciones, fotos y credenciales |
| `lineup` / `lineup_items` | Borrador de la pizarra: formación y fichas sobre el campo |
| `matches` | Días publicados, formación, nota y portería a cero |
| `match_items` | Quién jugó cada día y dónde estaba en el campo |
| `match_stats` | Goles y asistencias por jugador y partido |
| `match_ballots` / `match_scores` | Papeletas: quién votó y qué nota puso a quién |
| `checkin_days` / `checkins` | Días de convocatoria y la respuesta de cada miembro |
| `history` | Entradas de la historia del club |
| `settings` | Datos sueltos: identidad del club y secreto de sesión |
| `sessions` | Sesiones abiertas (por eso un reinicio no expulsa a nadie) |

Borrar un jugador arrastra sus fichas, estadísticas, papeletas y check-ins: las claves
ajenas están declaradas en cascada. Para empezar de cero, vacía las tablas (o crea otra
base de datos) y el servidor volverá a sembrar la plantilla al arrancar.

## Identidad visual

La paleta sale del escudo del club (`public/img/escudo.png`) y se define en las
variables CSS al principio de `public/css/styles.css`:

| Uso | Variable | Color |
| --- | --- | --- |
| Fondo (azul marino) | `--ink-900` … `--ink-400` | `#070b13` … `#26344a` |
| Acento de marca (oro) | `--accent` | `#e3b85c` |
| Oro claro | `--gold` | `#f0cd7a` |
| Azul acero | `--sky` | `#4a90c4` |
| Carmesí | `--danger` | `#e05566` |
| Ámbar | `--amber` | `#e8a33d` |
| Texto (marfil) | `--paper` | `#f2ecdd` |
| Confirmado (verde) | `--ok` | `#4caf72` |

El verde (`--ok`) no forma parte del escudo: se reserva para los estados positivos
(check-in «Estará», plazas confirmadas) y así el dorado queda como color de club.
