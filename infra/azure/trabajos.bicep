// Jobs manuales de migración y de datos de demostración — corte 3 (docs/adr/0022)
//
// Un Job por servicio aplica SUS migraciones, y sólo las suyas (regla dura 3), con
// `node dist/database/aplicar.js` desde la imagen de producción del servicio. `seed-identidad`
// siembra los usuarios de demostración, que son de ms-identidad.
//
// Todos manuales: los lanza infra/azure/ejecutar-trabajo.sh y, desde el corte 6, el pipeline,
// siempre ANTES de publicar revisiones nuevas de los servicios. Relanzarlos es seguro: el
// runner toma un bloqueo consultivo por esquema y salta lo ya aplicado, y el seed no repite
// usuarios.
//
// Requiere base.bicep desplegado. Los secretos son referencias al Key Vault resueltas con
// `id-arriendos360-apps`, y la imagen se descarga de GHCR con el token `ghcr-token`, también
// desde el Key Vault. Se despliega con infra/azure/desplegar-trabajos.sh.

@description('Sufijo de 6 caracteres de los nombres globales. Lo calcula infra/azure/comun.sh.')
@minLength(6)
@maxLength(6)
param sufijo string

@description('Etiqueta de cada imagen en GHCR: {"gateway":"<commit>","ms-identidad":"<commit>",…}. La calcula infra/azure/etiquetas.sh con el último commit que tocó cada servicio.')
param etiquetas object

@description('Usuario de GitHub dueño del token `ghcr-token`.')
param usuarioRegistro string

@description('Base con los cinco esquemas; la misma que base.bicep.')
param basePostgres string = 'arriendos360_db'

@description('Región. Por defecto, la del grupo de recursos.')
param ubicacion string = resourceGroup().location

var registro = 'ghcr.io/arriendos360'

resource entorno 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: 'cae-arriendos360'
}

resource identidadApps 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-arriendos360-apps'
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'kv-arriendos360-${sufijo}'
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: 'psql-arriendos360-${sufijo}'
}

// Lo mismo que lee `config/database.ts` de cada servicio. Un pool de 2 basta para un proceso
// que migra y sale, y deja conexiones de sobra de las 35 del B1ms.
var variablesBase = [
  {
    name: 'DB_HOST'
    value: postgres.properties.fullyQualifiedDomainName
  }
  {
    name: 'DB_PORT'
    value: '5432'
  }
  {
    name: 'DB_NAME'
    value: basePostgres
  }
  {
    name: 'DB_USER'
    value: postgres.properties.administratorLogin
  }
  {
    name: 'DB_PASSWORD'
    secretRef: 'db-password'
  }
  {
    name: 'DB_SSL'
    value: 'si'
  }
  {
    name: 'DB_POOL_MAX'
    value: '2'
  }
]

var servicios = [
  'identidad'
  'inmuebles'
  'contratos'
  'financiero'
  'notificaciones'
]

module migrar 'modulos/trabajo.bicep' = [
  for servicio in servicios: {
    name: 'migrar-${servicio}'
    params: {
      nombre: 'migrar-${servicio}'
      ubicacion: ubicacion
      entornoId: entorno.id
      identidadId: identidadApps.id
      keyVaultUri: keyVault.properties.vaultUri
      imagen: '${registro}/ms-${servicio}:${etiquetas['ms-${servicio}']}'
      comando: [
        'node'
        'dist/database/aplicar.js'
      ]
      variables: variablesBase
      secretos: [
        'db-password'
      ]
      usuarioRegistro: usuarioRegistro
    }
  }
]

module seedIdentidad 'modulos/trabajo.bicep' = {
  name: 'seed-identidad'
  params: {
    nombre: 'seed-identidad'
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    imagen: '${registro}/ms-identidad:${etiquetas['ms-identidad']}'
    comando: [
      'node'
      'dist/database/seed.js'
    ]
    variables: variablesBase
    secretos: [
      'db-password'
    ]
    usuarioRegistro: usuarioRegistro
  }
}

output trabajos array = concat(map(servicios, servicio => 'migrar-${servicio}'), [
  seedIdentidad.outputs.nombre
])
// Las etiquetas desplegadas: `servicios-a-migrar.sh` las compara con las nuevas para saber
// qué esquemas hay que migrar.
output etiquetas object = etiquetas
