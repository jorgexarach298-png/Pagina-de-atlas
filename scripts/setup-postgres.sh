#!/usr/bin/env bash
# Arranca la base de datos del club y deja la web lista.
#
# El cluster NO vive en /var/lib (que se borra al recrear el contenedor) sino en
# /workspace/pgdata, que es un volumen persistente. Por eso los datos del club
# sobreviven a los reinicios. Este script es idempotente: se puede repetir sin
# miedo y solo crea lo que falte.
set -u

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="${1:-12000}"
PGDATA=/workspace/pgdata/data
PGBIN=/usr/lib/postgresql/17/bin
URL="postgresql://atlas:atlas-dev-pass@127.0.0.1:5432/atlas"

paso() { echo "==> $*"; }

esta_viva() { sudo -u postgres "$PGBIN/pg_isready" -h 127.0.0.1 -q 2>/dev/null; }

paso "Comprobando la base de datos"
if ! esta_viva; then
  if [ ! -x "$PGBIN/pg_ctl" ]; then
    paso "PostgreSQL no esta instalado; instalando"
    sudo apt-get update -qq >/dev/null 2>&1
    sudo apt-get install -y -qq postgresql-17 >/dev/null 2>&1 || {
      echo "No se pudo instalar PostgreSQL." >&2
      exit 1
    }
  fi

  # Al recrear el contenedor se reinstala PostgreSQL y el usuario `postgres`
  # puede recibir otro UID. Los ficheros siguen siendo del UID antiguo, asi que
  # sin este ajuste el cluster no arrancaria por permisos. `id -u postgres` solo
  # tiene sentido si el usuario ya existe (tras instalar el paquete lo crea).
  if sudo test -d "$PGDATA" && id -u postgres >/dev/null 2>&1; then
    UID_ACTUAL=$(id -u postgres)
    UID_DATOS=$(sudo stat -c %u "$PGDATA")
    if [ "$UID_ACTUAL" != "$UID_DATOS" ]; then
      paso "Ajustando el propietario de los datos ($UID_DATOS -> $UID_ACTUAL)"
      sudo chown -R postgres:postgres /workspace/pgdata
    fi
  fi

  # Ojo: /workspace/pgdata es 700 y de postgres, asi que el usuario normal no
  # puede leerlo. Hay que comprobar con sudo o `test -d` falla y el script cree
  # que no existe el cluster (y lo intentaria recrear encima de los datos).
  if ! sudo test -d "$PGDATA"; then
    paso "Creando el cluster en el volumen persistente ($PGDATA)"
    sudo mkdir -p /workspace/pgdata
    sudo chown postgres:postgres /workspace/pgdata
    sudo chmod 700 /workspace/pgdata
    sudo -u postgres "$PGBIN/initdb" -D "$PGDATA" -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1 || {
      echo "Fallo al crear el cluster." >&2
      exit 1
    }
    sudo -u postgres bash -c "
      CONF=$PGDATA/postgresql.conf
      sed -i \"s/^#\\?listen_addresses.*/listen_addresses = '127.0.0.1'/\" \$CONF
      sed -i \"s/^#\\?unix_socket_directories.*/unix_socket_directories = '\/tmp'/\" \$CONF
    "
  fi

  paso "Arrancando el cluster"
  sudo -u postgres "$PGBIN/pg_ctl" -D "$PGDATA" -l /workspace/pgdata/server.log start >/dev/null 2>&1
  for _ in $(seq 1 30); do
    esta_viva && break
    sleep 0.5
  done
fi
esta_viva || { echo "La base de datos no responde." >&2; exit 1; }

paso "Asegurando el usuario y las bases de datos"
sudo -u postgres psql -h 127.0.0.1 -tAc \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas') THEN
       CREATE ROLE atlas LOGIN PASSWORD 'atlas-dev-pass';
     END IF;
   END \$\$;" >/dev/null 2>&1

for base in atlas atlas_test; do
  if ! sudo -u postgres psql -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname = '$base'" | grep -q 1; then
    paso "Creando la base de datos $base"
    sudo -u postgres createdb -h 127.0.0.1 -O atlas "$base"
  fi
  # PostgreSQL 15+ no da permiso de creacion en `public`: sin esto el servidor
  # falla con "no schema has been selected to create in".
  sudo -u postgres psql -h 127.0.0.1 -d "$base" -qc \
    "GRANT ALL ON SCHEMA public TO atlas; ALTER SCHEMA public OWNER TO atlas;" >/dev/null 2>&1
done

paso "Comprobando si hay que importar data/atlas.json"
HAY_TABLAS=$(sudo -u postgres psql -h 127.0.0.1 -d atlas -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'players'" 2>/dev/null)
if [ "$HAY_TABLAS" = "0" ] && [ -f "$RAIZ/data/atlas.json" ]; then
  paso "Importando los datos del club"
  (cd "$RAIZ" && DATABASE_URL="$URL" node scripts/migrate-json-to-db.js | tail -8)
else
  paso "La base de datos ya tiene datos; no se toca"
fi

paso "Arrancando la web en el puerto $PUERTO"
cd "$RAIZ" && ./atlas.sh start "$PUERTO"
