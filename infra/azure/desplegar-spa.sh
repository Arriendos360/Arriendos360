#!/usr/bin/env bash
# Crea el Static Web App y publica en él la SPA (corte 5).
#
#   bash infra/azure/desplegar-spa.sh
#
# Hace tres cosas, en orden:
#   1. Despliega infra/azure/spa.bicep (what-if y confirmación; con CONFIRMADO=si no pregunta).
#   2. Compila `apps/web` con REACT_APP_API_URL apuntando al gateway desplegado. La SPA
#      resuelve esa variable AL COMPILAR, así que el build queda atado a esa URL.
#   3. Sube el build con la CLI de Static Web Apps, con el token de despliegue pedido al
#      vuelo y pasado por el entorno: no se guarda en el repositorio ni en GitHub.
#
# El plan Free no cuesta. Después hay que redesplegar las apps con URL_APP y CORS_ORIGENES
# —lo dice al terminar— y verificar con infra/azure/verificar-spa.sh.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../.." && pwd)"
source "$DIR/comun.sh"

URL_GATEWAY="$(az deployment group show -g "$GRUPO" -n apps \
  --query properties.outputs.urlGateway.value -o tsv 2>/dev/null || true)"
if [ -z "$URL_GATEWAY" ]; then
  echo "No hay apps desplegadas: ejecuta antes infra/azure/desplegar-apps.sh <etiqueta>" >&2
  exit 1
fi

PLANTILLA="$(ruta "$DIR/spa.bicep")"

az deployment group what-if -g "$GRUPO" -n spa -f "$PLANTILLA"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Crear o actualizar el Static Web App? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n spa -f "$PLANTILLA" -o none

NOMBRE_SPA="$(az deployment group show -g "$GRUPO" -n spa --query properties.outputs.nombre.value -o tsv)"
URL_SPA="$(az deployment group show -g "$GRUPO" -n spa --query properties.outputs.url.value -o tsv)"

echo
echo "== Compilando la SPA contra $URL_GATEWAY/api"
(
  cd "$RAIZ/apps/web"
  CI=true REACT_APP_API_URL="$URL_GATEWAY/api" npx react-scripts build
)

echo
echo "== Publicando el build en $NOMBRE_SPA"
# El token va por el entorno, no como argumento: así no queda en la lista de procesos.
SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list -n "$NOMBRE_SPA" -g "$GRUPO" \
  --query properties.apiKey -o tsv)"
export SWA_CLI_DEPLOYMENT_TOKEN
npx --yes @azure/static-web-apps-cli@2 deploy "$(ruta "$RAIZ/apps/web/build")" --env production
unset SWA_CLI_DEPLOYMENT_TOKEN

echo
echo "SPA: $URL_SPA"
echo "Siguiente:"
echo "  URL_APP=$URL_SPA CORS_ORIGENES=$URL_SPA bash infra/azure/desplegar-apps.sh <etiqueta>"
echo "  bash infra/azure/verificar-spa.sh"
