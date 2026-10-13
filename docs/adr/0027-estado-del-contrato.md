# ADR 0027 — Estado del contrato y su trazabilidad

- **Estado:** aceptada
- **Fecha:** 2026-10-13
- **Se aparta del Capítulo 2:** sí, por adición. Una tabla de dominio nueva, `historial_contratos`;
  los estados del SRS se presentan sobre los tres guardados, y el día de corte queda fijo. Pendiente
  de incorporar por PMP §13.3.2.

## Contexto

El RF-09 del SRS pide cambiar a mano el estado, el canon, la fecha de finalización y las fechas de
corte de un contrato; dejar trazabilidad de cada cambio; confirmar antes de cambiar el estado, y
alertar si se finaliza con pagos en mora. Nombra los estados Vigente, Renovado, Vencido con preaviso,
Finalizado y Cancelado.

El Capítulo 2 guarda tres: `activo`, `finalizado` y `cancelado`, y todo lo que factura, avisa o
protege mira `activo`. Hasta ahora `PUT /api/contratos/:id` aceptaba cualquier campo, así que el
estado se podía cambiar sin avisar a ms-inmuebles, y finalizar no miraba el estado ni distinguía un
contrato que no se renovó de uno que terminó antes de tiempo.

## Decisión

1. **Renovado y Vencido con preaviso son situaciones, no estados.** `GET /api/contratos` y `/:id`
   añaden `situacion` a cada contrato activo, deducida del cálculo del preaviso (`docs/adr/0026`):
   - `vencido_con_preaviso` si hay preaviso y llegó su vencimiento;
   - `renovado` si no hay preaviso y pasó `fin`: la ley lo prorrogó (art. 6 de la Ley 820);
   - `vigente` en cualquier otro caso.

   Un cuarto estado guardado obligaría a cambiar el `CHECK`, a que todo lo que mira `activo` mirara
   dos, y a que alguien lo moviera el día del vencimiento.
2. **Finalizado y Cancelado son terminales y sólo parten de `activo`.**
   - **Finalizar** es «no se renovó»: sólo con `vencido_con_preaviso`. Si no, `409` que remite a
     Cancelar.
   - **Cancelar** (`PUT /api/contratos/:id/cancelar`) es la terminación antes de tiempo, con un
     motivo del catálogo `MOTIVOS_CANCELACION`: mutuo acuerdo (art. 21), incumplimiento del
     arrendatario (art. 22 nums. 1 a 6) o del arrendador (art. 24 nums. 1 a 3), y terminación
     unilateral del arrendatario (art. 24 num. 4) o del arrendador durante la prórroga (art. 22
     num. 7). Las unilaterales sugieren 3 cánones de indemnización; el valor es pactable, así que el
     servidor valida la forma, no el sugerido.
   - Los dos escriben el estado, su fila de historial y **el mismo evento, `ContratoFinalizado`**,
     en una transacción. Lo que ms-inmuebles necesita saber es que el contrato dejó de ocupar el
     inmueble; un `ContratoCancelado` sería un tipo, una suscripción y un manejador idénticos. El
     nombre del evento se lee como «terminó».
3. **Editar con lista blanca.** `PUT /api/contratos/:id` acepta sólo `CAMPOS_CONTRATO_EDITABLES`
   (canon, `fin`, día límite de pago, condiciones particulares y deudor solidario), y sólo en un
   contrato activo. Cualquier otro campo es `400`, con un error por campo y sin aplicar nada.
4. **`fin` sólo durante el término inicial y sin preaviso**, y el nuevo debe ser posterior a hoy y
   al inicio. El término inicial es lo que mide la prórroga: una vez prorrogado, `fin` es historia.
5. **El día de corte queda fijo.** `fecha_inicio_corte` no se edita: de ella sale el día de todos
   los periodos, y cambiarla con cuentas ya generadas solaparía periodos o dejaría huecos. Lo que el
   RF-09 llama «fechas de corte» se cumple con el día límite de pago.
6. **`historial_contratos`**, en el esquema de ms-contratos, sólo de agregar: una fila por campo
   editable o estado que cambia, con el valor anterior y el nuevo en texto, cuándo y quién, y en una
   cancelación el motivo, la indemnización y quién la paga. Se escribe en la transacción del cambio
   y se consulta con `GET /api/contratos/:id/historial`, para las dos partes.

Las referencias legales se verificaron contra el texto vigente de la Ley 820 de 2003 (Normograma de
la Cancillería), junto con las del preaviso.

## Alternativas descartadas

- **Leer la historia de la tabla de salida:** sólo tiene los cambios que emiten evento, se purga y
  es operativa.
- **Columnas `fecha_finalizacion` y `fecha_cancelacion`:** cubren el estado, pero no el canon ni
  `fin`.
- **Calcular la indemnización en el servidor:** es pactable; se sugiere en la SPA y se registra lo
  acordado.

## Consecuencias

- **Cambio incompatible en la API:** `PUT /api/contratos/:id` rechaza lo que antes aceptaba, y
  finalizar exige un preaviso vencido. La demo y la integración cancelan en lugar de finalizar.
- **La cartera de demostración muestra Cancelado, no Finalizado:** por la API no se siembra un
  preaviso en el pasado. Finalizar se enseña en vivo, con un contrato cuyo preaviso venza ese día.
- **Un consumidor que quiera distinguir finalizado de cancelado** no podrá con el evento actual: se
  versionará entonces con `estado`.
- **La indemnización a cargo del inquilino** no se cobra sola: la SPA ofrece crear su cuenta de
  cobro con el alta manual. La del propietario sólo se informa, porque no hay egresos.
