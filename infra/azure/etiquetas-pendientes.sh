#!/usr/bin/env bash
# Qué imágenes hay que construir: las que no están ya en GHCR con su etiqueta.
#
#   bash infra/azure/etiquetas-pendientes.sh
#
# Imprime dos líneas en el formato de las salidas de GitHub Actions:
#
#   etiquetas={"gateway":"<sha>", …}
#   matriz=[{"nombre":"ms-inmuebles","dockerfile":"…","etiqueta":"<sha>"}, …]
#
# `matriz` sólo trae lo que falta; si nadie tocó un servicio, su imagen ya existe y no se
# reconstruye. Con todo igual, la matriz sale vacía y no se construye nada.
#
# Necesita haber iniciado sesión en ghcr.io (el workflow lo hace con el GITHUB_TOKEN) y la
# historia completa del repositorio.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/etiquetas.sh"

REGISTRO="${REGISTRO:-ghcr.io/arriendos360}"

ETIQUETAS="$(etiquetas_json)"
MATRIZ=""
RESUMEN=""

for servicio in "${SERVICIOS[@]}"; do
  etiqueta="$(etiqueta_de "$servicio")"
  imagen="$REGISTRO/$servicio:$etiqueta"
  if docker manifest inspect "$imagen" > /dev/null 2>&1; then
    RESUMEN="$RESUMEN| \`$servicio\` | \`${etiqueta:0:9}\` | ya publicada |"$'\n'
  else
    MATRIZ="$MATRIZ${MATRIZ:+,}{\"nombre\":\"$servicio\",\"dockerfile\":\"$(dockerfile_de "$servicio")\",\"etiqueta\":\"$etiqueta\"}"
    RESUMEN="$RESUMEN| \`$servicio\` | \`${etiqueta:0:9}\` | **se construye** |"$'\n'
  fi
done

echo "etiquetas=$ETIQUETAS"
echo "matriz=[$MATRIZ]"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Imágenes"
    echo
    echo "| Servicio | Etiqueta | Estado |"
    echo "|---|---|---|"
    printf '%s' "$RESUMEN"
  } >> "$GITHUB_STEP_SUMMARY"
fi
