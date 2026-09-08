# ADR 0013 — `ContratoFinalizado`, un evento que el documento no lista

- Estado: Aceptada
- Fecha: 2026-09-08
- Paso de la migración: 5

## Contexto

El Capítulo 2, en «Comunicación entre servicios», describe la creación en cadena con un
ejemplo:

> `MS-Contratos` guarda el contrato y emite `ContratoFormalizado`. `MS-Financiero` consume
> el evento, extrae `id_contrato`, `canon` y `fecha_inicio_corte`, e inserta la primera
> `Cuenta_cobro`.

Es el único evento que el documento nombra. La pregunta que el paso 5 obliga a responder
es si esa mención es **un ejemplo del mecanismo** o **la lista cerrada de eventos del
sistema**.

El caso concreto: el ciclo de vida de un contrato tiene dos extremos. Al firmarlo, el
inmueble pasa a `arrendado`; al finalizarlo, vuelve a `disponible`. Hasta el paso 4 las
dos cosas las hacía la misma llamada síncrona (`POST /interno/inmuebles/:id/estado`, ADR
0011). El paso 5 sustituye la primera por un evento. Queda decidir qué hacer con la
segunda.

## Decisión

**Se define `ContratoFinalizado` y las dos mitades del ciclo viajan por el bus.**

```
ContratoFinalizado v1
  id_contrato  UUID
  id_inmueble  UUID
```

Lo emite quien escribe el contrato —hoy el gateway, en el paso 6 `MS-Contratos`— en la
misma transacción que marca el contrato como finalizado. Lo consume `MS-Inmuebles`, que
devuelve el inmueble a `disponible`.

### Por qué la mención del Capítulo 2 es un ejemplo y no una lista

Tres razones, y la tercera es la que decide.

**Por lo que el documento dice de sí mismo.** La sección se titula «Comunicación entre
servicios» y explica un *mecanismo*; el evento aparece para ilustrarlo, igual que los
payloads de la sección de contratos de interfaz aparecen con valores de muestra. CLAUDE.md
ya fija cómo se leen esos ejemplos: «lo vinculante son los campos y sus nombres», no los
valores. Aquí es el mismo criterio, un nivel más arriba.

**Porque una lista cerrada de eventos sería inconsistente con el resto del documento.** El
Capítulo 2 no enumera endpoints exhaustivamente —el ADR 0004 ya añadió uno que no
contempla— ni tablas de operación como `TokensRevocados`, que sí describe aparte. No hay
razón para leer la sección de eventos con un criterio más estricto que las demás.

**Porque la alternativa es incoherente, y esto es lo que de verdad decide.** Usar un
evento para ocupar el inmueble y una llamada síncrona para liberarlo dejaría **la mitad
del ciclo de vida con garantía de entrega y la otra mitad sin ella**. Un contrato firmado
sobreviviría a que ms-inmuebles estuviera caído; uno finalizado, no: el inmueble se
quedaría marcado como arrendado, sin nadie que lo arreglara y sin rastro de que hacía
falta arreglarlo. Y sería precisamente el peor de los dos errores —un inmueble libre que
el propietario no puede volver a arrendar— resuelto con el mecanismo más débil de los dos
disponibles.

Además obligaría a mantener vivo `POST /interno/inmuebles/:id/estado` sólo para ese
camino: una segunda puerta al estado del inmueble, con menos garantías, que nadie prueba y
por la que es fácil reintroducir la escritura síncrona sin darse cuenta.

### Por qué lleva `id_inmueble` y no sólo `id_contrato`

Para que el consumidor pueda actuar sin volver a preguntar. Si `MS-Inmuebles` tuviera que
llamar a Contratos para saber de qué inmueble habla el evento, el bus no habría desacoplado
nada: seguiría habiendo una dependencia síncrona, sólo que en sentido contrario y con
`ms-inmuebles` —que es **Soporte**— consultando a **Core**, que es la inversión de
dependencias que el ADR 0011 ya rechazó.

Es la misma razón por la que `ContratoFormalizado` lleva `canon` y `fecha_inicio_corte`
aunque hoy no los use nadie: **un evento se lleva consigo lo que sus consumidores
necesitan para reaccionar**, porque el emisor es el único que lo tiene a mano en el
momento en que ocurre el hecho.

### Por qué no un solo evento con el estado dentro

Se consideró `EstadoContratoCambiado { id_contrato, id_inmueble, estado }`. Se descarta:
un evento nombra un **hecho de negocio**, no una transición de una máquina de estados. Un
evento genérico obligaría a cada consumidor a interpretar un `switch` sobre valores que
son del emisor, y en el paso 6 `MS-Financiero` tendría que filtrar eventos que no le
importan. «Se formalizó un contrato» y «se finalizó un contrato» son dos hechos distintos
y a cada uno reacciona quien quiere.

## Consecuencias

**El ciclo de vida completo del inmueble tiene la misma garantía.** Ocupar y liberar
sobreviven los dos a que el consumidor esté caído, con la misma ventana y el mismo
mecanismo de reintento.

**El endpoint `POST /interno/inmuebles/:id/estado` desaparece.** No le queda ningún
consumidor. Ver el ADR 0011 actualizado.

**Los dos eventos comparten clave de orden** (`id_inmueble`), y esto es una consecuencia
que no es evidente: son órdenes contrarias sobre el mismo dato, así que entregarlas al
revés dejaría el inmueble arrendado para siempre —primero se liberaría uno que aún estaba
libre, después se ocuparía—. El publicador lo garantiza; sin `ContratoFinalizado` la clave
de orden no habría hecho falta.

**Un evento más que mantener versionado.** Es el coste, y es pequeño: `version: 1` desde el
primer sobre, en `packages/shared/src/eventos.ts` junto al otro.

## Estado frente a la línea base

**Esto sí es una desviación que tramitar** por la sección 13.3.2 del PMP, a diferencia del
ADR 0012: el documento no contempla este evento. No lo contradice —no dice que la lista
sea cerrada— pero añade una pieza al diseño de comunicación entre servicios, y el Capítulo
2 debería recogerla junto con la garantía de entrega del ADR 0012.

Va a la tabla de desviaciones pendientes de incorporar de CLAUDE.md.
