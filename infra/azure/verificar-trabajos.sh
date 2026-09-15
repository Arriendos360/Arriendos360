#!/usr/bin/env bash
# Verificación del corte 3. No cambia la infraestructura, pero SÍ ejecuta los Jobs:
#
#   bash infra/azure/verificar-trabajos.sh
#
# Dos rondas con los seis Jobs a la vez. En la primera todos tienen que terminar en
# Succeeded, apliquen algo o no. En la segunda también, y además cada migración tiene que
# decir «sin migraciones pendientes» y el seed encontrar ya creados los tres usuarios de
# demostración. Así la prueba vale tanto sobre una base vacía como sobre una ya migrada.
#
# Doce ejecuciones cortas, dentro de la concesión gratuita. Tarda unos diez minutos, casi
# todo esperando a Log Analytics.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"
source "$DIR/lib-trabajos.sh"

TRABAJOS=(migrar-identidad migrar-inmuebles migrar-contratos migrar-financiero migrar-notificaciones seed-identidad)
USUARIOS_DEMO=(propietario@arriendos360.test inquilino@arriendos360.test ambos@arriendos360.test)

FALLOS=0
ok() { printf '  ✔ %s\n' "$*"; }
fallo() { printf '  ✘ %s\n' "$*"; FALLOS=$((FALLOS + 1)); }

# ronda <número>: lanza los seis Jobs, espera a que terminen y deja en EJECUCIONES y ESTADOS,
# en el orden de TRABAJOS, el nombre y el estado final de cada ejecución.
ronda() {
  local i
  echo "== Ronda $1"
  EJECUCIONES=()
  ESTADOS=()
  for i in "${!TRABAJOS[@]}"; do
    EJECUCIONES[i]="$(iniciar_trabajo "${TRABAJOS[i]}")"
    echo "  lanzado ${TRABAJOS[i]} → ${EJECUCIONES[i]}"
  done
  for i in "${!TRABAJOS[@]}"; do
    ESTADOS[i]="$(esperar_ejecucion "${TRABAJOS[i]}" "${EJECUCIONES[i]}")"
    if [ "${ESTADOS[i]}" = "Succeeded" ]; then
      ok "${TRABAJOS[i]}: Succeeded"
    else
      fallo "${TRABAJOS[i]}: ${ESTADOS[i]}"
    fi
  done
}

ronda 1
FALLOS_PRIMERA=$FALLOS

ronda 2

echo "== Salida de la ronda 2 (Log Analytics)"
for i in "${!TRABAJOS[@]}"; do
  trabajo="${TRABAJOS[i]}"
  salida="$(salida_ejecucion "${EJECUCIONES[i]}")"
  if [ -z "$salida" ]; then
    fallo "$trabajo: sin salida en Log Analytics"
    continue
  fi
  case "$trabajo" in
    migrar-*)
      if grep -q "sin migraciones pendientes" <<<"$salida"; then
        ok "$trabajo relanzado: sin migraciones pendientes"
      else
        fallo "$trabajo relanzado aplicó algo o falló:"
        sed 's/^/      /' <<<"$salida"
      fi
      ;;
    seed-identidad)
      for email in "${USUARIOS_DEMO[@]}"; do
        if grep -q "$email" <<<"$salida"; then ok "usuario de demostración $email"; else fallo "no aparece $email"; fi
      done
      repetidos="$(grep -o "ya exist" <<<"$salida" | wc -l | tr -d ' ')"
      if [ "$repetidos" = "3" ]; then
        ok "seed relanzado: los tres ya existían"
      else
        fallo "seed relanzado: $repetidos de 3 ya existían"
        sed 's/^/      /' <<<"$salida"
      fi
      ;;
  esac
done

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Corte 3 verificado."
else
  [ "$FALLOS_PRIMERA" -gt 0 ] && echo "Ver la salida de la ronda 1 con: bash infra/azure/ejecutar-trabajo.sh <job>"
  echo "$FALLOS comprobación(es) fallida(s)."
fi
exit "$FALLOS"
