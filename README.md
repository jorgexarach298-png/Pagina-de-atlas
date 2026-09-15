# ATLAS · FC27 Clubes Pro

Web oficial del club **ATLAS** para EA SPORTS FC 27 Clubes Pro: plantilla con cartas
individuales, pizarra táctica, check-in de convocatoria e historia del club.

## Puesta en marcha

```bash
npm install
npm start          # http://localhost:3000
```

El servidor usa el puerto de la variable `PORT` (por defecto `3000`).

## Accesos

| Cuenta | ID | Contraseña inicial |
| --- | --- | --- |
| Administrador | `admin` | `atlas-admin` |
| Cada miembro | su ID de la lista | `atlas` + su dorsal (p. ej. `atlas9`) |

Cada miembro cambia su contraseña desde **Mi cuenta** (arriba a la derecha) al entrar.
El administrador también puede asignar contraseñas desde la vista Plantilla.

Variables de entorno opcionales: `PORT`, `SESSION_SECRET`, `ATLAS_ADMIN_USER`,
`ATLAS_ADMIN_PASSWORD`, `ATLAS_TZ` (por defecto `Europe/Madrid`).

## Qué incluye

**Inicio** — identidad del club, contadores de convocatoria del día y últimos hitos.

**Plantilla** — cada miembro aparece como una carta con su dorsal, posición, ID y foto.
El administrador ve el botón **📷 Foto** sobre cada carta para subir o reemplazar la imagen,
y **✎** para editar dorsal, posición, nombre, ID y contraseña, o eliminar al miembro.
También puede crear miembros nuevos.

**Pizarra** — arrastra cartas del banquillo al campo para dibujar la táctica; cada ficha
muestra la foto y el nombre debajo. Los cambios se guardan con **Guardar alineación** y el
resto de la plantilla la ve en modo lectura. Incluye las ayudas **Colocar 4-3-3** y **Vaciar campo**.

**Check-in** — cada miembro entra con su ID y marca si estará en el partido. La fila se pone
en verde si vendrá, rojo si no puede, ámbar si llega tarde y azul si duda. Hay contadores,
mensaje opcional y un seleccionador de fecha con registro de sesiones anteriores.
El administrador puede corregir el estado de cualquiera.

**Historia** — línea temporal de entradas con fecha, relato e imagen, que el administrador
publica, edita, destaca o elimina.

## Estructura

```
server.js              Servidor Express y API REST
lib/store.js           Persistencia JSON, plantilla, check-in, historia
lib/uploads.js         Guardado de fotos (data URL -> fichero)
public/index.html      Contenedor de la aplicación
public/css/styles.css  Diseño (noche de estadio + cartas tipo FUT)
public/js/app.js       Router, sesión y cabecera
public/js/views/       Vistas: home, roster, pizarra, checkin, history
data/atlas.json        Base de datos (se crea sola en el primer arranque)
data/uploads/          Fotos subidas
```

Los datos se guardan en `data/atlas.json`. Para reiniciar la web a su estado inicial
(plantilla original, sin fotos ni check-ins) basta con borrar ese fichero y reiniciar.
