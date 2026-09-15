#!/usr/bin/env bash
# Despliega infra/azure/base.bicep (corte 2). Desde Cloud Shell, después de bootstrap.sh:
#
#   bash infra/azure/desplegar-base.sh
#
# Muestra qué va a crear o cambiar y pide confirmación antes de tocar nada. Repetirlo sin
# cambios en el Bicep no altera nada.
#
# OJO: crear PostgreSQL empieza a cobrar, unos $0,50 al día mientras está encendido.
# Para detenerlo entre sesiones (Azure lo vuelve a encender a los 7 días):
#   az postgres flexible-server stop  -g rg-arriendos360 -n <nombrePostgres>
#   az postgres flexible-server start -g rg-arriendos360 -n <nombrePostgres>

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

if ! az group show -n "$GRUPO" -o none 2>/dev/null; then
  echo "No existe el grupo $GRUPO: ejecuta antes infra/azure/bootstrap.sh" >&2
  exit 1
fi
if ! az keyvault secret show --vault-name "$KEYVAULT" -n db-password --query id -o none 2>/dev/null; then
  echo "Falta el secreto db-password en $KEYVAULT: ejecuta antes infra/azure/bootstrap.sh" >&2
  exit 1
fi

az deployment group create \
  -g "$GRUPO" \
  -n base \
  -f "$DIR/base.bicep" \
  -p sufijo="$SUFIJO" \
  --confirm-with-what-if \
  -o none

echo
echo "Salidas del despliegue:"
az deployment group show -g "$GRUPO" -n base --query properties.outputs -o jsonc
echo
echo "Siguiente: bash infra/azure/verificar-base.sh"
