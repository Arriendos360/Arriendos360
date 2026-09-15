#!/usr/bin/env bash
# Despliega las seis Container Apps y el Job del motor (infra/azure/apps.bicep, corte 4).
#
#   bash infra/azure/desplegar-apps.sh <etiqueta>
#
# Antes, con LA MISMA etiqueta: desplegar-trabajos.sh y las cinco migraciones ejecutadas
# (verificar-trabajos.sh lo hace). En Azure los servicios no migran al arrancar: con una
# migración pendiente la revisión nueva no arranca.
#
# Opcionales, hasta el corte 5: URL_APP (enlace del correo de recuperación) y CORS_ORIGENES.
# Muestra el what-if y pide confirmación; con CONFIRMADO=si no pregunta.
#
# Las apps escalan a cero: sin tráfico no consumen, y lo que consumen entra en la concesión
# gratuita mensual de Container Apps.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

ETIQUETA="${1:-}"
if [ -z "$ETIQUETA" ]; then
  echo "Uso: bash infra/azure/desplegar-apps.sh <etiqueta>" >&2
  echo "  <etiqueta>: el commit de main que publicó el workflow «Imágenes»." >&2
  exit 1
fi

ETIQUETA_TRABAJOS="$(az deployment group show -g "$GRUPO" -n trabajos \
  --query properties.outputs.etiqueta.value -o tsv 2>/dev/null || true)"
if [ "$ETIQUETA_TRABAJOS" != "$ETIQUETA" ]; then
  echo "Los Jobs de migración están desplegados con «${ETIQUETA_TRABAJOS:-nada}», no con «$ETIQUETA»." >&2
  echo "Antes: bash infra/azure/desplegar-trabajos.sh $ETIQUETA y ejecuta las migraciones." >&2
  exit 1
fi

for secreto in email-usuario email-pass; do
  if ! az keyvault secret show --vault-name "$KEYVAULT" -n "$secreto" --query id -o none 2>/dev/null; then
    echo "Falta el secreto $secreto en $KEYVAULT: bash infra/azure/bootstrap.sh lo pide." >&2
    exit 1
  fi
done

PLANTILLA="$(ruta "$DIR/apps.bicep")"
PARAMETROS=(sufijo="$SUFIJO" etiqueta="$ETIQUETA" usuarioRegistro="$USUARIO_GHCR")
[ -n "${URL_APP:-}" ] && PARAMETROS+=(urlApp="$URL_APP")
[ -n "${CORS_ORIGENES:-}" ] && PARAMETROS+=(corsOrigenes="$CORS_ORIGENES")

az deployment group what-if -g "$GRUPO" -n apps -f "$PLANTILLA" -p "${PARAMETROS[@]}"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Desplegar las apps y el motor con la etiqueta $ETIQUETA? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n apps -f "$PLANTILLA" -p "${PARAMETROS[@]}" -o none

echo
echo "Gateway: $(az deployment group show -g "$GRUPO" -n apps --query properties.outputs.urlGateway.value -o tsv)"
echo "Siguiente: bash infra/azure/verificar-apps.sh"
