# Nombres compartidos por los scripts de infra/azure. Se carga con `source`, no se ejecuta.
# Requiere una sesión de `az` (Cloud Shell ya la tiene).
#
# Key Vault, Storage y PostgreSQL necesitan nombres únicos en todo Azure: llevan un sufijo
# derivado del id de la suscripción, estable entre ejecuciones y sin guardar nada en el
# repositorio. base.bicep recibe el mismo sufijo y deriva de él el resto de nombres.

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
