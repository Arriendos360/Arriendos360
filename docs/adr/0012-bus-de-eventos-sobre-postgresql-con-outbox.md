# ADR 0012 — Bus de eventos sobre PostgreSQL con patrón outbox

- Estado: Aceptada
- Fecha: 2026-09-08
- Paso de la migración: 5

## Contexto

CLAUDE.md deja abierta la **tecnología del bus de eventos** y anota una recomendación:
*Dapr pub/sub, por venir integrado en Container Apps*. Este ADR es el que esa decisión
abierta pedía antes del paso 5.

El paso 5 necesita el bus para algo concreto y ya escrito: `MS-Contratos` guarda el
contrato y emite `ContratoFormalizado`; `MS-Financiero` lo consumirá en el paso 6 para
crear la primera cuenta de cobro; hoy lo consume `MS-Inmuebles` para mover el estado del
inmueble. El evento reemplaza la llamada síncrona del ADR 0011.

Lo que el bus tiene que dar, con esas piezas y ese presupuesto:

1. **Que el evento no se pierda si el consumidor está caído.** Es el defecto exacto del
   ADR 0011 y la razón de todo el trabajo.
2. **Que el evento y el cambio de dominio sean una sola operación.** Guardar el contrato
   y decidir avisar no pueden ser dos decisiones separables, o vuelve la ventana.
3. **Que no haya una tabla ni un componente compartido entre servicios** (regla dura 3).
4. **Que quepa en el presupuesto**: cero pesos sobre créditos de Azure for Students, y en
   los límites de memoria de Container Apps.
5. **Que corra en un portátil sin Docker**, porque así corren las suites (ver «Cómo se
   prueba» en CLAUDE.md).

## Decisión

**El bus es PostgreSQL con patrón outbox, y el transporte es HTTP entre servicios.** No
se introduce ningún broker: ni Dapr, ni Service Bus, ni RabbitMQ.

El mecanismo vive en `packages/shared`, en cuatro módulos, y ningún servicio lo
reimplementa:

| Módulo | Lado | Qué resuelve |
|---|---|---|
| `eventos.ts` | ambos | El sobre común y la carga tipada de cada evento. |
| `salida.ts` | productor | Tabla de salida y publicador: leer, entregar, marcar, reintentar. |
| `entrega.ts` | productor | El salto: `POST /interno/eventos` con credencial de servicio. |
| `entrada.ts` | consumidor | Bitácora de procesados y descarte de repetidos. |

### 1. El evento se escribe en la transacción del dominio

`Contrato.create(...)` y la fila del evento van al mismo `commit`. Las dos escrituras
están en la misma base, así que la atomicidad **vuelve a estar disponible** — no la del
contrato con el estado del inmueble, que ya no es posible ni deseable, sino la del
contrato con **el hecho de haberlo anunciado**, que es la que se puede tener y la que
hace que lo demás converja.

Ese es el punto entero del patrón, y es lo que ningún broker da por sí solo: publicar
contra Service Bus dentro de una transacción de PostgreSQL sigue siendo dos sistemas y
dos fallos posibles. Un broker no elimina el outbox; se pone **detrás** de él.

### 2. Una tabla de salida por productor, en su propio esquema

`public.eventos_salida` hoy, porque el productor es el gateway. Nunca una tabla común: es
la regla dura 3, y además una tabla en otro esquema no cabría en la transacción anterior,
que es lo único que hace que esto funcione.

### 3. Un publicador aparte lee, entrega y marca

Un `setInterval` de cinco segundos dentro del mismo proceso. No es un servicio nuevo, no
es un contenedor nuevo, y no hace falta que lo sea: barre una tabla indexada y hace una
petición HTTP por evento.

### 4. Entrega al-menos-una-vez, y el consumidor descarta repetidos

Entre «entregar» y «marcar entregado» hay una ventana; un corte ahí provoca una segunda
entrega. **No se intenta exactamente-una-vez**: cerrar esa ventana exigiría una
transacción distribuida entre la base del productor y la del consumidor, con coordinador,
que es lo mismo que el ADR 0011 ya descartó por presupuesto.

Cada consumidor lleva su propia tabla `eventos_procesados` y anota el `id_evento` **en la
misma transacción** en que aplica el efecto. Al-menos-una-vez más descarte de repetidos
es indistinguible de exactamente-una-vez desde fuera, y cabe en una tabla.

### 5. Un evento que falla siempre se aparta, no bloquea ni se reintenta sin fin

El problema tiene dos mitades y hay una respuesta para cada una:

- **No bloquea la cola.** El bloqueo se reduce a lo mínimo que la corrección exige: los
  eventos que comparten `clave_orden` —el `id_inmueble`— se entregan en orden, y un
  evento atascado sólo frena a los suyos. Los de otro inmueble salen en el mismo ciclo.
- **No se reintenta para siempre.** Tras **10 intentos** con espera creciente (2 s, 4 s,
  8 s… hasta 5 minutos, ~13 minutos en total), la fila pasa a `apartado` con su último
  error guardado: deja de intentarse, deja de bloquear su clave y queda a la vista.

El criterio detrás del número: una entrega falla o porque el consumidor está caído
—transitorio— o porque el evento le sienta mal —permanente—, y desde fuera no se
distinguen. Así que el límite se elige **por tiempo**: trece minutos es de sobra para un
reinicio de contenedor o un despliegue, y lo bastante poco para que un evento envenenado
no siga ahí cuando alguien mire. La asimetría decide: apartar por una caída larga es
reparable con `reencolar()`; reintentar sin fin un evento envenenado no lo es, porque
nadie se entera nunca.

Se **aparta**, no se borra. El evento describe un hecho que ocurrió de verdad, y tirarlo
sería perder la única constancia de que el consumidor no se enteró.

Hay una consecuencia que conviene decir en voz alta: apartar un evento también
**desbloquea su clave**, así que el consumidor puede acabar viendo un evento sin su
predecesor. Se acepta porque la alternativa —una clave bloqueada para siempre— es peor, y
por eso apartar deja un registro tan ruidoso.

### 6. El transporte es HTTP, y sigue siendo coreografía

El publicador hace `POST /interno/eventos` al suscriptor, con la misma credencial de
servicio que el resto de `/interno` (ADR 0009). Que haya una petición HTTP no convierte al
productor en orquestador: **no espera respuesta de negocio, no sabe qué hace el otro con
el evento, no cambia su comportamiento según lo que le contesten, y el hecho ya está
guardado antes de que la petición exista.** La diferencia con la llamada que esto
sustituye es exactamente ésa — allí el gateway ordenaba «pon este inmueble en arrendado»
y el éxito de la petición importaba; aquí anuncia «se formalizó un contrato».

Quién escucha se **configura** —sale de las variables `MS_*_URL`—, no se descubre. Nada de
service discovery (CLAUDE.md, «Qué no hacer»).

## Consecuencias

**El sistema pasa a ser consistente en el tiempo para el estado del inmueble.** La ventana
esperada es el intervalo del publicador, cinco segundos, más lo que tarde el consumidor.
Ya no es una ventana de *pérdida* como la del ADR 0011, sino de *retraso*: el evento está
en disco y acabará entregándose.

**Cero dependencias nuevas.** Ni en `package.json` ni en la imagen Docker ni en la
factura. El publicador usa el `fetch` de Node y la conexión que el servicio ya tiene.

**Las suites siguen corriendo sin Docker.** El publicador se prueba contra un almacén en
memoria (`packages/shared/tests/salida.test.ts`), la tabla de salida contra la base del
gateway y la idempotencia contra la de ms-inmuebles. Con un broker haría falta levantarlo,
o un doble suyo, y un doble de un broker prueba menos que un doble de un servicio.

**No hay orden global entre eventos, sólo por clave.** Es lo que se necesita y no más:
ordenar globalmente obligaría a un único publicador serializado, que es peor que el
problema.

**Con varias réplicas del gateway, un evento puede entregarse dos veces.** No se pone
`FOR UPDATE SKIP LOCKED` porque la consecuencia ya está cubierta por el descarte de
repetidos, que hace falta de todos modos. Lo que sí habría que revisar ese día es el orden
por clave, al que un bloqueo por fila sí afecta. Queda anotado.

**La tabla de salida no se barre.** Igual que `TokensRevocados` (Capítulo 2): con este
volumen es también la bitácora de qué se emitió y cuándo, que sirve para depurar y para la
defensa. Si estorba, un `DELETE` de lo entregado hace más de N días.

## Alternativas descartadas

**Dapr pub/sub, la recomendación de CLAUDE.md.** Es la candidata seria y se descarta por
tres razones, en este orden. *Primera:* **no elimina el outbox**, lo complementa —publicar
contra un broker dentro de una transacción de PostgreSQL sigue siendo dos sistemas—, así
que adoptarlo ahora sería escribir este mismo mecanismo **y además** montar Dapr.
*Segunda:* obliga a un sidecar por contenedor, lo que en Container Apps con límites de
estudiante es memoria que se resta a los servicios. *Tercera:* rompe la regla de que las
suites corran en un portátil sin Docker. **Sigue siendo el camino natural el día que haya
más de un consumidor por evento y el volumen lo justifique**, y el cambio está acotado:
sustituir `entrega.ts`, que es un archivo de 120 líneas. Lo que este ADR decide es el
*cuándo*, no el *nunca*.

**Azure Service Bus.** Lo mismo, más una dependencia de nube que impide desarrollar y
probar en local sin credenciales. Y tiene coste fuera de la capa gratuita, que es
exactamente lo que el presupuesto no tiene.

**RabbitMQ o Redis en el Compose.** Un contenedor más que mantener, y con el que el
sistema deja de arrancar si falla. Añade un modo de fallo nuevo para no resolver ninguno
de los cinco requisitos de arriba mejor que PostgreSQL, que ya está ahí y ya es
transaccional.

**`LISTEN`/`NOTIFY` de PostgreSQL en vez del barrido.** Tentador —avisa al instante— pero
las notificaciones **no son duraderas**: un consumidor desconectado no las recibe y nadie
se lo dice. Habría que conservar el barrido igualmente como red de seguridad, así que
sería el mismo código más otro camino. Se puede añadir después, como optimización de
latencia sobre este diseño, sin cambiar nada de lo demás.

**Una tabla de eventos compartida que todos consulten.** Es lo más simple de escribir y lo
peor de defender: viola la regla dura 3, convierte el esquema en un punto de acoplamiento
y hace imposible llevarse un servicio a su propia base en el paso 8.

**Publicar sin outbox, justo después del `commit`.** Es exactamente lo que hace el ADR
0011 con una llamada HTTP, y es el problema que este ADR viene a resolver.

## Estado frente a la línea base

El Capítulo 2 ordena comunicación asíncrona por bus de eventos con coreografía, y eso es
lo que se implementa: `MS-Contratos` guarda y emite, quien escucha reacciona, nadie llama
a nadie. **La tecnología no la fija el documento** —CLAUDE.md la deja explícitamente
abierta— así que no hay desviación que tramitar por la sección 13.3.2 del PMP.

Lo que sí conviene incorporar al Capítulo 2 en la próxima revisión es la **garantía de
entrega** que el documento no nombra: al-menos-una-vez con descarte de repetidos, y
consistencia en el tiempo para el estado del inmueble.

## Anotaciones posteriores (2026-09-14)

- **El productor ya no es el gateway.** Lo fue mientras `contratos` era suya. En el
  paso 6d la tabla de salida y el publicador se mudaron a ms-contratos
  (`contratos.eventos_salida`), y `public.eventos_salida` se retiró con la migración
  que retiraba los contratos del gateway.
- **Desde el paso 7 hay tres productores**, cada uno con su tabla de salida en su
  esquema: `ms-contratos`, `ms-identidad` y `ms-financiero`. Las dos últimas no
  trajeron mecanismo nuevo. Ver `docs/adr/0019`.
- **«Con varias réplicas del gateway»**, en Consecuencias, léase hoy «con varias
  réplicas de un productor». El análisis no cambia: la doble entrega está cubierta
  por el descarte de repetidos —que desde el 6e importa más, porque un consumidor
  INSERTA (`docs/adr/0018`)— y lo que habría que revisar es el orden por clave si se
  añade `FOR UPDATE SKIP LOCKED`. Queda para el paso 8.
- **`ContratoFormalizado` tiene dos consumidores desde el 6e** (`docs/adr/0018`) y
  subió a versión 2 en el paso 7 (`docs/adr/0019`).
