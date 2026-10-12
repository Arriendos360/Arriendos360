# ADR 0024 — Validación de entradas en las altas

- **Estado:** aceptada
- **Fecha:** 2026-10-12
- **Se aparta del Capítulo 2:** no en los campos ni en sus nombres. Añade al 400 de las
  altas el campo `errores`, que es aditivo. Exigir cédula en `documento` podría ser una
  desviación frente al SRS (ver «Consecuencias»).

## Contexto

Las pruebas de aceptación abrieron INC-001 (#63), INC-002 (#64), INC-003 (#66) e
INC-004 (#65): los formularios de alta aceptaban nombres `"Juan123"`, documentos
`"adada"`, deudores `"12-31"` y teléfonos `"97wqqewqeqeq"`, y el backend los guardaba.
Cuando el dato no cabía en su columna (un teléfono de 16 caracteres en `VARCHAR(15)`, un
canon `"abc"`), PostgreSQL lo rechazaba y la persona recibía un 500 sin causa.

Cada servicio validaba a mano, poco y de uno en uno: el primer error cortaba la
respuesta.

## Decisión

1. **Las reglas viven en `packages/contracts/src/validacion/`**, en funciones puras y
   sin dependencias: primitivas en `reglas.ts` y un validador por cuerpo de creación en
   `cuerpos.ts` (`validarRegistro`, `validarAltaInquilino`, `validarContrato`,
   `validarInmueble`, `validarPago`, `validarCuentaCobro`). Cada uno devuelve
   `{ datos, errores }`: los campos normalizados y todos los errores, en el orden del
   formulario.
2. **Cada servicio valida su POST al principio**, antes de consultar a otro servicio o a
   la base (Confianza Cero). La SPA importa los mismos validadores, sólo por usabilidad.
   El gateway no valida: reenvía sin leer el cuerpo (`docs/adr/0020`).
3. **Contrato de error de validación:** `400 { mensaje, errores: [{ campo, mensaje }] }`,
   construido con `errorDeValidacion`. `mensaje` repite el primer error, así que quien
   sólo lee `mensaje` sigue funcionando. Los 400 de negocio que corresponden a un campo
   (email o documento repetido, sobrepago) usan el mismo contrato con una sola entrada.
4. **Sólo se valida la creación.** `PUT /api/contratos/:id` y `PUT /api/inmuebles/:id`
   no cambian.
5. **El email se recorta y no se pasa a minúsculas**: el login compara el correo exacto.
   Hacerlo insensible a mayúsculas exige tocar el login, la unicidad y las filas
   existentes.
6. **`fecha_pago` no puede ser futura, comparando el día en `America/Bogota`**, no el
   instante. El «hoy» lo inyecta quien llama, para que el validador sea puro.
7. **Los números tienen el tope de su columna**: `NUMERIC(12,2)` menor que 10¹⁰,
   `NUMERIC(10,2)` menor que 10⁸, `INTEGER` hasta 2³¹−1.

## Consecuencias

- **«Sólo cédula» deja fuera la cédula de extranjería y el pasaporte.** `documento` y
  `documento_deudor_solidario` exigen de 6 a 10 dígitos. Si el SRS admite otros
  documentos, esta restricción es una desviación y se tramita por PMP §13.3.2.
- Las filas guardadas antes siguen con su basura, y el `PUT` no las valida. La SPA sí
  aplica las reglas al editar un inmueble, porque el formulario es el mismo.
- Tocar las reglas es tocar `packages/contracts`: las seis imágenes cambian de etiqueta
  y se redespliega todo. En local hay que recompilar el paquete
  (`npm run build:packages`); sin eso la SPA y las pruebas usan las reglas viejas.
- Un dato inválido que antes se guardaba, o daba 500, ahora responde 400.
