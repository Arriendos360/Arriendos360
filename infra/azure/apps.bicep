// Las seis Container Apps y el Job del motor — corte 4 (docs/adr/0022)
//
// `gateway` con ingreso externo por HTTPS; los cinco servicios con ingreso interno, llamados
// por `http://ms-*`. Todas escalan a cero. El Job `motor-financiero` corre el motor a las
// 00:01 de Bogotá (`1 5 * * *` en UTC, `docs/adr/0021`) con la imagen de ms-financiero, y
// ms-financiero lleva MOTOR_PROGRAMACION=trabajo para no programarlo también.
//
// Requiere base.bicep y trabajos.bicep desplegados con LA MISMA etiqueta, y las migraciones
// ejecutadas: aquí MIGRACIONES_AL_ARRANCAR=no, y con una pendiente la revisión no arranca.
// Se despliega con infra/azure/desplegar-apps.sh.
//
// Las variables son las que cada proceso exige al arrancar (`OBLIGATORIAS` de cada
// server.ts) más las de Azure. Ningún valor secreto pasa por aquí: todos son referencias al
// Key Vault, incluida la dirección de Gmail (`email-usuario`), que no es secreta pero es
// personal y no va en el repositorio.

@description('Sufijo de 6 caracteres de los nombres globales. Lo calcula infra/azure/comun.sh.')
@minLength(6)
@maxLength(6)
param sufijo string

@description('Etiqueta de cada imagen en GHCR: {"gateway":"<commit>","ms-identidad":"<commit>",…}. La calcula infra/azure/etiquetas.sh con el último commit que tocó cada servicio, así que una app cuya etiqueta no cambió no estrena revisión.')
param etiquetas object

@description('Usuario de GitHub dueño del token `ghcr-token`.')
param usuarioRegistro string

@description('URL pública de la SPA para el enlace del correo de recuperación. Vacía hasta el corte 5.')
param urlApp string = ''

@description('Orígenes CORS del gateway, separados por comas. Vacío: cualquiera, hasta el corte 5.')
param corsOrigenes string = ''

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

// Dentro del entorno cada app se alcanza por su nombre, en el puerto 80 de su ingreso.
var url = {
  identidad: 'http://ms-identidad'
  inmuebles: 'http://ms-inmuebles'
  contratos: 'http://ms-contratos'
  financiero: 'http://ms-financiero'
  notificaciones: 'http://ms-notificaciones'
}

// Pool de 3 por réplica: con una réplica por servicio y los Jobs, muy por debajo de las 35
// conexiones del B1ms.
var baseDatos = [
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
    value: '3'
  }
]

var migracionesFuera = [
  {
    name: 'MIGRACIONES_AL_ARRANCAR'
    value: 'no'
  }
]

var jwtUsuario = [
  {
    name: 'JWT_SECRET'
    secretRef: 'jwt-secret'
  }
]

// Los clientes internos esperan 3 s por defecto, y un servicio que despierta de cero tarda
// más: sin esto, la primera llamada a un servicio dormido falla —el motor de las 00:01
// contra ms-contratos, el dashboard, la pertenencia—. 30 s, por debajo de los 60 s del
// proxy del gateway, para que un fallo interno llegue antes que el del proxy.
func esperasAlDespertar(variables array) array =>
  map(variables, variable => {
    name: variable
    value: '30000'
  })

func deProceso(nombre string, puerto int) array => [
  {
    name: 'PORT'
    value: string(puerto)
  }
  {
    name: 'SERVICIO_NOMBRE'
    value: nombre
  }
  {
    name: 'SERVICIO_JWT_SECRET'
    secretRef: 'servicio-jwt-secret'
  }
]

// ─────────────────────────────────────────────────────────────────── gateway

module gateway 'modulos/app.bicep' = {
  name: 'app-gateway'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'gateway'
    imagen: '${registro}/gateway:${etiquetas.gateway}'
    puerto: 3001
    externo: true
    secretos: [
      'jwt-secret'
      'servicio-jwt-secret'
    ]
    variables: concat(
      deProceso('gateway', 3001),
      jwtUsuario,
      [
        {
          name: 'MS_IDENTIDAD_URL'
          value: url.identidad
        }
        {
          name: 'MS_INMUEBLES_URL'
          value: url.inmuebles
        }
        {
          name: 'MS_CONTRATOS_URL'
          value: url.contratos
        }
        {
          name: 'MS_FINANCIERO_URL'
          value: url.financiero
        }
        // El ingreso de Container Apps es el único salto delante del gateway: la IP del
        // cliente es la última de X-Forwarded-For (`docs/adr/0020`).
        {
          name: 'PROXY_SALTOS_CONFIANZA'
          value: '1'
        }
        // Un servicio que despierta de cero tarda más que los 10 s por defecto.
        {
          name: 'PROXY_TIMEOUT_MS'
          value: '60000'
        }
      ],
      esperasAlDespertar([
        'MS_IDENTIDAD_TIMEOUT_MS'
        'MS_INMUEBLES_TIMEOUT_MS'
        'MS_CONTRATOS_TIMEOUT_MS'
        'MS_FINANCIERO_TIMEOUT_MS'
      ]),
      empty(corsOrigenes)
        ? []
        : [
            {
              name: 'CORS_ORIGENES'
              value: corsOrigenes
            }
          ]
    )
  }
}

// ───────────────────────────────────────────────────────────────── servicios

module identidad 'modulos/app.bicep' = {
  name: 'app-ms-identidad'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'ms-identidad'
    imagen: '${registro}/ms-identidad:${etiquetas['ms-identidad']}'
    puerto: 3011
    externo: false
    secretos: [
      'db-password'
      'jwt-secret'
      'servicio-jwt-secret'
    ]
    variables: concat(deProceso('ms-identidad', 3011), baseDatos, jwtUsuario, migracionesFuera, [
      {
        name: 'MS_NOTIFICACIONES_URL'
        value: url.notificaciones
      }
    ])
  }
}

module inmuebles 'modulos/app.bicep' = {
  name: 'app-ms-inmuebles'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'ms-inmuebles'
    imagen: '${registro}/ms-inmuebles:${etiquetas['ms-inmuebles']}'
    puerto: 3012
    externo: false
    secretos: [
      'db-password'
      'jwt-secret'
      'servicio-jwt-secret'
    ]
    variables: concat(deProceso('ms-inmuebles', 3012), baseDatos, jwtUsuario, migracionesFuera, esperasAlDespertar([
      'MS_IDENTIDAD_TIMEOUT_MS'
    ]), [
      {
        name: 'MS_IDENTIDAD_URL'
        value: url.identidad
      }
    ])
  }
}

module contratos 'modulos/app.bicep' = {
  name: 'app-ms-contratos'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'ms-contratos'
    imagen: '${registro}/ms-contratos:${etiquetas['ms-contratos']}'
    puerto: 3013
    externo: false
    secretos: [
      'db-password'
      'jwt-secret'
      'servicio-jwt-secret'
      'storage-connection-string'
    ]
    variables: concat(deProceso('ms-contratos', 3013), baseDatos, jwtUsuario, migracionesFuera, esperasAlDespertar([
      'MS_IDENTIDAD_TIMEOUT_MS'
      'MS_INMUEBLES_TIMEOUT_MS'
      'COMPOSICION_TIMEOUT_MS'
    ]), [
      {
        name: 'MS_IDENTIDAD_URL'
        value: url.identidad
      }
      {
        name: 'MS_INMUEBLES_URL'
        value: url.inmuebles
      }
      {
        name: 'MS_FINANCIERO_URL'
        value: url.financiero
      }
      // Con cadena de conexión los anexos van a Blob en vez de al disco del contenedor,
      // que en Container Apps se pierde con cada réplica.
      {
        name: 'AZURE_STORAGE_CONNECTION_STRING'
        secretRef: 'storage-connection-string'
      }
      {
        name: 'AZURE_STORAGE_CONTENEDOR'
        value: 'anexos'
      }
    ])
  }
}

module financiero 'modulos/app.bicep' = {
  name: 'app-ms-financiero'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'ms-financiero'
    imagen: '${registro}/ms-financiero:${etiquetas['ms-financiero']}'
    puerto: 3014
    externo: false
    secretos: [
      'db-password'
      'jwt-secret'
      'servicio-jwt-secret'
    ]
    variables: concat(deProceso('ms-financiero', 3014), baseDatos, jwtUsuario, migracionesFuera, esperasAlDespertar([
      'MS_CONTRATOS_TIMEOUT_MS'
      'MS_IDENTIDAD_TIMEOUT_MS'
    ]), [
      {
        name: 'MS_CONTRATOS_URL'
        value: url.contratos
      }
      {
        name: 'MS_IDENTIDAD_URL'
        value: url.identidad
      }
      {
        name: 'MS_NOTIFICACIONES_URL'
        value: url.notificaciones
      }
      {
        name: 'MOTOR_PROGRAMACION'
        value: 'trabajo'
      }
    ])
  }
}

module notificaciones 'modulos/app.bicep' = {
  name: 'app-ms-notificaciones'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'ms-notificaciones'
    imagen: '${registro}/ms-notificaciones:${etiquetas['ms-notificaciones']}'
    puerto: 3015
    externo: false
    // Sin JWT_SECRET: no tiene endpoints públicos (regla 7 por vacío).
    secretos: [
      'db-password'
      'servicio-jwt-secret'
      'email-usuario'
      'email-pass'
    ]
    variables: concat(
      deProceso('ms-notificaciones', 3015),
      baseDatos,
      migracionesFuera,
      esperasAlDespertar([
        'MS_IDENTIDAD_TIMEOUT_MS'
      ]),
      [
        {
          name: 'MS_IDENTIDAD_URL'
          value: url.identidad
        }
        // Gmail por SMTP autenticado en el 587, que Azure no bloquea. Temporal: ver
        // «Correo» en las decisiones de CLAUDE.md.
        {
          name: 'EMAIL_HOST'
          value: 'smtp.gmail.com'
        }
        {
          name: 'EMAIL_PORT'
          value: '587'
        }
        {
          name: 'EMAIL_USER'
          secretRef: 'email-usuario'
        }
        {
          name: 'EMAIL_PASS'
          secretRef: 'email-pass'
        }
        // Gmail reescribe el remitente si no es la cuenta que se autentica.
        {
          name: 'EMAIL_REMITENTE'
          secretRef: 'email-usuario'
        }
      ],
      empty(urlApp)
        ? []
        : [
            {
              name: 'URL_APP'
              value: urlApp
            }
          ]
    )
  }
}

// ──────────────────────────────────────────────────────────────────── motor

module motor 'modulos/trabajo.bicep' = {
  name: 'motor-financiero'
  params: {
    ubicacion: ubicacion
    entornoId: entorno.id
    identidadId: identidadApps.id
    keyVaultUri: keyVault.properties.vaultUri
    usuarioRegistro: usuarioRegistro
    nombre: 'motor-financiero'
    imagen: '${registro}/ms-financiero:${etiquetas['ms-financiero']}'
    comando: [
      'node'
      'dist/scripts/motor.js'
    ]
    // 00:01 en Bogotá, que es UTC-5 todo el año.
    cron: '1 5 * * *'
    // El barrido es corto, pero entrega sus avisos con pausas; dos reintentos si falla,
    // que es seguro porque el motor es idempotente.
    tiempoLimiteSegundos: 1800
    reintentos: 2
    secretos: [
      'db-password'
      'servicio-jwt-secret'
    ]
    variables: concat(baseDatos, esperasAlDespertar([
      'MS_CONTRATOS_TIMEOUT_MS'
    ]), [
      {
        name: 'SERVICIO_NOMBRE'
        value: 'ms-financiero'
      }
      {
        name: 'SERVICIO_JWT_SECRET'
        secretRef: 'servicio-jwt-secret'
      }
      {
        name: 'MS_CONTRATOS_URL'
        value: url.contratos
      }
      {
        name: 'MS_NOTIFICACIONES_URL'
        value: url.notificaciones
      }
    ])
  }
}

output urlGateway string = 'https://${gateway.outputs.fqdn}'
output apps array = [
  gateway.outputs.fqdn
  identidad.outputs.fqdn
  inmuebles.outputs.fqdn
  contratos.outputs.fqdn
  financiero.outputs.fqdn
  notificaciones.outputs.fqdn
]
output trabajoMotor string = motor.outputs.nombre
output etiquetas object = etiquetas
