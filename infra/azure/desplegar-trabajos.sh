#!/usr/bin/env bash
# Despliega los Jobs manuales de migración y de seed (infra/azure/trabajos.bicep, corte 3).
#
#   bash infra/azure/desplegar-trabajos.sh
#
# Cada Job levanta la imagen de SU servicio con la etiqueta que calcula `etiquetas.sh`: el
# último commit que lo tocó. El Job de un servicio que no cambió queda idéntico y no se mueve.
# Enseña el what-if y pide confirmación; con CONFIRMADO=si no pregunta.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

source "$DIR/etiquetas.sh"

if ! az deployment group show -g "$GRUPO" -n base -o none 2>/dev/null; then
  echo "No está desplegada la infraestructura base: ejecuta antes desplegar-base.sh" >&2
  exit 1
fi

ETIQUETAS="$(etiquetas_json)"
PARAMETROS=(sufijo="$SUFIJO" etiquetas="$ETIQUETAS" usuarioRegistro="$USUARIO_GHCR")

az deployment group what-if -g "$GRUPO" -n trabajos -f "$(ruta "$DIR/trabajos.bicep")" -p "${PARAMETROS[@]}"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Desplegar los Jobs con estas etiquetas? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n trabajos -f "$(ruta "$DIR/trabajos.bicep")" \
  -p "${PARAMETROS[@]}" -o none

echo
echo "Jobs desplegados:"
az deployment group show -g "$GRUPO" -n trabajos --query "properties.outputs.trabajos.value" -o tsv
echo "Etiquetas: $ETIQUETAS"
echo
echo "Siguiente: bash infra/azure/verificar-trabajos.sh"
