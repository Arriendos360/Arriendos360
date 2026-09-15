# ADR 0021 — El motor financiero lo ejecuta un trabajo programado de Container Apps

- **Estado:** aceptada
- **Fecha:** 2026-09-14
- **Paso:** 8 (despliegue)
- **Se aparta del Capítulo 2:** no. Salda la deuda bloqueante del `docs/adr/0018`.

## Contexto

`procesarContratos` y `procesarPagos` corrían con `node-cron` dentro de ms-financiero.
En Azure Container Apps el servicio escala a cero sin tráfico, y un contenedor dormido a
las 00:01 no dispara su cron: no se generan cuentas de cobro ni alertas, sin error ni
log. Era la única decisión abierta marcada como bloqueante para producción.

Al revisar el motor para ejecutarlo de otra forma aparecieron cuatro problemas que un
trabajo programado —que se reintenta y puede solaparse— hacía visibles:

1. `CuentaCobroPorVencer` se anotaba con `id_evento` aleatorio y no dejaba rastro en la
   base, así que dos ejecuciones el mismo día mandaban el aviso dos veces.
2. Dos ejecuciones simultáneas leían la misma cuenta en `PENDIENTE` y las dos la marcaban
   en mora y avisaban.
3. Los barridos se tragaban sus errores: `npm run motor` salía con 0 aunque fallara, y un
   trabajo programado no habría reintentado nunca.
4. El cron no fijaba zona horaria: en un contenedor en UTC, las 00:01 eran las 19:01 del
   día anterior en Bogotá.

## Decisión

### Un trabajo con la misma imagen y `npm run motor`, no un endpoint

Un `Microsoft.App/jobs` con `triggerType: Schedule` levanta la imagen de ms-financiero,
ejecuta `npm run motor` y se apaga (`infra/azure/motor-financiero-job.bicep`).

> **Anotación (paso 8, corte 4, `docs/adr/0022`):** el Job vive ahora en
> `infra/azure/apps.bicep` con el comando compilado `node dist/scripts/motor.js` y los
> secretos como referencias al Key Vault; `motor-financiero-job.bicep` se borró. Antes de
> salir, el script entrega los avisos que anotó, porque con ms-financiero escalado a cero
> nadie más los publicaría.

Se descartó que el trabajo llamara a un endpoint interno del servicio:

- **El estado de la ejecución es el código de salida**, que es lo que Container Apps usa
  para reintentar. Con un endpoint sería un código HTTP, y un tiempo de espera agotado
  a mitad de barrido parecería un fallo aunque hubiera facturado la mitad.
- **No hay que despertar la API desde cero**, ni firmar una credencial de servicio desde
  el trabajo —un `curl` no firma un JWT—, ni ajustarse al tiempo límite del ingreso.
- **No se abre un disparador de escritura nuevo en `/interno`.**
- **La misma imagen es la misma versión de código** que el servicio.

El coste es repetir en el trabajo la configuración de entorno que usa el motor: base de
datos, `SERVICIO_JWT_SECRET` y `MS_CONTRATOS_URL`.

La expresión es `1 5 * * *`: los trabajos programados evalúan el cron en UTC, y las 00:01
de Bogotá son las 05:01 UTC todo el año.

### El motor es idempotente

Puede ejecutarse dos veces el mismo día, seguidas o a la vez, sin duplicar nada:

| Qué | Cómo |
|---|---|
| Generar una cuenta | Comprobación previa e índice único `(id_contrato, inicio)`. Si una ejecución concurrente gana la carrera, el `UniqueConstraintError` se trata como «ya existe»; la transacción se lleva también su aviso. |
| Aviso previo | `id_evento` derivado de tipo y cuenta (`idDeEventoDeterminista`, UUID v5), y la tabla de salida con `ON CONFLICT (id_evento) DO NOTHING`. Una cuenta tiene un solo día de aviso previo. |
| Paso a mora | Dentro de la transacción la cuenta se relee bloqueada (`SELECT … FOR UPDATE`) y con el estado en el filtro. La segunda ejecución espera el bloqueo, ya no la encuentra y no marca ni avisa. |

Si aun así llegara a salir un evento repetido, ms-notificaciones lo descarta por
`id_evento`. Es la segunda red, no la primera.

### Los fallos no se tragan

`procesarContratos` y `procesarPagos` devuelven sus fallos en vez de sólo registrarlos.
Un contrato o una cuenta que falla no detiene el resto. `ejecutarMotor()` los junta y
`scripts/motor.ts` sale con 1 si hay alguno. Reintentar es seguro por lo anterior: la
segunda ejecución sólo hace lo que faltó.

### La diferencia entre entornos está escrita

`MOTOR_PROGRAMACION` es obligatoria y no tiene valor por defecto:

- `cron` en Compose y en local: `node-cron` dentro del proceso, a las 00:01 con
  `timezone: America/Bogota` y `noOverlap`.
- `trabajo` en Container Apps: el proceso no programa nada.

Un valor ausente o distinto de esos dos impide arrancar el servicio. `npm run motor` se
conserva para las demostraciones, y es el mismo comando que ejecuta el trabajo.

## Consecuencias

- Las pruebas del motor fijan la idempotencia contra PostgreSQL: dos ejecuciones
  seguidas, dos a la vez y un reintento tras fallo dan una cuenta y un aviso de cada tipo.
- **Si alguien deja `cron` en Container Apps**, con el contenedor despierto el motor
  correría dos veces. No duplicaría nada, pero hay que corregir la configuración.
- **Un día sin ejecución** —todos los reintentos fallidos— se recupera al día siguiente en
  la generación (la ventana es de dos días antes del corte a dos después) y en la mora (la
  condición es «al menos seis días»). **El aviso previo de ese día se pierde**, porque es
  de un único día.
- El Bicep del trabajo es un módulo aislado y **no se ha validado** con `az bicep build`;
  se integra con el resto del despliegue del paso 8.
- Quien arranque ms-financiero en local con `npm run dev` tiene que añadir
  `MOTOR_PROGRAMACION=cron` a su `.env`.
