#!/usr/bin/env bash
# Arranca, para o consulta el estado de la web de ATLAS.
#
#   ./atlas.sh start    arranca el servidor en segundo plano
#   ./atlas.sh stop     lo detiene
#   ./atlas.sh status   dice si esta vivo y en que puerto
#   ./atlas.sh restart  lo reinicia (util si se queda colgado)
#
# El puerto 12000 es el que da URL publica en este entorno. Con `./atlas.sh start 3000`
# se puede arrancar en otro (3000 es el de por defecto de `npm start`).

set -u

PUERTO_DEFECTO=12000
PUERTO="${2:-$PUERTO_DEFECTO}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$RAIZ/data/server.log"
PIDFILE="$RAIZ/data/server.pid"

# Devuelve el PID del servidor si esta vivo, o nada.
pid_vivo() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

# Cuantos procesos node server.js hay, por si el pidfile se perdio.
pids_sueltos() {
  pgrep -f "node .*server\.js" 2>/dev/null || true
}

arrancar() {
  if pid="$(pid_vivo)"; then
    echo "Ya estaba arrancado (PID $pid). Usa './atlas.sh restart' para reiniciarlo."
    return 0
  fi

  local sueltos
  sueltos="$(pids_sueltos)"
  if [ -n "$sueltos" ]; then
    echo "Hay restos de una ejecucion anterior; los detengo primero."
    # shellcheck disable=SC2086
    kill $sueltos 2>/dev/null
    sleep 1
  fi

  mkdir -p "$RAIZ/data"
  cd "$RAIZ" || exit 1
  # setsid + nohup: el servidor sigue vivo aunque se cierre esta terminal.
  PORT="$PUERTO" setsid nohup node server.js >"$LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PIDFILE"

  # Esperar a que responda, hasta 10 segundos.
  local i
  for i in $(seq 1 20); do
    if curl -s -o /dev/null --max-time 2 "http://localhost:$PUERTO/"; then
      echo "Arrancado en el puerto $PUERTO (PID $pid)."
      echo "  Local:   http://localhost:$PUERTO"
      echo "  Publica: https://work-1-ywwbnyiskrzjshsp.prod-runtime.all-hands.dev/"
      echo "  Log:     $LOG"
      return 0
    fi
    sleep 0.5
  done

  echo "No respondio en 10 segundos. Ultimas lineas del log:"
  tail -20 "$LOG" 2>/dev/null
  return 1
}

parar() {
  local parado=0
  if pid="$(pid_vivo)"; then
    kill "$pid" 2>/dev/null
    parado=1
    echo "Detenido (PID $pid)."
  fi
  # Matar tambien cualquier resto que no este en el pidfile.
  local sueltos
  sueltos="$(pids_sueltos)"
  if [ -n "$sueltos" ]; then
    # shellcheck disable=SC2086
    kill $sueltos 2>/dev/null
    parado=1
  fi
  rm -f "$PIDFILE"
  [ "$parado" -eq 1 ] || echo "No habia ningun servidor arrancado."
}

estado() {
  if pid="$(pid_vivo)"; then
    echo "Arrancado (PID $pid)."
    curl -s -o /dev/null -w "  local:   http://localhost:%{remote_port} -> %{http_code}\n" \
      --max-time 5 "http://localhost:$PUERTO/" 2>/dev/null || true
  else
    echo "Parado."
    sueltos="$(pids_sueltos)"
    [ -n "$sueltos" ] && echo "  (hay un proceso suelto: $sueltos)"
  fi
  if [ -f "$LOG" ]; then
    echo "  ultimas lineas del log:"
    tail -3 "$LOG" | sed 's/^/    /'
  fi
}

case "${1:-}" in
  start)   arrancar ;;
  stop)    parar ;;
  restart) parar; arrancar ;;
  status)  estado ;;
  *)
    echo "Uso: ./atlas.sh {start|stop|restart|status} [puerto]"
    echo "  puerto por defecto: $PUERTO_DEFECTO"
    exit 1
    ;;
esac