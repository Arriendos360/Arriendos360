#!/usr/bin/env bash
# Prueba de humo: ¿quedó el sistema en pie después de desplegar?
#
#   bash infra/azure/humo.sh
#
# Corta a propósito —dos o tres minutos—, porque la corre el pipeline al final de cada
# despliegue. Comprueba el camino entero de un usuario: la SPA carga, el gateway responde por
# HTTPS, un login devuelve token y el gateway acepta el origen de la SPA.
#
# Lo que NO hace, y por eso siguen existiendo verificar-apps.sh y verificar-spa.sh: medir el
# arranque en frío, ejecutar el Job del motor, mandar un correo de recuperación ni comprobar
# que los servicios no se alcanzan desde internet.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

FALLOS=0
ok() { printf '  ✔ %s\n' "$*"; }
fallo() { printf '  ✘ %s\n' "$*"; FALLOS=$((FALLOS + 1)); }

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

URL_GATEWAY="$(az deployment group show -g "$GRUPO" -n apps --query properties.outputs.urlGateway.value -o tsv)"
URL_SPA="$(az deployment group show -g "$GRUPO" -n spa --query properties.outputs.url.value -o tsv 2>/dev/null || true)"
echo "Gateway: $URL_GATEWAY"
echo "SPA: ${URL_SPA:-(sin desplegar)}"

echo "== Gateway"
# Las apps pueden estar dormidas: el primer golpe despierta y tarda (medido: ~37 s).
codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 "$URL_GATEWAY/" || true)"
if [ "$codigo" = "200" ]; then ok "responde 200"; else fallo "responde $codigo"; fi

echo "== Login de demostración"
resultado="$(curl -sS -o "$(ruta "$TRABAJO/login.json")" -w '%{http_code} %{time_total}' --max-time 150 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"email":"propietario@arriendos360.test","contrasena":"Prueba123"}' \
  "$URL_GATEWAY/api/auth/login" 2>/dev/null)" || resultado="000 0"
codigo="${resultado%% *}"
if [ "$codigo" = "200" ] && grep -q '"token"' "$TRABAJO/login.json"; then
  ok "200 con token en ${resultado##* } s"
else
  fallo "login: HTTP $codigo — $(head -c 200 "$TRABAJO/login.json" 2>/dev/null)"
fi

if [ -n "$URL_SPA" ]; then
  echo "== SPA"
  codigo="$(curl -s -o "$(ruta "$TRABAJO/portada.html")" -w '%{http_code}' --max-time 60 "$URL_SPA/" || true)"
  if [ "$codigo" = "200" ] && grep -q 'id="root"' "$TRABAJO/portada.html"; then
    ok "la portada carga"
  else
    fallo "portada: HTTP $codigo"
  fi

  echo "== CORS"
  permitido="$(curl -s -o /dev/null -D - --max-time 60 -X OPTIONS \
    -H "Origin: $URL_SPA" -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    "$URL_GATEWAY/api/auth/login" 2>/dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' || true)"
  if grep -qi "$URL_SPA" <<<"$permitido"; then
    ok "el gateway admite el origen de la SPA"
  else
    fallo "el gateway no admite el origen de la SPA: «$permitido»"
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Humo en verde."
else
  echo "$FALLOS comprobación(es) fallida(s)."
fi
exit "$FALLOS"
