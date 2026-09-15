// Job de Container Apps que corre un comando de una imagen y sale (docs/adr/0022).
//
// Manual si `cron` va vacío; programado si no, con el cron evaluado en UTC. Los secretos que
// usa el contenedor se declaran como referencias al Key Vault, resueltas con la identidad
// administrada: ningún valor pasa por la plantilla. `ghcr-token` se añade siempre, porque es
// la contraseña con la que el entorno descarga la imagen privada de GHCR.

param nombre string
param ubicacion string
param entornoId string

@description('Id de la identidad administrada con «Key Vault Secrets User» sobre el Key Vault.')
param identidadId string

@description('URI del Key Vault, terminada en «/».')
param keyVaultUri string

param imagen string
param comando array

@description('Variables de entorno: { name, value } o { name, secretRef }.')
param variables array

@description('Nombres de los secretos del Key Vault que referencian las variables.')
param secretos array

@description('Usuario de GitHub dueño de `ghcr-token`.')
param usuarioRegistro string

@description('Expresión cron en UTC. Vacía: Job manual.')
param cron string = ''

@description('Segundos antes de dar la réplica por fallida.')
param tiempoLimiteSegundos int = 600

@description('Reintentos si el contenedor sale con error. Sólo para comandos idempotentes.')
param reintentos int = 1

var disparador = empty(cron)
  ? {
      triggerType: 'Manual'
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
  : {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cron
        parallelism: 1
        replicaCompletionCount: 1
      }
    }

var secretosKeyVault = [
  for secreto in union(secretos, ['ghcr-token']): {
    name: secreto
    keyVaultUrl: '${keyVaultUri}secrets/${secreto}'
    identity: identidadId
  }
]

resource trabajo 'Microsoft.App/jobs@2024-03-01' = {
  name: nombre
  location: ubicacion
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identidadId}': {}
    }
  }
  properties: {
    environmentId: entornoId
    configuration: union(disparador, {
      replicaTimeout: tiempoLimiteSegundos
      replicaRetryLimit: reintentos
      secrets: secretosKeyVault
      registries: [
        {
          server: 'ghcr.io'
          username: usuarioRegistro
          passwordSecretRef: 'ghcr-token'
        }
      ]
    })
    template: {
      containers: [
        {
          name: 'principal'
          image: imagen
          command: comando
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: variables
        }
      ]
    }
  }
}

output nombre string = trabajo.name
