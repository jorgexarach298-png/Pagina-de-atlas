#!/usr/bin/env bash
# Prepara PostgreSQL en un contenedor recien reiniciado y deja la web lista.
#
# En este entorno el contenedor se recrea de vez en cuando y se lleva por delante
# el cluster: hay que reinstalar el servidor y volver a crear el usuario y las
# bases de datos. Los datos del club sobreviven en data/atlas.json, asi que al
# final se reimportan. Es idempotente: se puede repetir sin miedo.
set -u

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="${1:-12000}"
USUARIO=atlas
CLAVE=atlas-dev-pass
URL="postgresql://$USUARIO:$CLAVE@127.0.0.1:5432/atlas"
URL_TEST="postgresql://$USUARIO:$CLAVE@127.0.0.1:5432/atlas_test"

paso() { echo "==> $*"; }

paso "Comprobando si el cluster esta en marcha"
if ! sudo -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1; then
  if [ ! -d /usr/lib/postgresql ]; then
    paso "PostgreSQL no esta instalado; instalando"
    sudo apt-get update -qq >/dev/null 2>&1
    sudo apt-get install -y -qq postgresql-17 >/dev/null 2>&1 || {
      echo "No se pudo instalar PostgreSQL." >&2
      exit 1
    }
  fi
  paso "Arrancando el cluster"
  sudo pg_ctlcluster 17 main start >/dev/null 2>&1
  for _ in $(seq 1 30); do
    sudo -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1 && break
    sleep 0.5
  done
fi
sudo -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1 || {
  echo "El cluster no responde." >&2
  exit 1
}

paso "Creando el usuario $USUARIO"
sudo -u postgres psql -tAc \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$USUARIO') THEN
       CREATE ROLE $USUARIO LOGIN PASSWORD '$CLAVE';
     END IF;
   END \$\$;" >/dev/null

for base in atlas atlas_test; do
  paso "Creando la base de datos $base"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$base'" | grep -q 1; then
    sudo -u postgres createdb -O "$USUARIO" "$base"
  fi
  # PostgreSQL 15+ ya no da permiso de creacion en `public` a nadie: sin esto el
  # servidor falla con "no schema has been selected to create in".
  sudo -u postgres psql -d "$base" -qc "GRANT ALL ON SCHEMA public TO $USUARIO;" >/dev/null
  sudo -u postgres psql -d "$base" -qc "ALTER SCHEMA public OWNER TO $USUARIO;" >/dev/null
done

paso "Comprobando si hay que reimportar los datos"
JUGADORES=$(sudo -u postgres psql -d atlas -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'players'" 2>/dev/null)
if [ "$JUGADORES" = "0" ] && [ -f "$RAIZ/data/atlas.json" ]; then
  paso "Importando data/atlas.json"
  (cd "$RAIZ" && DATABASE_URL="$URL" node scripts/migrate-json-to-db.js | tail -8)
else
  paso "La base de datos ya tiene tablas; no se toca"
fi

paso "Arrancando la web en el puerto $PUERTO"
cd "$RAIZ" && DATABASE_URL="$URL" ./atlas.sh start "$PUERTO"
