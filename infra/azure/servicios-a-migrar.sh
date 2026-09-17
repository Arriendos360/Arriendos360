#!/usr/bin/env bash
# Qué esquemas hay que migrar: los de los servicios cuya imagen cambió.
#
#   bash infra/azure/servicios-a-migrar.sh
#
# Imprime un nombre por línea —`identidad`, `inmuebles`…— o nada si no cambió ninguno.
#
# El criterio vale porque una migración viaja SIEMPRE dentro de su servicio: `database/<esquema>`
# es una de las rutas que componen su imagen, así que si hay migración nueva, su etiqueta
# cambió. Al revés no siempre —un cambio de código sin migración también mueve la etiqueta—,
# y entonces el Job corre y no aplica nada, que es inocuo.
#
# La primera vez, o si no hay Jobs desplegados todavía, los devuelve todos.
#
# OJO: hay que llamarlo ANTES de `desplegar-trabajos.sh`, que es quien actualiza las etiquetas
# guardadas en el despliegue.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"
source "$DIR/etiquetas.sh"

DESPLEGADAS="$(az deployment group show -g "$GRUPO" -n trabajos \
  --query properties.outputs.etiquetas.value -o json 2>/dev/null || true)"

for servicio in "${SERVICIOS[@]}"; do
  case "$servicio" in
    ms-*) esquema="${servicio#ms-}" ;;
    *) continue ;;
  esac

  nueva="$(etiqueta_de "$servicio")"

  if [ -z "$DESPLEGADAS" ] || [ "$DESPLEGADAS" = "null" ]; then
    echo "$esquema"
    continue
  fi

  anterior="$(printf '%s' "$DESPLEGADAS" | node -e "
    let entrada = '';
    process.stdin.on('data', (t) => (entrada += t)).on('end', () => {
      const etiquetas = JSON.parse(entrada || '{}');
      process.stdout.write(etiquetas['$servicio'] || '');
    });
  ")"

  if [ "$nueva" != "$anterior" ]; then
    echo "$esquema"
  fi
done
