#!/usr/bin/env bash
# Lanza un Job manual, espera a que termine y muestra lo que escribió.
#
#   bash infra/azure/ejecutar-trabajo.sh migrar-identidad
#
# Sale con 0 sólo si la ejecución termina en Succeeded. La salida llega de Log Analytics,
# que tarda unos minutos en recibirla.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"
source "$DIR/lib-trabajos.sh"

TRABAJO="${1:-}"
if [ -z "$TRABAJO" ]; then
  echo "Uso: bash infra/azure/ejecutar-trabajo.sh <job>" >&2
  echo "  Jobs: migrar-identidad, migrar-inmuebles, migrar-contratos, migrar-financiero," >&2
  echo "        migrar-notificaciones, seed-identidad" >&2
  exit 1
fi

EJECUCION="$(iniciar_trabajo "$TRABAJO")"
echo "== $TRABAJO: ejecución $EJECUCION"
ESTADO="$(esperar_ejecucion "$TRABAJO" "$EJECUCION")"
echo "   estado: $ESTADO"
echo "   salida:"
salida_ejecucion "$EJECUCION" | sed 's/^/     /'

[ "$ESTADO" = "Succeeded" ]
