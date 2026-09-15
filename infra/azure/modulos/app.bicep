// Container App de Arriendos360 (docs/adr/0022).
//
// Revisión única, perfil Consumption y escala de 0 a 1 réplica. El tope de 1 no es sólo por
// costo: cada productor lleva su publicador dentro, y con varias réplicas el orden por clave
// deja de estar garantizado (decisión abierta en CLAUDE.md, `docs/adr/0012`).
//
// Ingreso externo sólo por HTTPS —HTTP redirige— para el gateway, que termina el TLS. Los
// servicios, con ingreso interno y HTTP, se llaman por `http://<nombre>` dentro del
// entorno: la red no protege nada, lo hacen los tokens de usuario y de servicio (reglas 7 y
// `docs/adr/0009`).
//
// Secretos como referencias al Key Vault resueltas con la identidad administrada;
// `ghcr-token` se añade siempre para descargar la imagen privada de GHCR.

param nombre string
param ubicacion string
param entornoId string

@description('Id de la identidad administrada con «Key Vault Secrets User» sobre el Key Vault.')
param identidadId string

@description('URI del Key Vault, terminada en «/».')
param keyVaultUri string

param imagen string

@description('Puerto en el que escucha el proceso.')
param puerto int

@description('true: ingreso público por HTTPS. false: sólo dentro del entorno.')
param externo bool

@description('Variables de entorno: { name, value } o { name, secretRef }.')
param variables array

@description('Nombres de los secretos del Key Vault que referencian las variables.')
param secretos array

@description('Usuario de GitHub dueño de `ghcr-token`.')
param usuarioRegistro string

resource app 'Microsoft.App/containerApps@2024-03-01' = {
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
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: externo
        targetPort: puerto
        transport: 'auto'
        allowInsecure: !externo
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        for secreto in union(secretos, ['ghcr-token']): {
          name: secreto
          keyVaultUrl: '${keyVaultUri}secrets/${secreto}'
          identity: identidadId
        }
      ]
      registries: [
        {
          server: 'ghcr.io'
          username: usuarioRegistro
          passwordSecretRef: 'ghcr-token'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'principal'
          image: imagen
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: variables
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
