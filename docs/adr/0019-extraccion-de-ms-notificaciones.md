# ADR 0019 — Extracción de MS-Notificaciones: el correo deja de estar en el dominio

- **Estado:** aceptada
- **Fecha:** 2026-09-13
- **Paso:** 7 (extracción de ms-notificaciones), que cierra la migración de servicios
- **Se aparta del Capítulo 2:** no. Es el paso que crea el quinto servicio que el
  catálogo del Capítulo 2 lista y que convierte en cierta la comunicación asíncrona
  que ahí se describe. Lo que sí hace es **saldar dos desviaciones anteriores** y
  **añadir una nueva**, marcadas más abajo.

## Contexto

Hasta el paso 7 había **dos servicios de dominio abriendo conexiones SMTP**:

| Dónde | Para qué | Deuda anotada en |
|---|---|---|
| `ms-identidad`, tras la interfaz `Notificador` | El enlace de recuperación de contraseña | `docs/adr/0010` §4 |
| `ms-financiero`, en `config/mailer.ts` | Los cuatro avisos del motor | `docs/adr/0018` |

Las dos estaban declaradas provisionales **en el propio código**, y las dos apuntaban
al mismo sitio: este paso. La cabecera del `Notificador` lo escribía con precisión:
«el paso 7 será sustituir la implementación —de SMTP a
`publicar('RecuperacionSolicitada', ...)`— sin tocar una línea de la lógica de
recuperación».

Con `ms-notificaciones` los **cinco servicios** del catálogo están extraídos.

---

## Decisión 1 — Cinco eventos, y ninguno lleva una dirección de correo

| Evento | Emisor | Destinatarios que resuelve Notificaciones |
|---|---|---|
| `RecuperacionSolicitada` | `ms-identidad` | el usuario |
| `ContrasenaTemporalEmitida` | `ms-identidad` | el usuario |
| `CuentaCobroGenerada` | `ms-financiero` | el inquilino |
| `CuentaCobroPorVencer` | `ms-financiero` | el inquilino **y** el propietario |
| `CuentaCobroEnMora` | `ms-financiero` | el inquilino **y** el propietario |

Los cinco llevan el **`id_usuario`** de cada destinatario, nunca su correo.

**Por qué.** Un correo es un dato de contacto que pertenece a `identidad.usuarios` y a
nadie más. Copiarlo en un sobre convertiría a cada emisor en responsable de mantenerlo
al día, y dejaría copias viejas en dos tablas de salida que no tienen forma de
enterarse de que alguien cambió su correo. Notificaciones lo resuelve preguntando a
ms-identidad **en el momento de manejar el evento**, que es el único momento en el que
la respuesta es actual.

**El efecto lateral que no se buscaba y se agradece:** el motor pierde una petición
HTTP por barrido. Componía contra ms-identidad *sólo* para conseguir direcciones de
correo; ahora `procesarContratos` y `procesarPagos` hacen **una** llamada cada uno, a
ms-contratos, en vez de dos. Y con ella desaparece un párrafo de documentación sobre
degradación: ya no hay nada que degradar.

**Lo que sí viaja** es el *asunto* del mensaje: la dirección del inmueble, el valor, el
periodo. No son datos de contacto sino el hecho que se anuncia, el emisor los tiene en
la mano y son ciertos en el instante de `ocurrido_en`. Es el mismo criterio que puso
`canon` en `ContratoFormalizado`.

Matiz sobre `id_propietario`: viaja como **foto del momento del hecho**. Si el inmueble
cambia de dueño dentro de la ventana de entrega, el aviso va al dueño anterior — y eso
es correcto, porque el evento describe quién lo era cuando ocurrió. Es distinto de
denormalizar el dato, que es lo que `docs/adr/0017` prohíbe: allí se usa para
**autorizar**, y una copia vieja daría acceso a quien no debe.

### `ContratoFormalizado` sube a versión 2

Gana `id_inquilino`. Lo necesita ms-financiero para anunciar `CuentaCobroGenerada`
desde el consumidor del evento: la cuenta de cobro no guarda el inquilino en ninguna
columna, lo guarda el contrato, que es de otro servicio. Pedirlo por HTTP ahí sería la
orquestación disfrazada que la cabecera de `eventos.ts` ya descartaba para `canon`, y
además con una transacción abierta.

El campo se declara **opcional** a propósito: en el despliegue puede haber sobres
versión 1 esperando en `contratos.eventos_salida`, y ésos tienen que seguir creando su
cuenta de cobro. El consumidor los acepta y se limita a no notificar, con un registro
alto. **Facturar sin avisar es una degradación aceptable; no facturar, no.**

Es la primera vez que `VERSION_EVENTO` sirve para algo, y confirma lo que la cabecera
de `eventos.ts` argumentaba en el paso 5: ponerla desde el primer evento costó un
campo, y no haberla puesto habría costado distinguir un sobre viejo de uno roto.

---

## Decisión 2 — Un correo no cabe en una transacción: la bitácora de envíos

**Es la pieza central del servicio.** El consumidor del bus garantiza la idempotencia
metiendo la marca del evento y el efecto del manejador en una transacción. Eso funciona
cuando el efecto es una fila. Un `sendMail` no lo es:

- enviar **dentro** de la transacción y que ésta falle después manda un correo que
  ninguna fila registra, y el productor reintentará el evento — segundo correo;
- marcar el evento y enviar **después** pierde el aviso sin rastro si el envío falla,
  porque para el productor el evento ya está entregado.

Así que **ningún manejador envía nada**. Cada uno resuelve el destinatario, redacta el
mensaje y lo deja como fila `pendiente` en `notificaciones.envios`, en la misma
transacción que la marca del `id_evento`. Un barrido aparte —`services/enviador.ts`, el
mismo patrón del publicador: un *outbox de correos*— es el único que habla con SMTP.

Eso encadena las cuatro garantías que se querían, sin código nuevo para ninguna:

1. **Un evento repetido no produce un segundo correo.** No porque el enviador lo
   detecte, sino porque la fila no llega a existir: la marca ya estaba y el manejador no
   corrió.
2. **Si ms-identidad no responde, el aviso no se pierde.** El manejador lanza, la
   transacción se va entera —marca incluida— y el 500 hace que el productor reintente.
3. **Un fallo de envío queda registrado y visible**, en `ultimo_error` de una fila
   consultable, en vez de en un `console.error` que nadie lee.
4. **Lo que la petición promete es lo que la tabla garantiza.** Ver la decisión 4.

### Y la asimetría deliberada: ante la duda, NO se reenvía

La fila pasa a `enviando` **antes** del `sendMail`, y una fila que se queda ahí porque
el proceso murió con el mensaje en vuelo **no se reintenta sola**: queda a la vista.

En el bus, ante la duda se reentrega, porque el consumidor descarta repetidos y el
efecto duplicado nunca llega a producirse. Aquí el consumidor es una persona con un
buzón y no descarta nada. Los dos estados posibles tras un corte son «salió y no se
anotó» y «no salió», y desde el proceso no se distinguen. Reintentar convierte el
primero en un correo duplicado —imposible de deshacer, y si llevaba un enlace de
recuperación, un segundo enlace vivo en un buzón—; no reintentar convierte el segundo
en un aviso que no salió, que se ve en una consulta y que se puede reencolar a mano.
**De los dos daños, el reparable es el segundo.**

Un fallo *conocido* es otra cosa: si `sendMail` lanza, se sabe que no salió, así que la
fila vuelve a `pendiente` con espera creciente. La duda sólo existe cuando el proceso no
llega a anotar nada.

### Este barrido no hereda el problema del cron del motor

Conviene no confundirlos, porque `docs/adr/0018` deja el del motor marcado como
bloqueante para producción. El motor necesita ejecutarse **a una hora** —00:01, haya
tráfico o no— y un contenedor dormido a esa hora no genera las cuentas del día. El
enviador no tiene hora: lo que le da trabajo es un `POST /interno/eventos`, que es
justamente lo que despierta al contenedor, y `iniciar()` hace un barrido inmediato.

El hueco que sí queda es un contenedor que se duerma con filas pendientes y no reciba
más eventos. Se arregla con el evento siguiente, y para forzarlo existe
`npm run enviar`, que es a este servicio lo que `npm run motor` es a Financiero: un
punto de entrada que no depende de que la API escuche. **No es bloqueante**, y la
diferencia con el caso del motor es exactamente ésa.

---

## Decisión 3 — El token de recuperación cruza el bus, y su rastro se borra al entregarlo

`identidad.tokens_recuperacion` guarda **sólo el SHA-256** del token, para que quien
consiga leer esa tabla no pueda restablecer la contraseña de nadie. Este paso rompe a
medias esa propiedad: el token en claro se escribe en `identidad.eventos_salida.payload`
hasta que se entrega, porque el consumidor necesita construir con él el enlace del
correo.

**La alternativa que se descartó** era que Notificaciones acuñara el token llamando a un
`/interno` de ms-identidad en el momento de enviar. Quitaba el secreto del bus y hacía
que los 30 minutos empezaran cuando el correo sale de verdad. Se descarta por dos
razones: convierte a un servicio **Genérico** en causa de un cambio de estado de uno de
**Soporte**, y deja «pedir recuperación invalida el enlace anterior» dependiendo del
orden de entrega.

**Lo que sí se hace es acotar la ventana, y de una forma concreta:** el `payload` se
borra **en la misma sentencia** que marca la fila como entregada
(`tiposRedactados` en `packages/shared/src/salida.ts`). No en una segunda operación: si
fueran dos, una caída entre ellas dejaría el token en claro indefinidamente, que es
exactamente el estado que se quiere evitar. Una sola sentencia no tiene ese hueco. Lo
mismo con el cuerpo del correo en `notificaciones.envios`, que se anula en el mismo
`UPDATE` que lo marca enviado.

Se pierde la carga de los eventos entregados de ese tipo, y se acepta: la constancia de
que el hecho ocurrió está en la fila —`id_evento`, `tipo`, `ocurrido_en`,
`entregado_en`— y el dato de dominio, en `identidad.tokens_recuperacion`. Lo único que
desaparece es el secreto. `ContrasenaTemporalEmitida` **no** se redacta: no lleva
ninguno.

### La vigencia empieza al crear el token, no al enviarlo

Hay que dejarlo escrito porque es un cambio de garantía que no se ve en el código. Los
30 minutos se cuentan desde que ms-identidad crea el token. Si la entrega se retrasa, y
sobre todo **si se reintenta**, el enlace llega con menos vida de la que anuncia.

Despreciable en entrega normal —unos 5 segundos del publicador más lo que tarde el
enviador—, **no despreciable en reintentos**: diez intentos con espera creciente son
unos 13 minutos, casi la mitad de la vigencia.

Por eso el evento lleva `expira_en` y el consumidor **no lo recalcula**: el correo dice
un instante absoluto («caduca el 15 de junio a las 3:30 p. m.») en vez de una duración
relativa. Una frase como «caduca en 30 minutos» era cierta cuando el envío iba dentro de
la petición; con el bus se vuelve falsa sola. Con la fecha, un correo que llega tarde
dice la verdad, y quien lo recibe puede pedir otro.

---

## Decisión 4 — El mensaje de `/recuperar` cambia, y no es redacción

Antes: «Si el correo corresponde a una cuenta, **recibirás** un enlace…».
Ahora: «Si el correo corresponde a una cuenta, **te enviaremos** un enlace…».

El envío ocurría dentro de la petición, así que al responder ya se sabía si había
salido. Ahora la petición sólo anota el evento. «Recibirás» afirma un hecho consumado
que este endpoint ya no puede afirmar; «te enviaremos» es exactamente lo que garantiza
—que el aviso está anotado, que va a salir, que se reintenta si falla y que su estado
queda a la vista en `notificaciones.envios`— y es una promesa que el mecanismo cumple.

Lo que **no** cambia es que la respuesta sea siempre la misma, exista o no la cuenta y
falle o no por dentro: sigue siendo el requisito central del endpoint. El texto nuevo
tiene además la ventaja de no comprometerse con un momento.

La transacción de `/recuperar` es nueva: el token y el evento quedan los dos o ninguno.
Un token guardado sin evento es un enlace vivo que nadie recibe; un evento sin token, un
correo con un enlace que no existe.

---

## Desviaciones que este paso salda, y la que añade

### Saldada: `docs/adr/0010` §4 — el envío directo desde ms-identidad

La desviación era que ms-identidad abriera una conexión SMTP. Desaparece: el
`Notificador` se retira **con su interfaz**, no sustituyendo la implementación.

Retirarla y no reimplementarla es deliberado. Su método era
`notificar({ para, asunto, cuerpoHtml })`, y esos tres campos son justamente los que un
evento no lleva: no hay dirección, no hay asunto y no hay HTML. Conservar la interfaz
habría sido conservar la idea de que ms-identidad sabe lo que es un correo, que es
precisamente de lo que se le libera. Aquel ADR predijo bien el *cuándo* y el *qué*; se
equivocó sólo en suponer que la interfaz sobreviviría.

**Se cierra como SALDADA, no como incorporada al documento**: no hay nada que tramitar
por la sección 13.3.2 del PMP, porque el estado final es el que el Capítulo 2 ya
describía. Lo que sí sigue pendiente de incorporar del 0010 es el resto: los endpoints,
la tabla de tokens y la columna `contrasena_cambiada_en`.

### Saldada: `docs/adr/0018` — el mailer del motor

Igual, y con el mismo matiz que aquel ADR anticipó: «no es mover un archivo, el motor
pasa a publicar eventos». Es lo que se ha hecho. `config/mailer.ts` se borra en vez de
mudarse, porque el del servicio nuevo cambia de forma —propaga el fallo en vez de
tragárselo, ya que aquí el correo *es* el trabajo.

### **Nueva desviación (por adición): el alta manual de un cobro pasa a notificar**

`POST /api/pagos/cuentas-cobro` creaba la cuenta en silencio; el correo de «recibo
generado» sólo lo mandaba el motor. Desde este paso los **tres** caminos que crean una
cuenta de cobro —el consumidor de `ContratoFormalizado`, el barrido y el alta manual—
pasan por `services/cuentas.ts`, que anota `CuentaCobroGenerada`. Así que el alta manual
también avisa.

**Es comportamiento observable nuevo** y por eso queda aquí anotado, pendiente de
incorporar al Capítulo 2 por la sección 13.3.2 del PMP.

Se hace así porque el hecho es el mismo —se le emitió una factura a alguien— y quien la
recibe tiene el mismo derecho a enterarse la haya generado un barrido o una persona. La
alternativa era un parámetro `avisar: false` para ese camino, es decir, exactamente la
puerta por la que se cuelan los tres-sitios-que-hacen-cosas-distintas que
`services/cuentas.ts` existe para cerrar. El mismo razonamiento que llevó la pertenencia
de un contrato a un solo sitio en el paso 6d, aplicado a una escritura.

---

## Qué queda abierto

**Un usuario sin correo no recibe nada, y sólo se ve en el log.** El manejador omite el
envío y registra un aviso alto, pero no hay ningún sitio en el producto donde un
propietario vea «a este inquilino no se le pudo avisar». No se resuelve aquí porque
resolverlo bien es pantalla, no mecanismo.

**Ni reintento manual ni reencolado de envíos apartados.** `notificaciones.envios` deja
las filas apartadas y las que quedaron en `enviando` a la vista, y `npm run enviar`
barre las pendientes, pero devolver una fila apartada a la cola exige un `UPDATE` a
mano. Es la misma situación que la tabla de salida del bus tuvo entre el paso 5 y hoy, y
se acepta por la misma razón: lo que hace falta primero es que el problema se vea.

**Un solo canal.** `envios.canal` es un catálogo abierto con un único valor, `EMAIL`, y
la tabla está preparada para más. El día que haya SMS o aviso en la app, lo que cambia
es la plantilla y el transporte, no el mecanismo.

## Consecuencias

- Los **cinco** servicios del catálogo están extraídos. El paso 8 no crea ninguno.
- **Tres tablas de salida** en el sistema: `contratos`, `identidad` y `financiero`. Las
  dos últimas son de este paso, y ninguna trajo una línea de mecanismo nuevo — el bus de
  `packages/shared` se heredó con dos llamadas a función. Es el argumento a favor de que
  viviera allí desde el paso 5, cobrado.
- **ms-financiero es el primer servicio que consume y produce**, y las dos mitades caben
  en la misma transacción.
- El correo tiene **un solo sitio** en el sistema, y ningún servicio de dominio sabe que
  existe SMTP.
- La ventana de consistencia del paso 5 ahora también aplica a los correos: entre pedir
  recuperación y que el correo salga hay ~5 s del publicador más el barrido del enviador.
  Una prueba no puede afirmar que el correo salió justo después de la petición.
