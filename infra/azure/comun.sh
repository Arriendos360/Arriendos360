# Nombres compartidos por los scripts de infra/azure. Se carga con `source`, no se ejecuta.
# Requiere una sesión de `az`: Cloud Shell ya la tiene, y en Windows sirve Git Bash tras
# `az login`.
#
# Key Vault, Storage y PostgreSQL necesitan nombres únicos en todo Azure: llevan un sufijo
# derivado del id de la suscripción, estable entre ejecuciones y sin guardar nada en el
# repositorio. base.bicep recibe el mismo sufijo y deriva de él el resto de nombres.

# Git Bash en Windows: `az` termina cada línea con «\r\n», que se cuela en lo capturado con
# $(...) —ids, estados y hasta el sufijo saldrían distintos—, y MSYS reescribe como rutas de
# Windows los argumentos que empiezan por «/», como /subscriptions/... Hacia la terminal se
# deja pasar tal cual, para que las preguntas de `az` se vean.
#
# Sin esa reescritura, una ruta de archivo como /c/Users/... llega a `az` —un programa de
# Windows— como C:\c\Users\...: las que se le pasan van por `ruta`.
case "${OSTYPE:-}" in
  msys* | cygwin*)
    export MSYS_NO_PATHCONV=1
    az() {
      if [ -t 1 ]; then
        command az "$@"
      else
        command az "$@" | tr -d '\r'
      fi
    }
    ruta() { cygpath -m "$1"; }
    ;;
  *)
    ruta() { printf '%s' "$1"; }
    ;;
esac

REGION="${REGION:-mexicocentral}"
GRUPO="${GRUPO:-rg-arriendos360}"

SUSCRIPCION="$(az account show --query id -o tsv)"
TENANT="$(az account show --query tenantId -o tsv)"
SUFIJO="$(printf '%s' "$SUSCRIPCION" | sha256sum | cut -c1-6)"

KEYVAULT="kv-arriendos360-$SUFIJO"
IDENTIDAD_APPS="id-arriendos360-apps"
IDENTIDAD_DESPLIEGUE="id-arriendos360-despliegue"

# El pipeline del corte 6 entra por OIDC desde este repositorio y este entorno de GitHub,
# que es el que exige aprobación. Cambiarlos invalida la credencial federada.
REPO_GITHUB="Arriendos360/Arriendos360"
ENTORNO_GITHUB="produccion"

# Dueño del token `ghcr-token` con el que Container Apps descarga las imágenes. No es secreto.
USUARIO_GHCR="${USUARIO_GHCR:-jsediazr}"

ENTORNO="cae-arriendos360"

# modo_entorno: el modo del entorno de Container Apps. Tiene que ser WorkloadProfiles; en
# Express no hay Jobs ni referencias a Key Vault (docs/adr/0022). Sólo lo expone una API en
# preview.
modo_entorno() {
  az rest --method get \
    --url "https://management.azure.com/subscriptions/$SUSCRIPCION/resourceGroups/$GRUPO/providers/Microsoft.App/managedEnvironments/$ENTORNO?api-version=2026-03-02-preview" \
    --query properties.environmentMode -o tsv
}
