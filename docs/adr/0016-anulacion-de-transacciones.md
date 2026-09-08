# ADR 0016 — Una transacción se anula, no se borra

- **Estado:** aceptada
- **Fecha:** 2026-09-08
- **Paso:** 6c (realineación del modelo financiero)
- **Se aparta del Capítulo 2:** sí. Añade un endpoint y un estado que el
  documento no contempla. Pendiente de incorporar por el proceso de la sección
  13.3.2 del PMP.

## Contexto

Hasta el paso 6c un pago registrado por error no tenía arreglo por la API. El
propietario escribía el abono, `pagos.saldo_pendiente` bajaba, y para deshacerlo
había que entrar a la base a mano: borrar la fila de `abonos` y volver a subir la
columna del pago. Dos escrituras que nadie garantizaba que fueran juntas, sobre
un dato contable, hechas desde `psql`.

El paso 6c cambia el terreno de dos maneras:

1. **El saldo deja de guardarse.** Se deriva de la suma de las transacciones
   (`services/saldos.js`). Deshacer un movimiento ya no exige tocar dos sitios:
   basta con que la suma deje de contarlo.
2. **`Transacciones` gana un `estado`**, que el modelo canónico sí enumera entre
   sus atributos propios. Había que decidir qué valores toma y qué significan.

## Decisión

**Anular cambia el estado; no borra la fila.** El catálogo de
`transacciones.estado` es `CONFIRMADA` y `ANULADA`, y el saldo derivado suma sólo
las confirmadas.

Se expone como `POST /api/pagos/transacciones/:id_transaccion/anular`, con:

- **RBAC** `SOLO_PROPIETARIO`, con fila propia en la matriz. Es la misma razón
  por la que registrar un pago es suyo (`docs/adr/0006`): quien lleva la
  contabilidad del arriendo es el arrendador.
- **ABAC** de propiedad real del inmueble, no de mera pertenencia al contrato.
  Registrar un pago comprueba que quien pregunta sea *parte*; anular exige ser el
  *dueño*, igual que emitir la cuenta de cobro. Deshacer un asiento contable es
  al menos tan delicado como crearlo.
- **409 si ya está anulada**, no 403. El recurso es suyo y su rol es el correcto
  —las dos capas de autorización dijeron que sí—; lo que falla es que el recurso
  no está en condiciones. Es el mismo criterio que los guardias de
  `routing/guardias.js`.

Tras anular, el estado de la cuenta de cobro **se recalcula a partir del saldo**,
no se restaura desde ninguna parte: `estadoSegunSaldo()` es una función del saldo
y del estado actual, así que la cuenta vuelve sola a `PARCIAL` o a `PENDIENTE`
sin que nadie haya tenido que recordar cuál era.

## Alternativas consideradas

**Borrar la fila (`DELETE`).** Es lo más corto y es lo que no se puede hacer. El
comprobante de esa transacción **ya se emitió y alguien lo tiene**: un PDF con un
número `TRX-<uuid>` y un saldo impreso. Borrar la fila deja ese documento sin
respaldo en el sistema, y a quien lo enseñe sin forma de que nadie lo verifique.
Un registro contable que desaparece sin dejar rastro no es una corrección, es una
falsificación.

Además rompería la auditoría: las cuatro columnas del Capítulo 2 registran quién
creó y quién modificó una fila, y una fila borrada no registra nada. Con la
anulación, `actualizado_por` guarda quién la anuló y `ultima_actualizacion`
cuándo.

**Una transacción compensatoria de signo contrario (un `EGRESO`).** Es lo que
haría un libro contable de verdad, y es la alternativa seria. Se descartó por
dos motivos, ninguno definitivo:

- El catálogo `tipo` tendría que abrirse a `EGRESO` hoy, para un flujo que no
  existe: no hay devoluciones en el producto. Se estaría modelando el reverso de
  una operación antes que la operación.
- Un error de tecleo no es un hecho económico. Registrar 500 000 que nunca
  entraron y después −500 000 deja dos movimientos falsos en el historial en vez
  de uno marcado como erróneo, y el inquilino ve dos líneas donde no pasó nada.

Si algún día hay devoluciones reales —un depósito que se reintegra, un cobro de
más que se devuelve por transferencia— eso **sí** es un hecho económico y pide un
`EGRESO`, no una anulación. Las dos cosas pueden convivir: anular corrige el
registro, un egreso registra dinero que sale.

**Marcar la cuenta de cobro en vez de la transacción.** No sirve: el error está
en el movimiento, y una cuenta puede tener varios.

## Consecuencias

- **La anulación no toca `saldo_restante_momento`** de ninguna transacción, ni de
  la anulada ni de las anteriores. Esa columna es una foto del instante en que se
  emitió cada comprobante, y los comprobantes ya emitidos no se reescriben. El
  saldo *vigente* de la cuenta cambia; el histórico impreso no.
- El comprobante de una transacción anulada se sigue pudiendo pedir, y sale con
  `ANULADA` donde antes decía `PAGADO` o `ABONO PARCIAL`. Es información, no un
  fallo: sirve justamente para acompañar al documento viejo.
- El historial y el listado de transacciones **devuelven las anuladas**, marcadas.
  Filtrarlas sería esconder que el movimiento se registró y se corrigió, que es
  lo que el estado existe para hacer visible.
- La anulación no genera evento en el bus. Hoy ningún otro contexto reacciona a
  un pago, así que no hay a quién avisar. Cuando ms-financiero se extraiga y
  ms-notificaciones exista, habrá que decidir si un `PagoAnulado` merece aviso al
  inquilino; no antes.
- El endpoint no está en el Capítulo 2 y hay que llevarlo a control de
  configuración, igual que el `ContratoFinalizado` del `docs/adr/0013`.

## Relación con otras decisiones

- `docs/adr/0006` — registrar abonos es exclusivo del propietario. Anularlos,
  por lo mismo.
- `docs/adr/0015` — `observaciones` sobrevive por la misma razón de fondo: un
  movimiento de dinero produce un documento en manos de alguien, y el sistema
  tiene que poder seguir explicándolo.
