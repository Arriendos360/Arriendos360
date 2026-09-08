# ADR 0015 — `Transacciones` conserva `observaciones`

- **Estado:** aceptada
- **Fecha:** 2026-09-08
- **Paso:** 6c (realineación del modelo financiero)
- **Se aparta del Capítulo 2:** sí, por adición. Pendiente de incorporar por el
  proceso de la sección 13.3.2 del PMP.

## Contexto

El modelo canónico de la sección Persistencia enumera los atributos propios de
`Transacciones`: `monto`, `tipo`, `fecha_pago`, `medio_pago`, `estado`. Más las
cuatro columnas de auditoría y la referencia a `id_cuenta_cobro`.

La tabla `abonos` a la que sustituye tenía una columna más, `observaciones`, en
texto libre. El paso 6c tenía que decidir si sobrevivía al renombre.

No es una columna muerta como las dos que retiró el paso 6a. `deposito` e
`inventario_fotografico` se fueron porque nadie las escribía y ninguna fila tenía
valor. Ésta la escribe el formulario de registro de pago de la SPA, la manda la
colección de Postman, y **la imprime el comprobante**:

```js
referencia_pago: transaccion.observaciones || `Abono No. ${transaccion.id_transaccion}`
```

Es el renglón «Referencia trans.» del PDF, la penúltima fila del bloque «Detalle
del pago».

## Decisión

**Se conserva.** `transacciones.observaciones` sigue siendo `TEXT`, opcional, y
el comprobante la sigue imprimiendo con la misma precedencia.

## Alternativas consideradas

**Retirarla y dejar el `||`.** El comprobante seguiría saliendo, pero el renglón
«Referencia trans.» pasaría a mostrar siempre `Abono No. <uuid>`, un
identificador que el sistema se inventa. Lo que el arrendatario necesita ver ahí
es el número de la consignación que tiene en su extracto bancario, que es lo
único que le permite emparejar el comprobante con su movimiento. Sustituir eso
por un UUID no simplifica el modelo: rompe el documento.

**Meterla en `detalle` de la cuenta de cobro.** Es el error de categoría que este
mismo paso evita con `tipo_transaccion`. `detalle` describe QUÉ SE COBRA —el
canon de un periodo— y lo escribe el sistema al emitir la cuenta.
`observaciones` describe CÓMO ENTRÓ UN PAGO CONCRETO y lo escribe una persona.
Una cuenta puede tener varias transacciones con referencias distintas; hay una
sola `detalle`. Colapsarlas es lo que hacía el modelo viejo, que copiaba las
observaciones del último abono a la fila del pago y perdía las anteriores.

**Un campo genérico de metadatos (`JSON`).** Más flexible y peor: un `JSON` sin
esquema al que sólo llega una cadena es un `TEXT` con una capa de ceremonia
encima, y el día que alguien meta un segundo campo ahí nadie sabrá qué contiene.

## Consecuencias

- El modelo de `Transacciones` tiene un atributo más que el Capítulo 2. Hay que
  llevarlo a control de configuración, no dejarlo como discrepancia silenciosa.
- Es texto libre de un usuario que acaba impreso en un PDF. No se interpola en
  HTML ni en SQL —`pdfkit` la escribe como texto y Sequelize la parametriza—
  así que no abre superficie de inyección, pero conviene recordarlo si algún día
  el comprobante se genera en HTML.
- Si el Comité rechaza la adición, quitarla es una migración de una línea y un
  cambio de un renglón en `pago.controller.js`. El coste de tenerla y perderla es
  bajo; el de no tenerla es un comprobante peor desde el primer día.

## Relación con otras decisiones

`docs/adr/0016` decide que una transacción se anule en vez de borrarse, y las dos
apuntan a lo mismo: un movimiento de dinero deja un documento en manos de alguien,
y el sistema tiene que poder seguir explicando ese documento más tarde.
