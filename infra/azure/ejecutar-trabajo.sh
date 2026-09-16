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
# La salida es informativa: el veredicto es el estado de la ejecución. Leer Log Analytics
# puede fallar por permisos —la identidad del pipeline es colaboradora del grupo, no lectora
# de logs— y eso no debe tumbar el despliegue.
salida_ejecucion "$EJECUCION" 2>&1 | sed 's/^/     /' || true

[ "$ESTADO" = "Succeeded" ]
