# ADR 0006 — Registrar un abono es exclusivo del propietario

- Estado: Aceptada
- Fecha: 2026-09-06
- Paso de la migración: 3b (matriz RBAC)

> **Desviación de la línea base.** El Documento Principal describe el componente de
> registro de pagos **sin marcarlo como exclusivo de propietario**. Ver "Estado frente
> a la línea base": debe incorporarse al Capítulo 2 en su próxima revisión, por el
> proceso de la sección 13.3.2 del PMP.

## Contexto

`PUT /api/pagos/:id/pagar` es la ruta que asienta un abono contra una cuenta de cobro:
descuenta del saldo pendiente, crea la fila en `abonos` y mueve el estado del pago a
parcial o pagado.

Hasta la matriz RBAC, quién podía llamarla no estaba decidido en ningún sitio, sino que
era el residuo de tres decisiones locales que nadie tomó juntas:

- **La ruta** se monta con `router.put('/:id/pagar', registrarPago)`, bajo un
  `router.use(verificarToken)` y **sin** `esPropietario`. A nivel de API, cualquier
  usuario autenticado podía llamarla.
- **El controlador** valida con `puedeVerPago()`, que admite al dueño del inmueble **o**
  al inquilino del contrato. Es una comprobación de pertenencia (ABAC), no de rol: sirve
  para impedir que un tercero toque un pago ajeno, no para decidir quién asienta.
- **La SPA** nunca ofreció la acción al inquilino. El botón «Registrar Pago» está
  condicionado a `esPropietario`; al inquilino se le pinta una insignia «⏳ Pendiente».

Resultado: un inquilino no podía pagar desde la interfaz, pero sí con una petición
hecha a mano. La superficie real y la intención de la interfaz no coincidían, y no
había ningún documento que dijera cuál de las dos era la correcta.

La matriz RBAC obliga a decidirlo, porque deniega por defecto: o la fila se declara, o
la ruta deja de funcionar para todos.

## Decisión

`PUT /api/pagos/:id/pagar` queda declarada como **PROPIETARIO**.

El inquilino conserva todo el acceso de lectura sobre pagos: listado, pendientes,
abonos, recibo y comprobante en PDF. Lo que pierde es la escritura.

### Por qué

Quien lleva la contabilidad del arriendo es el propietario. Un abono no es una
notificación de que alguien pagó: es un **asiento** que modifica el saldo pendiente y el
estado de mora del contrato. Dejar que la parte deudora lo escriba sería aceptar una
declaración sin contrapartida — el inquilino podría marcar como saldada una cuenta que
nadie ha cobrado, y el motor financiero dejaría de contarla como mora.

Esto no es desconfianza hacia el inquilino: es que el sistema no tiene forma de
verificar el pago. No hay pasarela, ni conciliación bancaria, ni comprobante validado.
Mientras el registro sea un acto de fe, tiene que hacerlo quien recibe el dinero y
asume la consecuencia de equivocarse.

Además alinea las tres capas que estaban descoordinadas: la matriz dice lo mismo que
ya decía la interfaz, y la API deja de ofrecer más de lo que la UI muestra.

## Consecuencias

**A favor**

- El saldo de una cuenta de cobro sólo lo mueve quien cobra.
- Desaparece la discrepancia entre lo que permite la API y lo que ofrece la SPA.
- La política queda declarada, versionada y probada, en lugar de emerger de la ausencia
  de un middleware.

**En contra**

- Se cierra la puerta a que el inquilino reporte su propio pago. Hoy no existía en la
  interfaz, así que no se pierde ninguna función visible, pero es una vía que habrá que
  reabrir con otro diseño si el producto la quiere.
- El inquilino depende del propietario para que su pago quede reflejado. Si el
  propietario tarda, el motor financiero puede marcarlo en mora habiendo pagado. Es un
  problema real de proceso, no de permisos, y no lo resuelve este ADR.

**Cómo se reabriría**

Si más adelante se quiere autoservicio, no basta con devolverle el `PUT`. Haría falta un
flujo distinto: el inquilino **reporta** un pago (estado «por confirmar», sin tocar el
saldo) y el propietario lo confirma; o se integra una pasarela y el asiento lo dispara
la confirmación del proveedor, no una persona. Cualquiera de los dos es trabajo del
paso 6, cuando `ms-financiero` sea el dueño de `Cuentas_cobro` y `Transacciones`.

## Alternativas descartadas

**Dejarlo en AMBOS, que era el estado efectivo de la API.** Preservaba la superficie
existente, pero esa superficie no la había decidido nadie: era el hueco que dejaba un
`esPropietario` que nunca se puso. Consagrarla habría sido convertir un descuido en
política.

**Permitirlo al inquilino sólo sobre sus propios contratos.** Es lo que ya hacía
`puedeVerPago()`, y no resuelve el problema: la objeción no es que toque un pago ajeno,
sino que declare saldada una deuda propia sin que nadie lo verifique.

**No declarar la fila y dejar que la denegación por defecto la cierre.** Habría dado el
mismo resultado para el inquilino, pero también para el propietario: el registro de
abonos habría dejado de funcionar por completo. Una política importante no debe ser el
efecto colateral de una omisión.

## Estado frente a la línea base

El Documento Principal describe el componente de registro de pagos y la pantalla que lo
contiene, pero **no lo marca como exclusivo de propietario**, ni asigna rol a esa
operación. Este ADR llena ese vacío con una decisión que restringe lo que el documento
deja abierto.

- **Debe incorporarse al Capítulo 2 en su próxima revisión**, junto a la matriz de
  políticas del módulo de seguridad.
- El cambio pasa por el **proceso formal de control de configuración de la sección
  13.3.2 del PMP**. Este ADR es el insumo de esa solicitud, no su sustituto.
- Hasta que eso ocurra manda el documento: si la revisión resuelve que el inquilino
  registra su propio pago, manda esa decisión y este ADR queda superado.

## Verificación

`apps/gateway/tests/rbac.test.js` cubre la fila con el rol correcto, con el equivocado y
sin token, y añade un caso explícito de que el inquilino sí lee el listado y el recibo
pero no puede asentar el abono.

No hubo que tocar la SPA: el botón ya estaba condicionado a `esPropietario`.
