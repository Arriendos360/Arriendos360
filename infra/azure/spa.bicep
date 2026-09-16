// Static Web App de la SPA — corte 5 (docs/adr/0022)
//
// Plan Free: alojamiento estático con HTTPS y dominio de Azure, sin costo. Sólo sirve el
// build de `apps/web`; la API entra únicamente por el gateway, que es quien aplica RBAC.
//
// NO se enlaza a ningún repositorio: el Static Web App enlazado publica solo en cada push y
// guarda un token en los secretos de GitHub, que es justo lo que el plan evita. El contenido
// lo sube infra/azure/desplegar-spa.sh con un token pedido al vuelo, y en el corte 6 lo hará
// el pipeline.
//
// Va en `eastus2` y no en `mexicocentral`: el servicio sólo se ofrece en cinco regiones, y
// ésa es la única que además permite la política de la suscripción.

@description('Nombre del Static Web App.')
param nombre string = 'swa-arriendos360'

@description('Región de metadatos. Static Web Apps no existe en mexicocentral.')
@allowed([
  'eastus2'
  'centralus'
  'westus2'
  'westeurope'
  'eastasia'
])
param ubicacion string = 'eastus2'

resource spa 'Microsoft.Web/staticSites@2024-11-01' = {
  name: nombre
  location: ubicacion
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Sin proveedor: el contenido no viene de un repositorio conectado.
    provider: 'None'
    // Que `staticwebapp.config.json` del build mande: de ahí sale el navigationFallback.
    allowConfigFileUpdates: true
    // El plan Free no tiene entornos de preproducción; dejarlo explícito evita sorpresas.
    stagingEnvironmentPolicy: 'Disabled'
  }
}

output nombre string = spa.name
output host string = spa.properties.defaultHostname
output url string = 'https://${spa.properties.defaultHostname}'
