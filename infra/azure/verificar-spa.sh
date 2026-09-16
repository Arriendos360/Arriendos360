#!/usr/bin/env bash
# Verificación del corte 5. Sólo lee: no cambia nada.
#
#   bash infra/azure/verificar-spa.sh
#
# Comprueba que la SPA está publicada y bien cableada al gateway:
#   1. La portada responde y trae el contenedor de React.
#   2. Una ruta interna recargada devuelve la misma portada (navigationFallback), que es lo
#      que evita el 404 al refrescar.
#   3. Los estáticos se sirven con su tipo, y un archivo inexistente NO se reescribe a la
#      portada.
#   4. El JavaScript publicado apunta al gateway: `REACT_APP_API_URL` se resolvió al compilar.
#   5. El gateway acepta el origen de la SPA por CORS y no uno cualquiera.
#
# La demostración completa en el navegador la hace una persona; esto sólo descarta lo que se
# puede comprobar sin ojos.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

FALLOS=0
ok() { printf '  ✔ %s\n' "$*"; }
fallo() { printf '  ✘ %s\n' "$*"; FALLOS=$((FALLOS + 1)); }

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

URL_SPA="$(az deployment group show -g "$GRUPO" -n spa --query properties.outputs.url.value -o tsv)"
URL_GATEWAY="$(az deployment group show -g "$GRUPO" -n apps --query properties.outputs.urlGateway.value -o tsv)"
HOST_GATEWAY="${URL_GATEWAY#https://}"
echo "SPA: $URL_SPA"
echo "Gateway: $URL_GATEWAY"

echo "== 1. Portada"
codigo="$(curl -s -o "$(ruta "$TRABAJO/portada.html")" -w '%{http_code}' --max-time 60 "$URL_SPA/" || true)"
if [ "$codigo" = "200" ] && grep -q 'id="root"' "$TRABAJO/portada.html"; then
  ok "$URL_SPA/ responde 200 con la SPA"
else
  fallo "portada: HTTP $codigo"
fi

echo "== 2. Ruta interna recargada"
codigo="$(curl -s -o "$(ruta "$TRABAJO/ruta.html")" -w '%{http_code}' --max-time 60 "$URL_SPA/contratos" || true)"
if [ "$codigo" = "200" ] && grep -q 'id="root"' "$TRABAJO/ruta.html"; then
  ok "/contratos devuelve la portada sin 404"
else
  fallo "/contratos: HTTP $codigo"
fi

echo "== 3. Estáticos"
PRINCIPAL="$(grep -oE '/static/js/main\.[a-z0-9]+\.js' "$TRABAJO/portada.html" | head -1)"
if [ -z "$PRINCIPAL" ]; then
  fallo "la portada no referencia /static/js/main.*.js"
else
  codigo="$(curl -s -o "$(ruta "$TRABAJO/main.js")" -w '%{http_code}' --max-time 60 "$URL_SPA$PRINCIPAL" || true)"
  if [ "$codigo" = "200" ]; then ok "$PRINCIPAL se sirve"; else fallo "$PRINCIPAL: HTTP $codigo"; fi
fi
codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$URL_SPA/static/js/no-existe.js" || true)"
if [ "$codigo" = "404" ]; then
  ok "un estático inexistente da 404, no la portada"
else
  fallo "/static/js/no-existe.js responde $codigo"
fi

echo "== 4. La SPA apunta al gateway"
if [ -s "$TRABAJO/main.js" ] && grep -q "$HOST_GATEWAY" "$TRABAJO/main.js"; then
  ok "el build lleva $HOST_GATEWAY"
else
  fallo "el JavaScript publicado no menciona $HOST_GATEWAY: ¿se compiló sin REACT_APP_API_URL?"
fi

echo "== 5. CORS del gateway"
cabeceras() {
  curl -s -o /dev/null -D - --max-time 60 -X OPTIONS \
    -H "Origin: $1" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    "$URL_GATEWAY/api/auth/login" 2>/dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' || true
}
permitido="$(cabeceras "$URL_SPA")"
ajeno="$(cabeceras "https://sitio-ajeno.example")"
if grep -qi "$URL_SPA" <<<"$permitido"; then
  ok "el gateway permite el origen de la SPA"
else
  fallo "el gateway no devolvió Access-Control-Allow-Origin para la SPA: «$permitido». ¿Falta CORS_ORIGENES?"
fi
if [ -z "$ajeno" ]; then
  ok "no permite un origen ajeno"
else
  fallo "permite un origen ajeno: «$ajeno»"
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Corte 5 verificado. Falta la demostración en el navegador."
else
  echo "$FALLOS comprobación(es) fallida(s)."
fi
exit "$FALLOS"
