// PostgreSQL Flexible Server de Arriendos360 (docs/adr/0022).
//
// Standard_B1ms: el tamaño más pequeño, de CPU a ráfagas, suficiente para una carga
// esporádica. Admite 35 conexiones de usuario para los cinco servicios y sus Jobs, de ahí
// DB_POOL_MAX=3. Una sola instancia, sin alta disponibilidad.
//
// Acceso público restringido a servicios de Azure, con TLS obligatorio: es un riesgo
// aceptado frente a la red privada, que queda como decisión abierta.

param nombre string
param ubicacion string
param administrador string

@secure()
param contrasenaAdministrador string

param base string

resource servidor 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: nombre
  location: ubicacion
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    // La misma versión mayor que Compose (postgres:15-alpine).
    version: '15'
    administratorLogin: administrador
    administratorLoginPassword: contrasenaAdministrador
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
  }
}

// Los recursos hijos van en cadena: el servidor rechaza dos operaciones a la vez.

// Ya viene activado; se fija explícito para que nadie lo apague desde el portal sin que
// el siguiente despliegue lo restaure.
resource tlsObligatorio 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: servidor
  name: 'require_secure_transport'
  properties: {
    value: 'on'
    source: 'user-override'
  }
}

// 0.0.0.0–0.0.0.0 es la convención de Azure para «servicios de Azure»: incluye Container
// Apps y Cloud Shell, pero también recursos de otros clientes de Azure.
resource accesoAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: servidor
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    tlsObligatorio
  ]
}

resource baseDatos 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: servidor
  name: base
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [
    accesoAzure
  ]
}

output host string = servidor.properties.fullyQualifiedDomainName
