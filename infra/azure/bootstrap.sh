#!/usr/bin/env bash
# Arranque de la infraestructura de Arriendos360 en Azure (corte 2, docs/adr/0022).
#
# Crea lo que tiene que existir ANTES de desplegar base.bicep, o que Bicep no debe crear:
#   - el grupo de recursos;
#   - el Key Vault, porque base.bicep lee de él la contraseña de PostgreSQL;
#   - las dos identidades administradas y sus roles: asignar roles exige ser propietario,
#     y la identidad del pipeline sólo será colaboradora del grupo;
#   - la credencial federada con la que GitHub Actions entra sin secretos;
#   - los secretos. Los aleatorios se generan aquí y no los ve nadie; la contraseña de
#     aplicación de Gmail y el token de GHCR se piden por teclado, sin eco.
#
# Una vez, desde Cloud Shell (Bash), con una cuenta propietaria de la suscripción:
#
#   bash infra/azure/bootstrap.sh
#
# Repetirlo es inocuo: no toca lo que ya existe y NUNCA rota un secreto ya guardado.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

paso() { printf '\n== %s\n' "$*"; }

paso "Grupo $GRUPO en $REGION"
az group create -n "$GRUPO" -l "$REGION" -o none

paso "Key Vault $KEYVAULT"
if az keyvault show -n "$KEYVAULT" -g "$GRUPO" -o none 2>/dev/null; then
  echo "  ya existe"
else
  if [ -n "$(az keyvault list-deleted --query "[?name=='$KEYVAULT'].name" -o tsv)" ]; then
    echo "  Hay un Key Vault $KEYVAULT borrado y retenido. Antes de seguir:" >&2
    echo "    az keyvault recover -n $KEYVAULT   # lo recupera con sus secretos" >&2
    echo "    az keyvault purge -n $KEYVAULT     # lo borra del todo" >&2
    exit 1
  fi
  # RBAC en vez de políticas de acceso. Plantillas habilitadas, para que Bicep lea la
  # contraseña de PostgreSQL. Retención de 7 días, la mínima, y sin protección de purga,
  # para poder borrarlo del todo al terminar el proyecto.
  az keyvault create -n "$KEYVAULT" -g "$GRUPO" -l "$REGION" \
    --enable-rbac-authorization true \
    --enabled-for-template-deployment true \
    --retention-days 7 \
    -o none
  echo "  creado"
fi
KEYVAULT_ID="$(az keyvault show -n "$KEYVAULT" -g "$GRUPO" --query id -o tsv)"
GRUPO_ID="$(az group show -n "$GRUPO" --query id -o tsv)"

# asignar <object-id> <User|ServicePrincipal> <rol> <ámbito>, sólo si falta. Con el object
# id y el tipo explícitos no hay que esperar a que Entra ID replique una identidad recién
# creada.
asignar() {
  local existente
  existente="$(az role assignment list --scope "$4" --role "$3" \
    --query "[?principalId=='$1'].id | [0]" -o tsv)"
  if [ -n "$existente" ]; then
    echo "  $3: ya estaba"
  else
    az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" \
      --role "$3" --scope "$4" -o none
    echo "  $3: asignado"
  fi
}

paso "Tu acceso a los secretos"
YO="$(az ad signed-in-user show --query id -o tsv)"
asignar "$YO" User "Key Vault Secrets Officer" "$KEYVAULT_ID"

paso "Identidad de las apps: $IDENTIDAD_APPS"
az identity create -n "$IDENTIDAD_APPS" -g "$GRUPO" -l "$REGION" -o none
APPS_PRINCIPAL="$(az identity show -n "$IDENTIDAD_APPS" -g "$GRUPO" --query principalId -o tsv)"
# Sólo lectura de secretos: con ella apps y Jobs resuelven sus referencias a Key Vault.
asignar "$APPS_PRINCIPAL" ServicePrincipal "Key Vault Secrets User" "$KEYVAULT_ID"

paso "Identidad del despliegue: $IDENTIDAD_DESPLIEGUE"
az identity create -n "$IDENTIDAD_DESPLIEGUE" -g "$GRUPO" -l "$REGION" -o none
DESPLIEGUE_PRINCIPAL="$(az identity show -n "$IDENTIDAD_DESPLIEGUE" -g "$GRUPO" --query principalId -o tsv)"
DESPLIEGUE_CLIENTE="$(az identity show -n "$IDENTIDAD_DESPLIEGUE" -g "$GRUPO" --query clientId -o tsv)"
# Colaboradora del grupo: despliega Bicep y lanza Jobs. No asigna roles ni tiene rol de
# datos sobre el Key Vault.
asignar "$DESPLIEGUE_PRINCIPAL" ServicePrincipal "Contributor" "$GRUPO_ID"

paso "Credencial federada de GitHub Actions"
CREDENCIAL="github-$ENTORNO_GITHUB"
if az identity federated-credential show --name "$CREDENCIAL" \
     --identity-name "$IDENTIDAD_DESPLIEGUE" -g "$GRUPO" -o none 2>/dev/null; then
  echo "  ya existe"
else
  az identity federated-credential create --name "$CREDENCIAL" \
    --identity-name "$IDENTIDAD_DESPLIEGUE" -g "$GRUPO" \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "repo:$REPO_GITHUB:environment:$ENTORNO_GITHUB" \
    --audiences "api://AzureADTokenExchange" \
    -o none
  echo "  creada para repo:$REPO_GITHUB:environment:$ENTORNO_GITHUB"
fi

# Un rol recién asignado tarda unos minutos en valer. Hasta entonces, preguntar si un
# secreto existe respondería «no» por falta de permiso, y se sobrescribiría.
paso "Esperando a que tu acceso al Key Vault se propague"
for intento in $(seq 1 20); do
  if az keyvault secret list --vault-name "$KEYVAULT" -o none 2>/dev/null; then
    echo "  listo"
    break
  fi
  if [ "$intento" -eq 20 ]; then
    echo "  Sin acceso tras 10 minutos. Vuelve a ejecutar el script." >&2
    exit 1
  fi
  sleep 30
done

existe_secreto() {
  az keyvault secret show --vault-name "$KEYVAULT" -n "$1" --query id -o tsv >/dev/null 2>&1
}
guardar() {
  az keyvault secret set --vault-name "$KEYVAULT" -n "$1" --value "$2" -o none
}
# Sin «\r»: el openssl de Git Bash termina en «\r\n» y el secreto lo guardaría.
aleatorio() {
  openssl rand -base64 48 | tr -d '\r\n'
}
# PostgreSQL exige tres de cuatro clases de caracteres: base64 sin símbolos más un prefijo
# fijo las garantiza, y no hay nada que escapar al usarla.
contrasena_db() {
  printf 'Aa1%s' "$(openssl rand -base64 36 | tr -d '/+=\r\n')"
}

paso "Secretos generados"
for par in jwt-secret:aleatorio servicio-jwt-secret:aleatorio db-password:contrasena_db; do
  nombre="${par%%:*}"
  generador="${par##*:}"
  if existe_secreto "$nombre"; then
    echo "  $nombre: ya estaba, no se rota"
  else
    guardar "$nombre" "$($generador)"
    echo "  $nombre: generado"
  fi
done

paso "Secretos que sólo tienes tú"
pedir() {
  local nombre="$1" descripcion="$2" valor
  if existe_secreto "$nombre"; then
    echo "  $nombre: ya estaba"
    return
  fi
  read -rsp "  $descripcion (no se ve; Enter vacío lo deja para después): " valor
  echo
  # Gmail muestra la contraseña de aplicación con espacios; no forman parte de ella.
  valor="$(printf '%s' "$valor" | tr -d '[:space:]')"
  if [ -z "$valor" ]; then
    echo "  $nombre: PENDIENTE, vuelve a ejecutar el script para cargarlo"
  else
    guardar "$nombre" "$valor"
    echo "  $nombre: guardado"
  fi
}
pedir email-usuario "Dirección de Gmail que envía los correos"
pedir email-pass "Contraseña de aplicación de Gmail"
pedir ghcr-token "Token classic de GHCR con read:packages"

paso "Listo"
cat <<EOF
Siguiente: bash infra/azure/desplegar-base.sh

Para el corte 6, variables (no secretos) del entorno «$ENTORNO_GITHUB» de GitHub:
  AZURE_CLIENT_ID=$DESPLIEGUE_CLIENTE
  AZURE_TENANT_ID=$TENANT
  AZURE_SUBSCRIPTION_ID=$SUSCRIPCION
EOF
