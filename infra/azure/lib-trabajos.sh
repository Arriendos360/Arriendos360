# Funciones para lanzar Jobs manuales de Container Apps y leer su salida. Se carga con
# `source` después de comun.sh. Usa `az rest`: no necesita la extensión containerapp.

API_APPS="api-version=2024-03-01"

# url_trabajo <nombre>: URL de administración del Job.
url_trabajo() {
  printf 'https://management.azure.com%s' \
    "$(az resource show -g "$GRUPO" -n "$1" --resource-type Microsoft.App/jobs --query id -o tsv)"
}

# iniciar_trabajo <nombre>: lanza una ejecución e imprime su nombre.
iniciar_trabajo() {
  az rest --method post --url "$(url_trabajo "$1")/start?$API_APPS" --query name -o tsv
}

# esperar_ejecucion <nombre> <ejecución>: espera a que termine, 15 minutos como mucho, e
# imprime el estado final: Succeeded, Failed, Stopped, Degraded o SinTerminar.
esperar_ejecucion() {
  local url estado limite=$((SECONDS + 900))
  url="$(url_trabajo "$1")/executions/$2?$API_APPS"
  while :; do
    estado="$(az rest --method get --url "$url" --query properties.status -o tsv 2>/dev/null || true)"
    case "$estado" in
      Succeeded | Failed | Stopped | Degraded)
        printf '%s\n' "$estado"
        return
        ;;
    esac
    if [ "$SECONDS" -ge "$limite" ]; then
      printf 'SinTerminar\n'
      return
    fi
    sleep 10
  done
}

# consulta_logs <kql>: primera columna de cada fila de una consulta a Log Analytics. La
# consulta va dentro de JSON: sólo comillas simples. Un error se muestra y devuelve 1:
# reintentarlo en silencio sólo lo esconde.
consulta_logs() {
  local espacio error
  espacio="$(az monitor log-analytics workspace show -g "$GRUPO" -n log-arriendos360 --query customerId -o tsv)"
  error="$(mktemp)"
  if ! az rest --method post \
    --url "https://api.loganalytics.io/v1/workspaces/$espacio/query" \
    --resource "https://api.loganalytics.io" \
    --body "{\"query\": \"$1\"}" \
    --query "tables[0].rows[*][0]" -o tsv 2>"$error"; then
    printf 'ERROR al consultar Log Analytics: %s\n' "$(head -c 300 "$error")" >&2
    rm -f "$error"
    return 1
  fi
  rm -f "$error"
}

# salida_ejecucion <ejecución>: lo que escribió el contenedor (ContainerAppConsoleLogs_CL;
# cada réplica se llama <ejecución>-<sufijo>). La ingesta tarda: consulta hasta que dos
# lecturas seguidas coinciden, seis minutos como mucho, e imprime lo último que obtuvo.
salida_ejecucion() {
  local consulta salida anterior=""
  consulta="ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith '$1' | order by TimeGenerated asc | project Log_s"
  for _ in $(seq 1 24); do
    salida="$(consulta_logs "$consulta")" || return 1
    if [ -n "$salida" ] && [ "$salida" = "$anterior" ]; then
      break
    fi
    anterior="$salida"
    sleep 15
  done
  printf '%s\n' "$salida"
}
