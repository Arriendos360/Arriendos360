# ADR 0011 — El estado del inmueble deja de ser transaccional

- Estado: **Reemplazada** por el [ADR 0012](0012-bus-de-eventos-sobre-postgresql-con-outbox.md), en el paso 5
- Fecha: 2026-09-07
- Fecha de reemplazo: 2026-09-08
- Paso de la migración: 4

> **REEMPLAZADA. La pérdida de atomicidad que este ADR registraba queda saldada.**
>
> Era provisional por diseño y duró lo que tenía que durar: un paso. El paso 5 montó el
> bus de eventos sobre PostgreSQL con patrón outbox, y con él **desapareció el mecanismo
> entero que se describe abajo** — la llamada síncrona, el endpoint que la servía y el
> aviso en la respuesta.
>
> **Lo que cambia, en una frase:** guardar el contrato y registrar el evento que lo
> anuncia son ahora **una sola operación atómica**, porque las dos escrituras van a la
> misma base en la misma transacción; el estado del inmueble converge después.
>
> Ya no hay una ventana en la que el aviso **se pierde**: hay una ventana en la que el
> aviso **todavía no ha llegado**, que es otra cosa. El evento está en disco antes de que
> nadie intente entregarlo, así que un fallo de red lo retrasa pero no lo borra. La
> garantía pasa de «ojalá salga bien» a «acabará pasando».
>
> El texto original se conserva íntegro más abajo: es lo que explica por qué el sistema
> estuvo un paso así y qué se hizo para que se notara lo menos posible. Lo que ya no
> describe es cómo funciona el sistema. Ver el [ADR 0012](0012-bus-de-eventos-sobre-postgresql-con-outbox.md)
> para el mecanismo actual y el [ADR 0013](0013-evento-contrato-finalizado.md) para la
> otra mitad del ciclo.
>
> **Qué queda en pie de lo de abajo.** Dos cosas, y las dos por sus razones originales:
> ms-inmuebles sigue sin validar reglas de Contratos (punto 2 de la decisión), porque es
> Soporte y comprobarlas invertiría la dirección de las dependencias; y el orden sigue
> siendo «primero el hecho, después el reflejo». **Qué deja de ser cierto:** el punto 4
> —la auditoría registra ahora al *sistema*, no a la persona, porque el sobre de un evento
> no lleva actor— y el punto 5, porque ya no hay fallo que declarar en la respuesta.

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

**Cuándo desaparece esto.** ~~En el **paso 5**~~ — **ocurrió en el paso 5**, tal como se
preveía y con una diferencia: `ContratoFormalizado` lo emite el gateway y no
`ms-contratos`, porque `contratos` sigue siendo suya hasta el paso 6. Lo que importaba se
cumplió: la consistencia es eventual pero *garantizada* por el bus, con reintentos, en vez
de depender de que una llamada HTTP salga bien a la primera.

El endpoint `/interno/inmuebles/:id/estado` **no sobrevivió como camino de
reconciliación**, que era la otra posibilidad que este párrafo dejaba abierta. Se retiró
entero. La razón es la que se ve al escribirlo: no le quedaba ningún consumidor, y un
endpoint sin consumidores es una superficie que nadie prueba y una segunda puerta al
estado del inmueble por la que es fácil reintroducir la escritura síncrona sin darse
cuenta. Si algún día hace falta reconciliar, se escribirá entonces y con ese nombre.

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
