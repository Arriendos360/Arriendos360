#!/usr/bin/env bash
# Despliega las seis Container Apps y el Job del motor (infra/azure/apps.bicep, corte 4).
#
#   bash infra/azure/desplegar-apps.sh
#
# Cada app usa la imagen de su servicio con la etiqueta que calcula `etiquetas.sh`. La app de
# un servicio que no cambió queda con la plantilla idéntica y Container Apps NO le crea
# revisión: eso es lo que hace el despliegue independiente por servicio.
#
# Antes, con LAS MISMAS etiquetas: desplegar-trabajos.sh y las migraciones de los servicios
# que cambiaron —`servicios-a-migrar.sh` dice cuáles—. En Azure los servicios no migran al
# arrancar: con una migración pendiente la revisión nueva no arranca.
#
# Opcionales, hasta el corte 5: URL_APP (enlace del correo de recuperación) y CORS_ORIGENES.
# Muestra el what-if y pide confirmación; con CONFIRMADO=si no pregunta.
#
# Las apps escalan a cero: sin tráfico no consumen, y lo que consumen entra en la concesión
# gratuita mensual de Container Apps.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

source "$DIR/etiquetas.sh"

ETIQUETAS="$(etiquetas_json)"

# Los Jobs tienen que llevar las mismas etiquetas: son los que aplican las migraciones que
# estas revisiones dan por hechas.
ESPERADAS="$(printf '%s' "$ETIQUETAS" | etiquetas_canonicas)"
EN_TRABAJOS="$(az deployment group show -g "$GRUPO" -n trabajos \
  --query properties.outputs.etiquetas.value -o json 2>/dev/null | etiquetas_canonicas || true)"
if [ "$EN_TRABAJOS" != "$ESPERADAS" ]; then
  echo "Los Jobs de migración no están desplegados con estas etiquetas." >&2
  echo "  aquí:     $ESPERADAS" >&2
  echo "  en Azure: ${EN_TRABAJOS:-nada}" >&2
  echo "Antes: bash infra/azure/desplegar-trabajos.sh y ejecuta lo que diga servicios-a-migrar.sh." >&2
  exit 1
fi

for secreto in email-usuario email-pass; do
  if ! secreto_existe "$secreto"; then
    echo "Falta el secreto $secreto en $KEYVAULT: bash infra/azure/bootstrap.sh lo pide." >&2
    exit 1
  fi
done

# Si el Static Web App ya existe, su URL es el valor por defecto de las dos variables que la
# nombran: el gateway limita ahí el CORS y los correos enlazan ahí. Así no hay que recordarlo
# en cada despliegue, y se puede forzar otra con URL_APP o CORS_ORIGENES.
URL_SPA="$(az deployment group show -g "$GRUPO" -n spa --query properties.outputs.url.value -o tsv 2>/dev/null || true)"
URL_APP="${URL_APP:-$URL_SPA}"
CORS_ORIGENES="${CORS_ORIGENES:-$URL_SPA}"

PLANTILLA="$(ruta "$DIR/apps.bicep")"
PARAMETROS=(sufijo="$SUFIJO" etiquetas="$ETIQUETAS" usuarioRegistro="$USUARIO_GHCR")
[ -n "${URL_APP:-}" ] && PARAMETROS+=(urlApp="$URL_APP")
[ -n "${CORS_ORIGENES:-}" ] && PARAMETROS+=(corsOrigenes="$CORS_ORIGENES")

az deployment group what-if -g "$GRUPO" -n apps -f "$PLANTILLA" -p "${PARAMETROS[@]}"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Desplegar las apps y el motor con estas etiquetas? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n apps -f "$PLANTILLA" -p "${PARAMETROS[@]}" -o none

echo
echo "Gateway: $(az deployment group show -g "$GRUPO" -n apps --query properties.outputs.urlGateway.value -o tsv)"
echo "Siguiente: bash infra/azure/verificar-apps.sh"
