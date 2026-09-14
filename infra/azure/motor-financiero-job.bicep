// Trabajo programado del motor financiero — Arriendos360
//
// Sustituye al cron que corria dentro de ms-financiero. En Container Apps el servicio
// escala a cero sin trafico, y un contenedor dormido a las 00:01 no dispara su cron:
// no se generarian cuentas de cobro ni alertas, sin error ni log. Ver docs/adr/0021.
//
// Este trabajo levanta la MISMA imagen que la Container App de ms-financiero, ejecuta
// `npm run motor` y se apaga. El script sale con 1 si algo falla, y entonces el
// trabajo reintenta (`replicaRetryLimit`). Reintentar es seguro: el motor es
// idempotente.
//
// La Container App de ms-financiero tiene que llevar MOTOR_PROGRAMACION=trabajo, para
// que el proceso no programe su propio cron. Si llevara `cron` y el contenedor
// estuviera despierto, el motor correria dos veces: no duplicaria nada, pero no es lo
// que se quiere.
//
// Módulo del paso 8. No se ha validado con `az bicep build`: en la máquina donde se
// escribió no había CLI de Azure.

@description('Nombre del trabajo.')
param nombre string = 'motor-financiero'

@description('Region. Por defecto, la del grupo de recursos.')
param ubicacion string = resourceGroup().location

@description('Id del entorno de Container Apps donde vive ms-financiero.')
param entornoId string

@description('Imagen de ms-financiero: la MISMA etiqueta que despliega la Container App del servicio.')
param imagen string

@description('Servidor del registro de contenedores.')
param registroServidor string

@description('Usuario del registro de contenedores.')
param registroUsuario string

@secure()
@description('Contraseña del registro de contenedores.')
param registroContrasena string

@description('Host de PostgreSQL.')
param dbHost string

@description('Base de datos.')
param dbNombre string = 'arriendos360_db'

@description('Usuario de PostgreSQL.')
param dbUsuario string

@secure()
@description('Contraseña de PostgreSQL.')
param dbContrasena string

@secure()
@description('SERVICIO_JWT_SECRET: el motor llama a /interno de ms-contratos.')
param servicioJwtSecret string

@description('URL interna de ms-contratos.')
param msContratosUrl string

// 00:01 en Bogota. Los trabajos programados evaluan el cron en UTC, y Bogota es
// UTC-5 todo el año, sin horario de verano.
var cronUtc = '1 5 * * *'

resource motor 'Microsoft.App/jobs@2023-05-01' = {
  name: nombre
  location: ubicacion
  properties: {
    environmentId: entornoId
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cronUtc
        parallelism: 1
        replicaCompletionCount: 1
      }
      // Media hora sobra para un barrido diario; dos reintentos si sale con error.
      replicaTimeout: 1800
      replicaRetryLimit: 2
      secrets: [
        {
          name: 'registro-contrasena'
          value: registroContrasena
        }
        {
          name: 'db-contrasena'
          value: dbContrasena
        }
        {
          name: 'servicio-jwt-secret'
          value: servicioJwtSecret
        }
      ]
      registries: [
        {
          server: registroServidor
          username: registroUsuario
          passwordSecretRef: 'registro-contrasena'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'motor'
          image: imagen
          command: [
            'npm'
            'run'
            'motor'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DB_HOST'
              value: dbHost
            }
            {
              name: 'DB_PORT'
              value: '5432'
            }
            {
              name: 'DB_NAME'
              value: dbNombre
            }
            {
              name: 'DB_USER'
              value: dbUsuario
            }
            {
              name: 'DB_PASSWORD'
              secretRef: 'db-contrasena'
            }
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
              value: msContratosUrl
            }
          ]
        }
      ]
    }
  }
}

output nombreTrabajo string = motor.name
