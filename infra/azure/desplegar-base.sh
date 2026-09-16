#!/usr/bin/env bash
# Despliega infra/azure/base.bicep (corte 2). Desde Cloud Shell, después de bootstrap.sh:
#
#   bash infra/azure/desplegar-base.sh
#
# Muestra qué va a crear o cambiar y pide confirmación antes de tocar nada; con
# CONFIRMADO=si no pregunta. Repetirlo sin cambios en el Bicep no altera nada. Al terminar
# comprueba que el entorno de Container Apps no quedó en modo Express.
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
if ! secreto_existe db-password; then
  echo "Falta el secreto db-password en $KEYVAULT: ejecuta antes infra/azure/bootstrap.sh" >&2
  exit 1
fi

PLANTILLA="$(ruta "$DIR/base.bicep")"

az deployment group what-if -g "$GRUPO" -n base -f "$PLANTILLA" -p sufijo="$SUFIJO"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Desplegar la infraestructura base? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n base -f "$PLANTILLA" -p sufijo="$SUFIJO" -o none

MODO="$(modo_entorno)"
if [ "$MODO" != "WorkloadProfiles" ]; then
  echo "El entorno $ENTORNO quedó en modo «$MODO», no WorkloadProfiles: no admitirá Jobs ni" >&2
  echo "referencias a Key Vault. Hay que borrarlo y volver a desplegar (docs/adr/0022)." >&2
  exit 1
fi
echo "Entorno $ENTORNO en modo $MODO."

echo
echo "Salidas del despliegue:"
az deployment group show -g "$GRUPO" -n base --query properties.outputs -o jsonc
echo
echo "Siguiente: bash infra/azure/verificar-base.sh"
