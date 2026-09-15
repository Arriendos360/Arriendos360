#!/usr/bin/env bash
# Verificación del corte 4. No cambia la infraestructura, pero SÍ usa el sistema:
#
#   bash infra/azure/verificar-apps.sh
#   CORREO_PRUEBA=alguien@gmail.com bash infra/azure/verificar-apps.sh
#
# En este orden, porque cualquier petición despierta las apps:
#   1. Espera a que las seis estén en cero réplicas (20 minutos como mucho) y mide el primer
#      login con todo dormido. Es el número que importa para la sustentación.
#   2. El gateway responde por HTTPS y HTTP redirige.
#   3. Los cinco servicios no se alcanzan desde internet.
#   4. Login con todo despierto.
#   5. Ejecuta el Job del motor: tiene que terminar en Succeeded.
#   6. Con CORREO_PRUEBA: registra ese correo si no existe —queda como PROPIETARIO con una
#      contraseña aleatoria, que se cambia con el propio correo— y pide la recuperación. El
#      log de ms-notificaciones tiene que decir «RecuperacionSolicitada enviado». Que llegue
#      al buzón lo confirma quien lo lee. ms-identidad deja 3 recuperaciones por hora por
#      cuenta y las demás las ignora en silencio: más de tres corridas por hora no mandan.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"
source "$DIR/lib-trabajos.sh"

APPS=(gateway ms-identidad ms-inmuebles ms-contratos ms-financiero ms-notificaciones)
SERVICIOS=(ms-identidad ms-inmuebles ms-contratos ms-financiero ms-notificaciones)
LOGIN='{"email":"propietario@arriendos360.test","contrasena":"Prueba123"}'

FALLOS=0
ok() { printf '  ✔ %s\n' "$*"; }
fallo() { printf '  ✘ %s\n' "$*"; FALLOS=$((FALLOS + 1)); }

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

URL="$(az deployment group show -g "$GRUPO" -n apps --query properties.outputs.urlGateway.value -o tsv)"
HOST="${URL#https://}"
DOMINIO="${HOST#gateway.}"
echo "Gateway: $URL"

# replicas <app>: réplicas de la revisión activa; 0 si no hay ninguna.
replicas() {
  local id n
  id="$(az resource show -g "$GRUPO" -n "$1" --resource-type Microsoft.App/containerApps --query id -o tsv)"
  n="$(az rest --method get --url "https://management.azure.com$id/revisions?api-version=2024-03-01" \
    --query "value[?properties.active].properties.replicas | [0]" -o tsv)"
  case "$n" in '' | None | null) echo 0 ;; *) echo "$n" ;; esac
}

# login: «<código HTTP> <segundos>», con el cuerpo en $TRABAJO/login.json.
login() {
  curl -sS -o "$TRABAJO/login.json" -w '%{http_code} %{time_total}' --max-time 150 \
    -X POST -H 'Content-Type: application/json' -d "$LOGIN" "$URL/api/auth/login" 2>/dev/null ||
    echo "000 150"
}

comprobar_login() {
  local etiqueta="$1" resultado codigo segundos
  resultado="$(login)"
  codigo="${resultado%% *}"
  segundos="${resultado##* }"
  if [ "$codigo" = "200" ] && grep -q '"token"' "$TRABAJO/login.json"; then
    ok "$etiqueta: 200 con token en ${segundos} s"
  else
    fallo "$etiqueta: HTTP $codigo en ${segundos} s: $(head -c 200 "$TRABAJO/login.json" 2>/dev/null)"
  fi
}

echo "== 1. Primer login con todo en cero"
limite=$((SECONDS + 1200))
while :; do
  despiertas=()
  for app in "${APPS[@]}"; do
    n="$(replicas "$app")"
    [ "$n" = "0" ] || despiertas+=("$app=$n")
  done
  if [ "${#despiertas[@]}" -eq 0 ]; then
    ok "las seis apps en cero réplicas"
    comprobar_login "primer login en frío"
    break
  fi
  if [ "$SECONDS" -ge "$limite" ]; then
    fallo "tras 20 minutos siguen despiertas: ${despiertas[*]}; no se midió el arranque en frío"
    break
  fi
  echo "  esperando a que se duerman: ${despiertas[*]}"
  sleep 30
done

echo "== 2. Gateway por HTTPS"
codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$URL/" || true)"
if [ "$codigo" = "200" ]; then ok "https://$HOST/ responde 200"; else fallo "https://$HOST/ responde $codigo"; fi
codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://$HOST/" || true)"
case "$codigo" in
  301 | 302 | 307 | 308) ok "http://$HOST/ redirige ($codigo)" ;;
  *) fallo "http://$HOST/ responde $codigo en vez de redirigir" ;;
esac

echo "== 3. Servicios inalcanzables desde internet"
for servicio in "${SERVICIOS[@]}"; do
  for host in "$servicio.internal.$DOMINIO" "$servicio.$DOMINIO"; do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" || true)"
    case "$codigo" in
      000 | 4??) ok "$host: ${codigo/000/sin respuesta}" ;;
      *) fallo "$host responde $codigo desde internet" ;;
    esac
  done
done

echo "== 4. Login con todo despierto"
comprobar_login "login en caliente"

echo "== 5. Job del motor"
EJECUCION="$(iniciar_trabajo motor-financiero)"
ESTADO="$(esperar_ejecucion motor-financiero "$EJECUCION")"
if [ "$ESTADO" = "Succeeded" ]; then ok "motor-financiero ($EJECUCION): Succeeded"; else fallo "motor-financiero ($EJECUCION): $ESTADO"; fi
SALIDA="$(salida_ejecucion "$EJECUCION" || true)"
sed 's/^/      /' <<<"$SALIDA"
if grep -q "Motor financiero ejecutado" <<<"$SALIDA"; then ok "el motor terminó su barrido"; else fallo "la salida del motor no dice «Motor financiero ejecutado»"; fi

echo "== 6. Correo de recuperación"
if [ -z "${CORREO_PRUEBA:-}" ]; then
  echo "  (omitido: sin CORREO_PRUEBA)"
else
  CONTRASENA="$(openssl rand -base64 18 | tr -d '/+=\n')"
  DOCUMENTO="9$(date +%s | tail -c 9)"
  REGISTRO="$(printf '{"nombres":"Prueba","apellidos":"Despliegue","email":"%s","contrasena":"%s","telefono":"3000000000","documento":"%s"}' \
    "$CORREO_PRUEBA" "$CONTRASENA" "$DOCUMENTO")"
  codigo="$(curl -s -o "$TRABAJO/registro.json" -w '%{http_code}' --max-time 90 -X POST \
    -H 'Content-Type: application/json' -d "$REGISTRO" "$URL/api/auth/registro" || true)"
  case "$codigo" in
    200 | 201) ok "cuenta de prueba registrada" ;;
    409) ok "la cuenta de prueba ya existía" ;;
    *) fallo "registro: HTTP $codigo: $(head -c 200 "$TRABAJO/registro.json")" ;;
  esac

  DESDE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  codigo="$(curl -s -o "$TRABAJO/recuperar.json" -w '%{http_code}' --max-time 90 -X POST \
    -H 'Content-Type: application/json' -d "{\"email\":\"$CORREO_PRUEBA\"}" "$URL/api/auth/recuperar" || true)"
  if [ "$codigo" = "200" ]; then ok "recuperación solicitada"; else fallo "recuperar: HTTP $codigo: $(head -c 200 "$TRABAJO/recuperar.json")"; fi

  # El evento viaja de ms-identidad a ms-notificaciones, que resuelve el correo y lo manda:
  # con servicios despertando, un par de minutos.
  consulta="ContainerAppConsoleLogs_CL | where TimeGenerated > datetime($DESDE) | where ContainerGroupName_s startswith 'ms-notificaciones' | where Log_s has 'RecuperacionSolicitada' | project Log_s"
  enviado=""
  for _ in $(seq 1 40); do
    registro="$(consulta_logs "$consulta" || true)"
    if grep -q "RecuperacionSolicitada enviado" <<<"$registro"; then
      enviado="si"
      break
    fi
    sleep 15
  done
  if [ -n "$enviado" ]; then
    ok "ms-notificaciones envió el correo de recuperación: revisa el buzón de $CORREO_PRUEBA"
  else
    fallo "en 10 minutos ms-notificaciones no registró el envío: $(tail -c 300 <<<"$registro")"
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Corte 4 verificado."
else
  echo "$FALLOS comprobación(es) fallida(s)."
fi
exit "$FALLOS"
