# ADR 0011 — El estado del inmueble deja de ser transaccional

- Estado: Aceptada
- Fecha: 2026-09-07
- Paso de la migración: 4

> **Provisional por diseño.** Este ADR documenta un mecanismo que **está previsto que
> desaparezca**: en el paso 5 lo reemplaza el consumo del evento `ContratoFormalizado`, y
> en el paso 6 el llamante deja de ser el gateway. No se incorpora al Capítulo 2; se
> registra para que quede constancia de la pérdida de garantía y de quién la asume
> mientras dure.

## Contexto

Hasta el paso 4, formalizar un contrato eran dos escrituras dentro de **una transacción de
PostgreSQL**:

```js
const t = await sequelize.transaction();
const nuevoContrato = await Contrato.create(contratoData, { transaction: t });
await Inmueble.update({ estado_ocupacion: 'arrendado' }, { where: { ... }, transaction: t });
await t.commit();
```

O quedaban las dos, o no quedaba ninguna. Lo mismo al finalizar, en sentido contrario.

Al extraer `ms-inmuebles`, `inmuebles` pasa a su propio esquema y **esa transacción deja de
ser posible**. No es un detalle de implementación que se pueda sortear: son dos bases
lógicas distintas, y aunque hoy compartan instancia de PostgreSQL, el diseño las separa
precisamente para poder llevárselas a bases distintas en el paso 8. Una transacción que
funcionara hoy por compartir instancia sería una trampa: dejaría de funcionar el día del
despliegue real, y el código no lo notaría hasta producción.

Las salidas clásicas —**transacción distribuida** (2PC) o **saga con compensación**— están
las dos fuera de sitio. La primera exige un coordinador que ni Container Apps ni el
presupuesto contemplan. La segunda tiene sentido cuando la compensación es un acto de
negocio (anular un cobro, liberar un asiento); aquí la única compensación sería borrar el
contrato recién firmado, que es peor que el problema: el contrato es el hecho de negocio,
y el estado del inmueble solo un reflejo suyo.

## Decisión

### 1. `POST /interno/inmuebles/:id/estado`, llamado DESPUÉS de guardar el contrato

`ms-inmuebles` expone un endpoint interno que mueve el estado. El gateway guarda el
contrato —eso sí sigue siendo transaccional, porque `contratos` todavía es suyo— y solo
entonces llama.

El orden importa: **primero el hecho, después el reflejo**. Al revés, un fallo dejaría un
inmueble marcado como arrendado sin contrato que lo respalde, que es la inconsistencia más
difícil de detectar de las dos.

### 2. El endpoint no valida reglas de negocio, porque no puede

`ms-inmuebles` es subdominio de **Soporte**. Que un inmueble deba pasar a `arrendado`
porque se firmó un contrato es una regla de **Contratos**, que es Core. Comprobarla ahí
obligaría a `ms-inmuebles` a consultar contratos e **invertiría la dirección de las
dependencias** — el mismo razonamiento por el que la reemisión de la contraseña temporal
vive en el gateway y no en `ms-identidad` (ADR 0010).

Lo que sí valida es lo suyo: que el estado exista en el catálogo y que el inmueble exista.

### 3. Es idempotente

Poner `arrendado` sobre un inmueble ya arrendado responde `200` y no cambia nada. Es lo que
hace **seguro el reintento**: si una llamada falla por tiempo de espera, el llamante no
puede saber si se aplicó o no, y con una operación idempotente no necesita saberlo.

### 4. La auditoría registra a la persona, no al servicio

El gateway envía `solicitado_por` con el `sub` del propietario. El `iss` del token de
servicio sería `"gateway"`, que ni siquiera es un UUID —la columna lo rechazaría— y además
perdería el dato que importa: qué persona provocó el cambio.

### 5. El fallo se declara, no se disimula

Si el contrato se guarda y la llamada al estado falla, **el contrato queda guardado**. La
respuesta lo dice: `201` con el contrato y un aviso explícito de que el estado del inmueble
no pudo actualizarse. No se devuelve un `500` —sería mentir, porque el contrato existe— ni
se calla —sería peor, porque nadie corregiría nada.

El fallo se registra en el log con los dos identificadores, que es lo que permite arreglarlo
a mano mientras esto dure.

## Consecuencias

**Se pierde la atomicidad y no se finge lo contrario.** La ventana es de milisegundos y solo
se abre si `ms-inmuebles` está caído justo entre las dos operaciones, pero existe. El estado
resultante —contrato activo sobre inmueble marcado `disponible`— es visible y corregible: el
inmueble sigue apareciendo como libre en el listado, que es un error molesto pero no
destructivo. Ningún dinero ni ningún contrato se pierden.

**Nadie más puede mover el estado.** El campo se descarta del cuerpo en `POST` y `PUT` de
`/api/inmuebles`. Un propietario no puede marcar como disponible un inmueble con contrato
vigente editando el formulario, que sería la forma fácil de crear la misma inconsistencia a
mano.

**Cuándo desaparece esto.** En el **paso 5**, `ms-contratos` emitirá `ContratoFormalizado` y
`ms-inmuebles` lo consumirá: la consistencia pasa a ser eventual pero *garantizada* por el
bus, con reintentos, en vez de depender de que una llamada HTTP salga bien a la primera. En
el **paso 6**, al extraerse `ms-contratos`, el llamante deja de ser el gateway. El endpoint
`/interno` puede sobrevivir como camino de reconciliación, pero deja de estar en el camino
crítico.

## Alternativas descartadas

**Dejar la transacción y compartir esquema.** Habría funcionado hoy y roto el día del
despliegue real. Además contradice la regla dura 3.

**Transacción distribuida (2PC).** Necesita coordinador y bloqueos entre servicios. Fuera
del presupuesto y del diseño.

**Saga con compensación.** La única compensación posible es borrar el contrato firmado, que
destruye el hecho de negocio para arreglar su reflejo.

**Derivar el estado en vez de guardarlo.** Calcularlo preguntando a Contratos elimina la
inconsistencia de raíz, y es tentador. Se descarta porque invierte la dependencia igual que
la opción 2: `ms-inmuebles` tendría que consultar a un servicio de Core para responder a
`GET /api/inmuebles`. Merece reconsiderarse en el paso 6, cuando el gateway ya componga las
dos cosas y pueda derivarlo él.

## Estado frente a la línea base

El Capítulo 2 lista `estado` como atributo de `Inmuebles`, así que **el modelo no cambia**.
Lo que cambia es quién lo escribe y con qué garantía, y eso el documento no lo especifica.

No hay solicitud de cambio que tramitar: no es una desviación del modelo, es una
consecuencia de la separación de servicios que el propio documento ordena. Lo que se
registra aquí es la **pérdida de una garantía que el monolito daba gratis**, para que la
defensa pueda explicarla en vez de que la descubran preguntando.
