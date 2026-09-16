#!/usr/bin/env bash
# Crea el presupuesto con avisos al 50 % y al 80 % (corte 7).
#
#   bash infra/azure/desplegar-presupuesto.sh [monto mensual]
#
# El aviso llega a la dirección guardada en el secreto `email-usuario`, la misma desde la que
# el sistema manda sus correos: así ninguna dirección personal entra al repositorio. Hace
# falta poder leer ese secreto, así que esto lo corre una persona, no el pipeline.
#
# No cuesta nada y no corta nada: sólo avisa. Lo que de verdad estira el crédito es apagar
# PostgreSQL entre sesiones.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

MONTO="${1:-25}"
case "$MONTO" in
  '' | *[!0-9]*)
    echo "El monto mensual tiene que ser un número entero: «$MONTO»" >&2
    exit 1
    ;;
esac

if ! secreto_existe email-usuario; then
  echo "Falta el secreto email-usuario en $KEYVAULT: bash infra/azure/bootstrap.sh lo pide." >&2
  exit 1
fi
CORREO="$(az keyvault secret show --vault-name "$KEYVAULT" -n email-usuario --query value -o tsv --only-show-errors)"

PLANTILLA="$(ruta "$DIR/presupuesto.bicep")"
PARAMETROS=(montoMensual="$MONTO" correoAviso="$CORREO")

az deployment group what-if -g "$GRUPO" -n presupuesto -f "$PLANTILLA" -p "${PARAMETROS[@]}"

if [ "${CONFIRMADO:-}" != "si" ]; then
  read -rp "¿Crear el presupuesto de $MONTO al mes, con avisos al 50 % y al 80 %? (s/N) " respuesta
  if [ "$respuesta" != "s" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

az deployment group create -g "$GRUPO" -n presupuesto -f "$PLANTILLA" -p "${PARAMETROS[@]}" -o none
unset CORREO

echo
echo "Presupuesto creado. Avisos al 50 % ($((MONTO / 2))) y al 80 % ($((MONTO * 8 / 10))) del gasto mensual."
az consumption budget list --query "[?name=='presupuesto-arriendos360'].{nombre:name, monto:amount, periodo:timeGrain}" -o table 2>/dev/null || true
