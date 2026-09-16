// Presupuesto con avisos — corte 7 (docs/adr/0022)
//
// El crédito de Azure for Students no se recarga: cuando se agota, la suscripción se
// deshabilita y TODO se detiene, sin aviso previo del propio Azure. Esto pone dos avisos por
// correo, al 50 % y al 80 % del gasto mensual previsto, para enterarse con margen.
//
// El presupuesto no corta nada ni cuesta nada: sólo avisa. El freno de verdad sigue siendo
// apagar PostgreSQL entre sesiones, que es lo único que cobra cuando nadie usa el sistema.
//
// Va en el grupo de recursos, no en la suscripción: así mide lo de este proyecto y no lo que
// haya en otros grupos.

@description('Gasto mensual previsto, en la moneda de la suscripción. Los avisos salen al 50 % y al 80 % de esta cifra.')
param montoMensual int = 25

@description('Dónde llega el aviso. Lo pasa desplegar-presupuesto.sh desde el secreto `email-usuario`.')
param correoAviso string

@description('Primer día del mes en curso. El presupuesto no puede empezar antes.')
param inicio string = utcNow('yyyy-MM-01')

resource presupuesto 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'presupuesto-arriendos360'
  properties: {
    category: 'Cost'
    amount: montoMensual
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: inicio
    }
    notifications: {
      // `Actual`: sobre lo ya gastado. Hay también previsiones, pero con un gasto tan pequeño
      // y tan escalonado darían falsas alarmas.
      mitad: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [
          correoAviso
        ]
      }
      casiTodo: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [
          correoAviso
        ]
      }
    }
  }
}

output nombre string = presupuesto.name
output monto int = montoMensual
