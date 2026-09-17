# Qué etiqueta lleva la imagen de cada servicio. Se carga con `source`; no se ejecuta.
#
# La etiqueta es **el último commit que tocó ese servicio**, no el de la rama. Así, si sólo
# cambió ms-inmuebles, las otras cinco conservan su etiqueta: su plantilla queda idéntica y
# Container Apps no crea revisión. Eso es lo que hace el despliegue independiente.
#
# LO COMPARTIDO ENTRA EN TODAS: `packages/shared`, `packages/contracts`, los manifiestos de la
# raíz —el lockfile cambia con cualquier dependencia— y el script que arma las imágenes. Si
# tocas el bus o el cliente HTTP, se redespliegan los seis, y es lo correcto: el contrato que
# comparten cambió para todos.
#
# Expone:
#   SERVICIOS               los seis nombres de imagen
#   rutas_de <nombre>       las rutas que la componen, una por línea
#   dockerfile_de <nombre>  su Dockerfile
#   etiqueta_de <nombre>    el commit de su última modificación
#   etiquetas_json          {"gateway":"<sha>", …} tal como lo esperan los Bicep
#
# Necesita la historia de git: en un runner, `actions/checkout` con `fetch-depth: 0`.

SERVICIOS=(gateway ms-identidad ms-inmuebles ms-contratos ms-financiero ms-notificaciones)

COMPARTIDO=(
  packages/shared
  packages/contracts
  package.json
  package-lock.json
  infra/docker/solo-produccion.js
)

# rutas_de <nombre>: la SPA no va a GHCR, pero se etiqueta igual para saber cuándo republicar.
rutas_de() {
  case "$1" in
    gateway) printf '%s\n' apps/gateway "${COMPARTIDO[@]}" ;;
    web) printf '%s\n' apps/web "${COMPARTIDO[@]}" ;;
    ms-*) printf '%s\n' "services/$1" "database/${1#ms-}" "${COMPARTIDO[@]}" ;;
    *)
      echo "servicio desconocido: $1" >&2
      return 1
      ;;
  esac
}

dockerfile_de() {
  case "$1" in
    gateway) echo apps/gateway/Dockerfile ;;
    ms-*) echo "services/$1/Dockerfile" ;;
    *)
      echo "servicio sin imagen: $1" >&2
      return 1
      ;;
  esac
}

etiqueta_de() {
  local rutas=()
  mapfile -t rutas < <(rutas_de "$1") || return 1
  git log -1 --format=%H -- "${rutas[@]}"
}

# etiquetas_canonicas: lee un objeto JSON por la entrada y lo imprime con las claves
# ordenadas. Dos conjuntos de etiquetas se comparan por su contenido, no por el orden en que
# Azure devolvió las claves.
etiquetas_canonicas() {
  node -e "
    let entrada = '';
    process.stdin.on('data', (t) => (entrada += t)).on('end', () => {
      const etiquetas = JSON.parse(entrada || '{}');
      process.stdout.write(JSON.stringify(etiquetas, Object.keys(etiquetas).sort()));
    });
  "
}

etiquetas_json() {
  local servicio salida="" etiqueta
  for servicio in "${SERVICIOS[@]}"; do
    etiqueta="$(etiqueta_de "$servicio")"
    if [ -z "$etiqueta" ]; then
      echo "no pude calcular la etiqueta de $servicio: ¿clon sin historia?" >&2
      return 1
    fi
    salida="$salida${salida:+,}\"$servicio\":\"$etiqueta\""
  done
  printf '{%s}\n' "$salida"
}
