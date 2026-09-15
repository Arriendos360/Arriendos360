#!/usr/bin/env bash
# Verificación del corte 2, desde Cloud Shell. Sólo lee: no crea ni cambia nada.
#
#   bash infra/azure/verificar-base.sh
#
# Comprueba los secretos (por nombre, nunca el valor), el tope de Log Analytics, el
# entorno, el contenedor de anexos y que PostgreSQL acepta TLS con el certificado
# verificado —lo mismo que hacen los servicios con DB_SSL=si— y rechaza conexiones sin TLS.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comun.sh"

FALLOS=0
ok() { printf '  ✔ %s\n' "$*"; }
fallo() { printf '  ✘ %s\n' "$*"; FALLOS=$((FALLOS + 1)); }
salida() { az deployment group show -g "$GRUPO" -n base --query "properties.outputs.$1.value" -o tsv; }

echo "== Secretos en $KEYVAULT"
presentes="$(az keyvault secret list --vault-name "$KEYVAULT" --query "[].name" -o tsv)"
for secreto in jwt-secret servicio-jwt-secret db-password storage-connection-string email-pass ghcr-token; do
  if grep -qx "$secreto" <<<"$presentes"; then ok "$secreto"; else fallo "$secreto no está"; fi
done

echo "== Log Analytics"
tope="$(az monitor log-analytics workspace show -g "$GRUPO" -n "$(salida nombreLogs)" \
  --query workspaceCapping.dailyQuotaGb -o tsv)"
if [ "$tope" = "0.15" ]; then ok "tope diario de $tope GB"; else fallo "tope diario: «$tope»"; fi

echo "== Entorno de Container Apps"
estado="$(az resource show --ids "$(salida idEntorno)" --query properties.provisioningState -o tsv)"
if [ "$estado" = "Succeeded" ]; then ok "$(salida nombreEntorno): $estado"; else fallo "entorno: $estado"; fi
modo="$(modo_entorno)"
if [ "$modo" = "WorkloadProfiles" ]; then ok "modo $modo"; else fallo "modo «$modo»: en Express no hay Jobs ni referencias a Key Vault"; fi

echo "== Storage"
ALMACENAMIENTO="$(salida nombreAlmacenamiento)"
publico="$(az storage account show -g "$GRUPO" -n "$ALMACENAMIENTO" --query allowBlobPublicAccess -o tsv)"
if [ "$publico" = "false" ]; then ok "sin acceso público a blobs"; else fallo "allowBlobPublicAccess=$publico"; fi
CADENA="$(az keyvault secret show --vault-name "$KEYVAULT" -n storage-connection-string --query value -o tsv --only-show-errors)"
existe="$(az storage container exists --name anexos --connection-string "$CADENA" --query exists -o tsv)"
unset CADENA
if [ "$existe" = "true" ]; then ok "contenedor anexos, con la cadena del Key Vault"; else fallo "contenedor anexos: $existe"; fi

echo "== PostgreSQL"
az postgres flexible-server firewall-rule list -g "$GRUPO" --server-name "$(salida nombrePostgres)" \
  --query "[].{regla:name, desde:startIpAddress, hasta:endIpAddress}" -o table

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT
(cd "$TRABAJO" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund pg@8 >/dev/null)

# El cliente pg toma PGHOST, PGUSER, PGDATABASE y PGPASSWORD del entorno. La contraseña sólo
# vive en el entorno de este proceso.
if ! (
  cd "$TRABAJO"
  export PGHOST="$(salida hostPostgres)"
  export PGUSER="$(salida administradorPostgres)"
  export PGDATABASE="$(salida basePostgres)"
  export PGPASSWORD="$(az keyvault secret show --vault-name "$KEYVAULT" -n db-password --query value -o tsv --only-show-errors)"
  node - <<'JS'
const { Client } = require('pg');

const conectar = async (ssl) => {
  const cliente = new Client({ ssl, connectionTimeoutMillis: 20000 });
  await cliente.connect();
  return cliente;
};

(async () => {
  let fallos = 0;

  try {
    const cliente = await conectar({ rejectUnauthorized: true });
    const { rows: [fila] } = await cliente.query(
      `SELECT split_part(version(), ',', 1) AS version, s.ssl, s.version AS protocolo
         FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`
    );
    await cliente.end();
    if (fila.ssl) {
      console.log(`  ✔ TLS con certificado verificado (${fila.protocolo}): ${fila.version}`);
    } else {
      console.log('  ✘ conectó, pero la sesión no va cifrada');
      fallos++;
    }
  } catch (error) {
    console.log(`  ✘ TLS con certificado verificado: ${error.message}`);
    fallos++;
  }

  try {
    const cliente = await conectar(false);
    await cliente.end();
    console.log('  ✘ aceptó una conexión SIN TLS');
    fallos++;
  } catch (error) {
    // Sólo cuenta el rechazo del servidor. Un timeout —desde fuera de Azure el firewall no
    // deja pasar— no prueba nada.
    const mensaje = error.message.split('\n')[0];
    if (/no encryption/i.test(mensaje)) {
      console.log(`  ✔ rechaza conexiones sin TLS: ${mensaje}`);
    } else {
      console.log(`  ✘ no se pudo comprobar el rechazo sin TLS: ${mensaje}`);
      fallos++;
    }
  }

  process.exit(fallos);
})();
JS
); then
  FALLOS=$((FALLOS + 1))
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "Corte 2 verificado."
else
  echo "$FALLOS comprobación(es) fallida(s)."
fi
exit "$FALLOS"
