// Infraestructura base de Arriendos360 — corte 2 (docs/adr/0022)
//
// Log Analytics con tope diario, el entorno de Container Apps sin apps, PostgreSQL y
// Storage con el contenedor de anexos. Las apps y los Jobs llegan en los cortes 3 y 4.
//
// Requiere lo que crea infra/azure/bootstrap.sh: el grupo, el Key Vault y su secreto
// `db-password`. Se despliega con infra/azure/desplegar-base.sh.
//
// Ningún valor secreto pasa por aquí ni por el repositorio. La contraseña de PostgreSQL
// se lee del Key Vault al desplegar, y la cadena de conexión de Storage, que Azure genera
// al crear la cuenta, se escribe directamente en el Key Vault.

@description('Sufijo de 6 caracteres que hace únicos los nombres globales. Lo calcula infra/azure/comun.sh.')
@minLength(6)
@maxLength(6)
param sufijo string

@description('Región. Por defecto, la del grupo de recursos.')
param ubicacion string = resourceGroup().location

@description('Usuario administrador de PostgreSQL. Azure no admite `postgres` ni `azure_superuser`.')
param administradorPostgres string = 'arriendos360'

@description('Base con los cinco esquemas; el mismo nombre que en Compose.')
param basePostgres string = 'arriendos360_db'

var nombres = {
  keyVault: 'kv-arriendos360-${sufijo}'
  logs: 'log-arriendos360'
  entorno: 'cae-arriendos360'
  almacenamiento: 'starriendos360${sufijo}'
  postgres: 'psql-arriendos360-${sufijo}'
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: nombres.keyVault
}

// ─────────────────────────────────────────────────────────────────────── logs

// El plan de consumo trae 5 GB gratis al mes: 0,15 GB diarios se quedan por debajo. Al
// llegar al tope se deja de recoger hasta el día siguiente; no se cobra de más.
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: nombres.logs
  location: ubicacion
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.15')
    }
  }
}

// ──────────────────────────────────────────────────────────────────── entorno

// Sin `workloadProfiles`: entorno sólo de consumo, que escala a cero y entra en la
// concesión gratuita mensual de Container Apps.
resource entorno 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: nombres.entorno
  location: ubicacion
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

// ─────────────────────────────────────────────────────────────── almacenamiento

resource almacenamiento 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: nombres.almacenamiento
  location: ubicacion
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    // Los anexos sólo se descargan por la API autenticada (docs/adr/0014).
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // ms-contratos entra con cadena de conexión (AZURE_STORAGE_CONNECTION_STRING).
    allowSharedKeyAccess: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: almacenamiento
  name: 'default'
}

resource anexos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'anexos'
  properties: {
    publicAccess: 'None'
  }
}

resource cadenaAlmacenamiento 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'storage-connection-string'
  properties: {
    value: 'DefaultEndpointsProtocol=https;AccountName=${almacenamiento.name};AccountKey=${almacenamiento.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
  }
}

// ─────────────────────────────────────────────────────────────────── postgres

// En un módulo porque `getSecret` sólo puede entregarse a un parámetro seguro de módulo.
module postgres 'modulos/postgres.bicep' = {
  name: 'postgres'
  params: {
    nombre: nombres.postgres
    ubicacion: ubicacion
    administrador: administradorPostgres
    contrasenaAdministrador: keyVault.getSecret('db-password')
    base: basePostgres
  }
}

// ──────────────────────────────────────────────────────────────────── salidas
// Nada secreto: las leen los cortes siguientes y infra/azure/verificar-base.sh.

output nombreKeyVault string = keyVault.name
output nombreLogs string = logs.name
output idEntorno string = entorno.id
output nombreEntorno string = entorno.name
output dominioEntorno string = entorno.properties.defaultDomain
output nombreAlmacenamiento string = almacenamiento.name
output nombrePostgres string = nombres.postgres
output hostPostgres string = postgres.outputs.host
output administradorPostgres string = administradorPostgres
output basePostgres string = basePostgres
