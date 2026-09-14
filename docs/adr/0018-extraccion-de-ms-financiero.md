# ADR 0018 — Extracción de MS-Financiero: tres decisiones y una deuda bloqueante

- **Estado:** aceptada
- **Fecha:** 2026-09-08
- **Paso:** 6e (extracción de ms-financiero), que cierra el paso 6
- **Se aparta del Capítulo 2:** no. Al contrario: es el paso que hace cierto lo
  que el Capítulo 2 dice del gateway —que no tiene tablas propias— y el que
  implementa literalmente el caso de creación en cadena que ahí se especifica.

## Contexto

El paso 6e se lleva `Cuentas_cobro` y `Transacciones`, los endpoints de
`/api/pagos`, los dos comprobantes en PDF y el motor de facturación y mora. Con
ellas, **el gateway se queda sin tablas y sin conexión a PostgreSQL**: pasa a ser
lo que el Capítulo 2 describe, un *Policy Enforcement Point* con enrutamiento y
una agregación.

La mayor parte del trabajo no necesita justificación: es la misma extracción que
ya se hizo tres veces. Este ADR recoge las **cuatro cosas que sí se apartan del
guion** de las extracciones anteriores, y la que queda pendiente.

---

## Decisión 1 — La primera cuenta de cobro nace del evento, no del motor

`procesarContratos()` generaba TODAS las cuentas de cobro, incluida la primera.
Desde este paso la primera la crea el consumidor de `ContratoFormalizado` y el
barrido se queda con los meses siguientes.

No es una mejora opcional: es lo que el Capítulo 2 especifica textualmente en la
sección de comunicación entre servicios —«MS-Financiero consume el evento, extrae
`id_contrato`, `canon` y `fecha_inicio_corte`, e inserta la primera
Cuenta_cobro»— y la razón por la que el bus se diseñó en el paso 5. Hasta ahora
el bus tenía un solo consumidor y un solo efecto: mover un estado.

### La frontera entre los dos caminos es el PERIODO, no la existencia

Es la parte que puede salir mal en silencio, y por eso está escrita aquí.

El barrido podría haberse limitado a saltar lo que ya existe —tiene esa
comprobación desde siempre—. **No basta.** Entre que se firma un contrato y que
su evento se entrega hay una ventana de unos cinco segundos (el intervalo del
publicador), y el barrido de medianoche puede caer justo ahí: encontraría un
contrato activo, ninguna cuenta para su primer periodo, y la crearía. Después
llegaría el evento e intentaría crear la misma.

Así que la regla es más fuerte: **`procesarContratos()` salta el primer periodo
SIEMPRE, exista la cuenta o no.** El primero es del consumidor; los siguientes,
del barrido. Los dos calculan cuál es el primero con la misma función,
`primerPeriodoDe()`, para que no puedan discrepar — si uno usara el día pactado y
el otro el día recortado, un contrato con corte el 31 firmado en enero tendría
dos «primeros periodos» distintos y se facturaría dos veces en febrero.

Debajo hay una segunda red que no sustituye a la primera: el índice único
`(id_contrato, inicio)` de `database/financiero/001`. La regla del código evita
que el intento se produzca; el índice evita el duplicado aunque alguien se salte
la regla. La primera protege el flujo, el segundo protege la contabilidad.

### Y la idempotencia del consumidor deja de ser teórica

`database/inmuebles/003` lo dejó anticipado con estas palabras: «poner un
inmueble en `arrendado` dos veces no hace daño, es cierto — hoy. Deja de serlo en
cuanto un consumidor tenga que INSERTAR algo». Éste es ese consumidor, y sin
bitácora de procesados una reentrega es facturarle al inquilino el mismo mes dos
veces.

Además `ContratoFormalizado` gana su **segundo suscriptor**, y eso cambia la
mecánica de entrega para el que ya estaba: la fila se marca entregada cuando
aceptan los dos, así que un fallo de ms-financiero hace que ms-inmuebles reciba
el evento otra vez. La idempotencia de ms-inmuebles, que hasta hoy nunca se había
ejercitado de verdad, pasa a ejercitarse.

`ContratoFinalizado` NO gana consumidor en Financiero, y es una decisión de
negocio, no un olvido: **finalizar un contrato no cancela lo que se debe**. Un
inquilino que se va debiendo dos meses los sigue debiendo. Lo único que cambia es
que dejan de generarse cuentas nuevas, y eso ya ocurre solo porque el barrido
recorre los contratos `activo`.

---

## Decisión 2 — La mudanza copia y retira en la MISMA migración

Las tres extracciones anteriores usaron dos migraciones: una que copia, en el
esquema del servicio nuevo, y otra que retira, en `database/dominio/`, aplicada
por el gateway. Compose garantizaba el orden haciendo esperar al gateway al
healthcheck del servicio.

Aquí las dos van juntas, en `database/financiero/002`.

**El motivo es que no hay alternativa.** Éstas eran las dos últimas tablas del
gateway, así que con ellas se van su conexión, su aplicador de migraciones y la
carpeta `database/dominio/` entera. No queda ningún proceso capaz de aplicar la
retirada por separado.

Y resulta ser **más seguro** que el patrón que sustituye, no menos. El runner
envuelve cada migración en una transacción, así que copia y retirada son
atómicas: no existe el instante en que los datos están sólo en un sitio, ni la
posibilidad de que la segunda mitad se adelante a la primera. La comprobación
fila a fila antes de borrar se conserva igual.

Lo que se pierde —poder arrancar el servicio nuevo y dejar el viejo leyendo un
rato— aquí no vale nada: el gateway ya no lee esas tablas en ninguna versión del
código.

Queda una consecuencia menor y a la vista: `public.migraciones_aplicadas`, la
tabla de control del gateway, se queda atrás e inerte. No se borra a propósito —
es bitácora de otro componente, y un servicio que adopta unos datos no tiene por
qué barrer el registro contable de quien se los entrega.

---

## Decisión 3 — `pdfService.js` se muda intacto, y `allowJs` entra por él

CLAUDE.md dice que todo código nuevo va en `.ts` y que un `.js` se convierte
«solo cuando ya lo estás modificando por otra razón». `services/pdfService.js` no
se estaba modificando: se estaba **moviendo**, y ése es justamente el motivo para
no tocarlo.

El requisito del paso es que los comprobantes impriman exactamente lo mismo que
antes. Son 281 líneas de coordenadas, colores y anchos de celda; reescribirlas en
TypeScript no habría añadido un solo tipo útil —el módulo exporta una función que
recibe un documento de PDFKit y un objeto de textos ya formateados— y habría
convertido una comprobación trivial (un `git mv` sin diff) en una revisión visual
página a página.

Así que se mueve intacto, `tsconfig.json` gana `allowJs: true` con `checkJs`
apagado —para que `tsc` lo copie a `dist/`, sin comprobarlo— y los tipos se le
ponen desde fuera con un `pdfService.d.ts` hermano. Es una excepción acotada a un
archivo, del mismo tipo que la del ADR 0002 para la costura del gateway, y con la
misma condición: el día que haya que cambiar cómo se dibuja un comprobante, ese
día se convierte.

Lo que sí se hizo fue **probarlo de verdad**, que antes no se hacía: la suite de
comprobantes genera el PDF, lo descomprime, decodifica sus operadores de texto y
comprueba el contenido renglón por renglón. Antes sólo se miraba el
`content-type`.

---

## Decisión 4 — `verificar-mora` y el motor pasan a aplicar la misma regla

CLAUDE.md lo tenía anotado como trampa conocida: «un contrato de 16 líneas de
mora no existe: `verificar-mora` y el motor no aplican la misma regla». El
endpoint manual marcaba `EN_MORA` con que el corte hubiera pasado **un** día,
mientras que `procesarPagos()` espera al **sexto**. Quien lo disparara desde
Postman dejaba cuentas en mora que el motor no habría marcado, y que además no
volvían atrás solas.

Se unifica aquí, que es donde CLAUDE.md decía que tocaba hacerlo cuando el motor
se mudara a Financiero. La regla es una constante exportada, `DIAS_PARA_MORA`, y
la usan los dos. `PARCIAL` deja de entrar también en el endpoint, como en el
motor.

> **Corregido (2026-09-14, `feature/fix-mora-parcial`).** Excluir `PARCIAL` no era
> una decisión sino un error heredado del `estado IN (1, 3)` del barrido original, y
> esta unificación lo extendió al endpoint en vez de cerrarlo. Una cuenta que recibía
> un abono antes del sexto día pasaba a `PARCIAL` y ya no entraba en mora nunca. La
> regla es la del saldo: **saldo mayor que cero y corte vencido es mora, haya abonos o
> no.** Motor y endpoint comparten ahora, además de `DIAS_PARA_MORA`,
> `ESTADOS_QUE_ENTRAN_EN_MORA` (`PENDIENTE` y `PARCIAL`); el aviso previo también
> llega a las `PARCIAL`, y el dashboard las cuenta en su métrica de mora.
> `estadoSegunSaldo` no cambia: `EN_MORA` ya ganaba sobre `PARCIAL` cuando el abono
> llega después de la mora.

Lo que NO se unifica es el alcance: el motor barre el sistema entero y el
endpoint sólo los contratos de quien llama. Ésa es la diferencia entre un proceso
y una petición, y tiene que seguir.

---

## Deuda: el cron no dispara con scale-to-zero — **BLOQUEANTE PARA PRODUCCIÓN**

El motor se muda con `node-cron`, que programa el barrido diario **dentro del
proceso**. Funciona mientras el proceso viva, y hoy vive: Compose mantiene el
contenedor en pie.

**Deja de funcionar en el destino del paso 8.** Azure Container Apps escala a
cero cuando no hay tráfico, y un contenedor dormido a las 00:01 no ejecuta nada.
El fallo es además del peor tipo: silencioso. No hay error, no hay log, no hay
excepción — simplemente las cuentas de cobro de ese día no se generan y las moras
no se marcan, y nadie se entera hasta que un inquilino pregunta por su recibo.

### La salida, y por qué no se aplica hoy

Un **trabajo programado de Container Apps**: un `Job` con `triggerType:
Schedule`, que levanta un contenedor a la hora pactada, ejecuta el barrido y se
apaga.

El código ya está listo para eso. `src/scripts/motor.ts` hace exactamente ese
barrido, no depende de que la API esté escuchando, cierra la conexión al terminar
y sale con código distinto de cero si algo falla — que es como un `Job` de
Container Apps decide si la ejecución fue bien.

Lo que falta no es código sino **infraestructura**: el Bicep que declara el
`Job`, y eso es trabajo del paso 8, donde se escribe el despliegue entero. Traerlo
ahora significaría escribir Bicep contra un entorno que todavía no existe.

Mientras tanto `node-cron` es lo correcto: es lo que hace el motor demostrable en
la defensa sin desplegar nada.

### Qué hay que hacer para no olvidarlo

1. `iniciarMotorFinanciero()` **grita en el log** al arrancar que su cron no
   dispara con scale-to-zero, y remite a este ADR. No es un aviso decorativo: es
   el único sitio donde alguien que despliegue esto lo va a leer.
2. Queda en CLAUDE.md como **decisión abierta marcada como bloqueante para
   producción**, no como un «reconsiderar en el paso 8» cualquiera. La diferencia
   importa: las otras decisiones abiertas del paso 8 —claves por servicio,
   limitación de tasa— degradan la seguridad si no se hacen; ésta rompe una
   función del producto.
3. El día que se resuelva, `iniciarMotorFinanciero()` desaparece del arranque y
   el aviso con él. `procesarContratos()` y `procesarPagos()` no se tocan.

---

## Consecuencias

**Buenas:**

- El gateway cumple el Capítulo 2: sin tablas, sin base, sin migraciones. Sus
  suites corren ahora **sin PostgreSQL**.
- El caso de creación en cadena del Capítulo 2 está implementado, con dos
  consumidores del mismo evento, que es lo que el bus prometía.
- `database/dominio/` desaparece. Cada esquema tiene su carpeta y su dueño.
- El barrido del motor pasa de tres peticiones por ciclo a **dos**: el inmueble
  viaja dentro del contrato (`incluir=inmueble`) y el salto encadenado lo da
  ms-contratos, que ya sabía hacerlo en lote.
- Los comprobantes tienen por fin pruebas de contenido.

**Malas, o al menos a vigilar:**

- El cron. Ver arriba.
- El dashboard depende ahora de tres servicios en vez de dos, así que su
  disponibilidad es el producto de las tres. Se acepta a cambio de que no mienta:
  un fallo devuelve 502 y nunca cifras en cero.
- Un servicio Core abre una conexión SMTP, que es de ms-notificaciones. Es la
  misma deuda que el ADR 0010 dejó anotada para ms-identidad y vence el mismo
  día: en el paso 7 el motor pasa a **publicar eventos** —«cuenta próxima a
  vencer», «cuenta en mora»— y Notificaciones decide a quién avisar. Eso
  convertirá a ms-financiero en productor del bus, con su propia tabla de salida.

## Anotaciones posteriores (2026-09-14)

- **La conexión SMTP del motor quedó SALDADA en el paso 7**: el motor publica
  `CuentaCobroPorVencer` y `CuentaCobroEnMora` y ms-financiero ganó su tabla de
  salida. Ver `docs/adr/0019`.
- ~~**El cron sigue abierto y sigue siendo bloqueante para producción.**~~ **SALDADO por
  `docs/adr/0021`**: en Container Apps el motor lo ejecuta un trabajo programado con
  `npm run motor`, y `MOTOR_PROGRAMACION` deja escrito qué entorno usa `cron` y cuál el
  trabajo. De paso, el motor pasó a ser idempotente y a no tragarse sus fallos.
