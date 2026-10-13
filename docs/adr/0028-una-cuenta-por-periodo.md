# ADR 0028 — Una cuenta de cobro por periodo, y el cobro sin periodo

- **Estado:** aceptada
- **Fecha:** 2026-10-13
- **Se aparta del Capítulo 2:** sí, en la nulabilidad: `inicio` y `fin` de `Cuentas_cobro` admiten
  `NULL` en un cobro sin periodo. Pendiente de incorporar por PMP §13.3.2.

## Contexto

Un contrato acumulaba varias cuentas de cobro del mismo mes, cada una con el canon entero. El alta
manual (`POST /api/pagos/cuentas-cobro`) calculaba el periodo de corte y después lo pisaba con el
`inicio` y el `fin` del cuerpo. El índice único `(id_contrato, inicio)` sólo frena un `inicio`
idéntico, así que el 12 y el 13 del mismo mes pasaban. El sembrador de la demostración lo
disparaba: toma hoy como día de corte, y repetido otro día cobraba de nuevo cada periodo con la
fecha de ese día.

La indemnización de un contrato cancelado (ADR 0027) se cobraba por la misma puerta, en un día libre
dentro de un periodo ya cobrado.

## Decisión

1. **Un contrato activo tiene una cuenta por periodo, y el periodo es siempre uno de corte.**
   - El alta manual cobra el periodo de `periodoQueEmpiezaEn(inicio, día de corte)` o, sin
     `inicio`, el que toca hoy (`periodoAFacturar`, como el motor).
   - El `fin` del cuerpo se ignora.
   - Si el periodo ya tiene cuenta, `409`.

   Con `inicio` siempre en el día de corte, que no se edita (ADR 0027), el índice único actual basta
   para sostener la regla.
2. **En un contrato terminado, la cuenta no tiene periodo**: `inicio` y `fin` en `NULL`. Es la
   indemnización. El contrato ya no factura canon, así que no hay periodo al que atarla, y pedirle
   uno con `inicio` es `409`: no se reinterpreta en silencio.
3. **Un cobro sin periodo no entra en mora sola** ni recibe el aviso de vencimiento: la mora se
   cuenta desde el corte (ADR 0018), y no lo tiene. El motor y `verificar-mora` la saltan.
4. **`CuentaCobroGenerada` lleva `inicio` y `fin` en `null`** en ese caso, sin cambiar de versión:
   su único consumidor, ms-notificaciones, se despliega con el cambio y omite la fila «Periodo» del
   correo.

## Alternativas descartadas

- **Indemnización en el siguiente periodo libre:** la ataría a un periodo que no le corresponde.
- **Columna `concepto` (`CANON` / `INDEMNIZACION`):** una columna de dominio más, y la indemnización
  seguiría llevando unas fechas que no significan nada.
- **Comprobar solapes en lugar del índice:** innecesario mientras todo periodo salga de
  `periodoDeCorte()`.

## Consecuencias

- Las cuentas duplicadas que ya existían no se corrigen solas. Se limpian a mano: se conserva la del
  día de corte de cada mes y se borran las demás con sus transacciones.
- La SPA muestra «Sin periodo» y el concepto donde iba el mes. El alta de la indemnización ya no
  manda `inicio`.
- El sembrador busca la cuenta por mes, no por fecha exacta, y no siembra periodos en un contrato
  que ya no está activo.
