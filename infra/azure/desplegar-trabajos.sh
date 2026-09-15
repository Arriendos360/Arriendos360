#!/usr/bin/env bash
# Despliega los Jobs manuales de migración y de seed (infra/azure/trabajos.bicep, corte 3).
#
#   bash infra/azure/desplegar-trabajos.sh <etiqueta>
#
# <etiqueta> es el commit de `main` con el que el workflow «Imágenes» publicó en GHCR; lo
# muestra el resumen de esa ejecución. Enseña el what-if y pide confirmación; con
# CONFIRMADO=si no pregunta.
#
# Crear los Jobs no cuesta: se cobra lo que corren, dentro de la concesión gratuita mensual.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

ETIQUETA="${1:-}"
if [ -z "$ETIQUETA" ]; then
  echo "Uso: bash infra/azure/desplegar-trabajos.sh <etiqueta>" >&2
  echo "  <etiqueta>: el commit de main que publicó el workflow «Imágenes»." >&2
  exit 1
fi
if ! az deployment group show -g "$GRUPO" -n base -o none 2>/dev/null; then
  echo "No está desplegada la infraestructura base: ejecuta antes desplegar-base.sh" >&2
  exit 1
fi

PARAMETROS=(sufijo="$SUFIJO" etiqueta="$ETIQUETA" usuarioRegistro="$USUARIO_GHCR")

az deployment group what-if -g "$GRUPO" -n trabajos -f "$DIR/trabajos.bicep" -p "${PARAMETROS[@]}"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Desplegar los Jobs con la etiqueta $ETIQUETA? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n trabajos -f "$DIR/trabajos.bicep" \
  -p "${PARAMETROS[@]}" -o none

echo
echo "Jobs desplegados con la etiqueta $ETIQUETA:"
az deployment group show -g "$GRUPO" -n trabajos --query "properties.outputs.trabajos.value" -o tsv
echo
echo "Siguiente: bash infra/azure/verificar-trabajos.sh"
