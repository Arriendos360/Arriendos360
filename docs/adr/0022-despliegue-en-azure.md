# ADR 0022 — Despliegue en Azure

- **Estado:** aceptado (2026-09-16). Los siete cortes del plan están hechos y lo que aquí se
  decidió está desplegado y medido.
- **Fecha:** 2026-09-14
- **Paso:** 8 (despliegue). El plan por cortes está en CLAUDE.md, «Despliegue en Azure».
- **Se aparta del Capítulo 2:** no. Resuelve cómo se despliega lo que el documento
  especifica.

## Contexto

Los cinco servicios y el gateway corrían sólo en Compose, con imágenes de desarrollo
—ts-node-dev y nodemon, de 354 a 437 MB con dependencias de desarrollo— que además
aplicaban sus migraciones al arrancar. En Azure Container Apps eso no sirve: con escala
a cero la imagen se descarga y arranca en frío, y con varias réplicas varias migrarían a
la vez.

## Decisiones

### Topología

| Tema | Decisión |
|---|---|
| Región | `mexicocentral` si Container Apps y sus Jobs están disponibles; si no, `brazilsouth` (~60 % más cara en cómputo). |
| Cómputo | Un entorno de Container Apps en modo `WorkloadProfiles` con sólo el perfil `Consumption`, declarado explícitamente (ver «El entorno nació en modo Express»). `gateway` con ingreso externo y sólo HTTPS; los cinco servicios con ingreso interno. Escala a cero en todos. |
| TLS | Lo termina el ingreso del gateway, con certificado administrado: es la terminación que pide el módulo de seguridad, sin gestionar certificados. `PROXY_SALTOS_CONFIANZA=1`. |
| SPA | Azure Static Web Apps Free, nuevo, con región de metadatos `eastus2` (no se ofrece en `mexicocentral`). Sólo estáticos; la API entra únicamente por el gateway. |
| Base | PostgreSQL Flexible Server B1ms, TLS obligatorio, acceso público restringido a servicios de Azure. **Riesgo aceptado**: la red privada es más coherente con confianza cero y queda como decisión abierta. |
| Secretos | Key Vault, con referencias resueltas por identidad administrada. Ningún valor en el Bicep ni en el repo. |
| Imágenes | GHCR privado. |
| Correo | **Temporal:** Gmail personal por SMTP 587 con contraseña de aplicación en Key Vault. Azure bloquea el 25 pero no el 587 autenticado. |

### Imágenes: una etapa de desarrollo y otra de producción

Cada Dockerfile tiene `dependencias` → `desarrollo` (lo que usa Compose, igual que antes)
→ `compilacion` (compila TypeScript y quita las dependencias de desarrollo con
`npm prune --omit=dev`) → `produccion` (sólo `dist/`, dependencias de producción, usuario
`node`, arranque con `node`). Compose fija `target: desarrollo`.

Los procesos auxiliares salen compilados de la misma imagen: `node dist/database/aplicar.js`,
`node dist/database/seed.js`, `node dist/scripts/motor.js` y `node dist/scripts/enviar.js`.

Las dependencias de producción salen de una **instalación limpia**, no de `npm prune`. En
npm 10, `npm prune --omit=dev --workspace=…` conserva lo que el lockfile trae de los demás
workspaces —typescript, ts-node, jest, babel—: la imagen de ms-identidad llevaba 96 MB de
`node_modules` en vez de 30. `infra/docker/solo-produccion.js` reduce la raíz a los
workspaces de la imagen y quita los `prepare` (compilan con TypeScript, que ya no está)
antes de `npm install --omit=dev`. De paso, `nodemon` pasó a dependencia de desarrollo del
gateway.

### Migraciones: fuera del arranque

- `MIGRACIONES_AL_ARRANCAR`, obligatoria: `si` en Compose y local, `no` en Azure. Con `no`
  el servicio comprueba `migracionesPendientes()` —sin escribir— y **no arranca** si queda
  alguna.
- En Azure las aplica un Job manual por servicio, lanzado por el pipeline **antes** de
  publicar la revisión nueva. Cada Job migra sólo su esquema (regla dura 3).
- El runner toma un bloqueo consultivo de PostgreSQL por esquema dentro de la transacción
  de cada migración, y comprueba ahí si ya está anotada. Dos procesos migrando a la vez —un
  reintento, dos despliegues— se serializan: el segundo espera y la salta.
- Una migración tiene que ser compatible con la revisión que sigue corriendo mientras se
  publica la nueva.

### Conexión a PostgreSQL

- `DB_SSL=si` activa TLS verificando el certificado.
- `DB_POOL_MAX` fija el pool por réplica: B1ms admite 35 conexiones de usuario para los
  cinco servicios y sus Jobs, así que en Azure son 3.

### Gateway y SPA ante el arranque en frío

- `PROXY_TIMEOUT_MS` sube el límite del proxy —10 s por defecto— para no devolver 502 a
  una petición que espera a un servicio que está despertando. En Azure, 60 s.
- `CORS_ORIGENES` limita los orígenes al de la SPA. Sin ella, cualquiera, como en desarrollo.
- El login de la SPA reintenta ante un 502, 503 o 504, o si no hay respuesta, y avisa de
  que el servicio está despertando.

### Infraestructura base (corte 2)

- **Un script para lo previo, Bicep para lo demás.** `infra/azure/bootstrap.sh` crea el
  grupo, el Key Vault, las identidades, sus roles y la credencial federada, y carga los
  secretos. Va aparte por dos motivos: `base.bicep` lee del Key Vault la contraseña de
  PostgreSQL, que tiene que existir antes, y asignar roles exige ser propietario, mientras
  que la identidad del pipeline sólo es colaboradora del grupo.
- **Secretos que no ve nadie.** Los aleatorios los genera el script sin imprimirlos, y
  repetirlo nunca los rota. La cadena de conexión de Storage no existe hasta crear la
  cuenta: la escribe Bicep directamente en el Key Vault.
- **Nombres.** Los que deben ser únicos en Azure llevan un sufijo derivado del id de la
  suscripción: estable entre ejecuciones y sin anotar nada en el repositorio.
- **Identidades.** `id-arriendos360-apps` sólo lee secretos. `id-arriendos360-despliegue`
  entra desde GitHub Actions por OIDC con el sujeto
  `repo:Arriendos360/Arriendos360:environment:produccion`.
- **PostgreSQL 15**, la misma versión mayor que Compose, con `require_secure_transport`
  fijado. Los cinco servicios entran con el usuario administrador, como en Compose; un rol
  por esquema queda como decisión abierta.
- **Log Analytics** con tope de 0,15 GB diarios, por debajo de los 5 GB mensuales gratuitos.
- **Validado** con `bicep build` y `bicep lint` sin avisos (CLI 0.47). Sin `az` en la
  máquina de desarrollo, el `what-if` y la verificación se ejecutan en Cloud Shell.
- **Verificado en Azure** (2026-09-15) con `verificar-base.sh`: los seis secretos, el tope
  de logs, el entorno, Storage sin acceso público, y PostgreSQL 15.19 con TLSv1.3 y
  certificado verificado por el almacén de Node —lo mismo que `DB_SSL=si`—, rechazando
  las conexiones sin TLS.

### Imágenes y Jobs de migración (corte 3)

- **Workflow manual «Imágenes», sólo desde `main`.** Construye las seis imágenes con
  `--target produccion` y las publica en `ghcr.io/arriendos360/<nombre>:<commit>`. Sin
  `latest`: cada despliegue nombra exactamente lo que corre. Publica con el `GITHUB_TOKEN`
  de la ejecución (`packages: write`), sin secretos guardados ni acceso a Azure, y por eso
  no pasa por el entorno con aprobación. La etiqueta `source` enlaza el paquete con el
  repositorio, que es privado: el token de GHCR de Container Apps lo lee por esa vía.
- **Un Job manual por servicio, `migrar-<servicio>`,** con la imagen de producción del
  servicio y `node dist/database/aplicar.js`: cada uno migra sólo su esquema. Más
  `seed-identidad` con `node dist/database/seed.js`. 0,25 vCPU y 0,5 GiB, diez minutos
  y un reintento, que es seguro: el runner toma el bloqueo consultivo y salta lo aplicado, y
  el seed no repite usuarios. `DB_POOL_MAX=2`.
- **Secretos y registro.** `db-password` y `ghcr-token` son referencias al Key Vault
  resueltas con `id-arriendos360-apps`; el registro es `ghcr.io` con el usuario dueño del
  token. Si la referencia del registro fallara (riesgo anotado en CLAUDE.md), la salida es
  publicar las imágenes como públicas.
- **Scripts.** `desplegar-trabajos.sh <commit>` con `what-if` y confirmación;
  `ejecutar-trabajo.sh <job>` lanza, espera y muestra la salida desde Log Analytics con
  `az rest`, sin la extensión `containerapp`. `verificar-trabajos.sh` hace dos rondas de los
  seis Jobs a la vez: en la segunda cada migración debe decir «sin migraciones pendientes» y
  el seed encontrar los tres usuarios, así que vale sobre una base vacía o ya migrada.
- **Git Bash.** `comun.sh` quita el `\r` que `az` añade en Windows y fija
  `MSYS_NO_PATHCONV`; sin eso, hasta el sufijo de los nombres saldría distinto. Las rutas de
  archivo que recibe `az` pasan por `ruta` (`cygpath -m`).

### El entorno nació en modo Express (corte 3)

- **Qué pasó.** `base.bicep` declaraba el entorno sin `workloadProfiles` (API 2024-03-01), la
  forma antigua de pedir uno «sólo consumo». Azure lo creó en modo **Express**, la variante
  en preview para apps web, y el primer despliegue de Jobs falló con
  `ExpressEnvironmentResourceNotSupported`. El modo sólo se ve con la API
  2026-03-02-preview (`environmentMode`: `ConsumptionOnly`, `WorkloadProfiles`, `Express`,
  `Archived`); el registro de actividad muestra que nació así, no que lo migraran.
- **Por qué no sirve.** Express no admite Jobs —ni migraciones ni motor, `docs/adr/0021`—,
  ni referencias a Key Vault, ni descubrimiento interno de servicios, y la documentación
  sólo describe el paso de estándar a Express, no el inverso.
- **Qué se hizo.** Se borró el entorno, que estaba vacío, y se recreó con el mismo nombre en
  modo `WorkloadProfiles` y sólo el perfil `Consumption`: mismo cobro por segundo y misma
  concesión gratuita, sin tarifa de administración. `environmentMode` se fija con la API
  en preview, que Bicep aún no tipa (`BCP081` suprimido). `desplegar-base.sh` y
  `verificar-base.sh` comprueban el modo.
- **Coste en tiempo.** Un entorno estándar tarda más de diez minutos en crearse, frente al
  minuto del Express.

### Verificación del corte 3 en Azure (2026-09-15)

- **Primera ejecución, base vacía:** cada Job aplicó sólo lo suyo —identidad 7 migraciones,
  inmuebles 3, contratos 2, financiero 4, notificaciones 1— y el seed creó los tres usuarios.
  `migrar-identidad` y `seed-identidad` corrieron a la vez sobre el mismo esquema sin
  conflicto: el bloqueo consultivo los serializó.
- **Registro privado:** la imagen de ms-inmuebles (48 MB) bajó de GHCR en 5 s con
  `ghcr-token` resuelto desde el Key Vault. El riesgo anotado no se materializó.
- **`verificar-trabajos.sh`:** doce ejecuciones en `Succeeded`; en la segunda ronda las cinco
  migraciones dicen «sin migraciones pendientes» y el seed encuentra los tres usuarios. Unos
  cuatro minutos en total.
- **Dos fallos del propio script, corregidos:** la expresión JMESPath de la consulta a Log
  Analytics era inválida (`rows[].[0]`, ahora `rows[*][0]`) y el error se silenciaba; y
  `verificar-base.sh` daba por bueno el rechazo sin TLS ante un simple timeout.

### Servicios y motor (corte 4)

- **Una Container App por proceso** (`modulos/app.bicep`): revisión única, perfil
  Consumption, 0,25 vCPU y 0,5 GiB, de 0 a 1 réplica. El tope de 1 también protege el orden
  por clave del bus, que no está garantizado con varias réplicas de un productor.
- **Ingreso.** `gateway` externo, sólo HTTPS (HTTP redirige), con `PROXY_SALTOS_CONFIANZA=1`
  y `PROXY_TIMEOUT_MS=60000`. Los cinco servicios internos, llamados por `http://ms-*` dentro
  del entorno con `allowInsecure`: la protección son los tokens de usuario y de servicio, no
  la red. El cifrado entre apps del entorno queda como opción, no activada.
- **Variables.** Las que cada `server.ts` exige, con `MIGRACIONES_AL_ARRANCAR=no`,
  `DB_SSL=si`, `DB_POOL_MAX=3` y `MOTOR_PROGRAMACION=trabajo`. Todo valor secreto es referencia
  al Key Vault, y también la dirección de Gmail (`email-usuario`): no es secreta, pero es
  personal y no va en el repositorio. `URL_APP` y `CORS_ORIGENES` quedan vacías hasta el
  corte 5.
- **Motor.** Job programado `motor-financiero` con `modulos/trabajo.bicep`, que unifica los
  Jobs manuales y programados. Hallazgo: el script sólo anotaba los avisos en la tabla de
  salida y salía, y con ms-financiero dormido nadie los publicaba hasta que algo lo
  despertara. Ahora hace hasta doce barridos del publicador, con 10 s de pausa, antes de
  salir; lo pendiente lo entrega el servicio al arrancar. Exige `MS_NOTIFICACIONES_URL`,
  porque sin suscriptores el publicador marca los avisos como entregados.
- **Verificación** (`verificar-apps.sh`): primero espera a que las seis apps estén en cero
  réplicas y mide el login en frío, porque cualquier otra prueba las despierta; después
  HTTPS y redirección, servicios inalcanzables por su FQDN interno y externo, login en
  caliente, el Job del motor y, con `CORREO_PRUEBA`, el envío de recuperación en el log de
  ms-notificaciones.
- **Tiempos de espera al despertar.** La primera verificación mostró que los clientes internos
  esperan 3 s por defecto y un servicio dormido tarda más: el Job del motor falló contra
  ms-contratos y sólo pasó en el reintento. Lo mismo le pasaría al dashboard, a la
  pertenencia y a la resolución de correos. En Azure todas las `MS_*_TIMEOUT_MS` y
  `COMPOSICION_TIMEOUT_MS` son de 30 s, por debajo de los 60 s del proxy del gateway. La
  entrega del bus sigue en 10 s: si falla, reintenta.
- **Escala a cero en cadena.** Los servicios con caché de revocados consultan a ms-identidad
  cada 15 s, así que ms-identidad es la última en dormirse: sólo cuando las demás ya no
  tienen tráfico. Medido: las otras cinco a cero a los ~5 minutos, ms-identidad a los ~20.
- **Tres fallos del script en Git Bash, corregidos:** el `curl` de mingw es un programa de
  Windows y no escribía en rutas `/tmp/...` —el login respondía 200, pero el cuerpo se
  perdía—; `date +%s | tail -c 9` dejaba un `\n` en el documento del registro de prueba; y el
  `openssl` de mingw termina en `\r\n`, así que `tr -d '\n'` dejaba un `\r` en la contraseña.
  Los dos últimos invalidaban el JSON y ms-identidad respondía 400. El del `\r` también
  estaba en `bootstrap.sh`: los secretos existentes se generaron en Cloud Shell y están bien.
- **Medido en Azure (2026-09-15), tras subir las esperas:**

  | Prueba | Resultado |
  |---|---|
  | Primer login con las seis apps en cero réplicas | 200 con token en **36,8 s** |
  | Login con todo despierto | 200 en 0,6 s |
  | `http://` del gateway | 301 a HTTPS |
  | Los cinco servicios por su FQDN interno y externo, desde internet | 404 |
  | Job `motor-financiero` | `Succeeded` al primer intento |
  | Registro de un propietario de prueba con apps despertando | 201 en 30,8 s |
  | Recuperación → correo enviado por ms-notificaciones | 200; envío registrado a los 26 s |


### SPA en Static Web Apps (corte 5)

- **Sitio sin enlazar a GitHub.** Un Static Web App enlazado publica en cada push y guarda su
  token en los secretos del repositorio, justo lo que el plan evita. `spa.bicep` lo crea con
  `provider: 'None'`, y `desplegar-spa.sh` sube el build con la CLI oficial y un token pedido
  con `az staticwebapp secrets list` en el momento, pasado por el entorno y no como argumento.
- **`eastus2`,** porque Static Web Apps sólo existe en cinco regiones y es la única que además
  permite la política de la suscripción. Es región de metadatos: el contenido se sirve desde
  la red de borde.
- **La URL de la API se fija al compilar.** CRA resuelve `REACT_APP_API_URL` en el build, así
  que el sitio queda atado al gateway de ese momento y cambiarlo exige recompilar. Incluye
  `/api`, como el valor por defecto de `apps/web/src/services/api.js`.
- **`navigationFallback`** devuelve `index.html` en las rutas del enrutador, y excluye
  `/static/*` y los archivos con extensión para que un recurso que falta siga dando 404 en vez
  de disfrazarse de portada. Sin `responseOverrides`: convertir todo 404 en 200 escondería
  errores reales.
- **Verificado en Azure** (2026-09-16) con `verificar-spa.sh`: portada, `/contratos` recargada
  sin 404, estáticos servidos y uno inexistente en 404, el JavaScript publicado apuntando al
  gateway, y el gateway admitiendo por CORS el origen de la SPA y no uno ajeno. Con el
  redespliegue de las apps, `URL_APP` y `CORS_ORIGENES` quedan en esa URL.

### Pipeline (corte 6)

- **Un workflow que llama a los mismos scripts.** `desplegar.yml` no reimplementa el
  despliegue: ejecuta `desplegar-base.sh`, `desplegar-trabajos.sh`, `ejecutar-trabajo.sh`,
  `desplegar-apps.sh`, `desplegar-spa.sh` y `humo.sh`, con `CONFIRMADO=si`. Lo que corre a
  mano y lo que corre en CI es el mismo código, y por eso una persona puede tomar el relevo a
  mitad de camino.
- **Manual.** Sólo `workflow_dispatch` y sólo desde `main`. El trabajo que toca Azure declara
  `environment: produccion`, que es el sujeto exacto de la credencial federada: con otro
  nombre, OIDC no entra. **La aprobación por revisor quedó fuera**, no por decisión: las
  reglas de protección de entorno no están disponibles en repositorios privados del plan
  gratuito. Lo que queda es que sólo quien tiene acceso al repositorio puede lanzarlo, y que
  el despliegue es explícito y no automático con cada push. Si el repositorio pasara a
  público o a un plan con esa función, basta con añadir el revisor: el workflow ya declara el
  entorno.
- **Sin secretos en GitHub.** Azure por OIDC con tres variables no secretas; las imágenes con
  el `GITHUB_TOKEN` de la ejecución; el token del Static Web App pedido al vuelo.
- **El sujeto de la credencial federada lleva identificadores, no nombres.** GitHub emite
  ahora el sujeto «inmutable»
  (`repo:Arriendos360@<id org>/Arriendos360@<id repo>:environment:produccion`); con el formato
  antiguo, Entra rechaza el token con `AADSTS700213`. Es preferible: sobrevive a un renombrado
  y un repositorio nuevo que reutilice el nombre viejo no hereda el acceso. `bootstrap.sh` lo
  calcula con `gh`, o lo acepta en `SUJETO_OIDC`.
- **Desplegar no necesita leer secretos, y no puede.** La identidad del pipeline es
  colaboradora del grupo: eso permite `getSecret` de Bicep —que es plano de control— pero no
  leer valores del Key Vault, que se concede con un rol de datos aparte. Por eso los scripts
  comprueban que un secreto exista preguntando por su nombre en ARM (`secreto_existe` en
  `comun.sh`) en vez de pedir su valor. Darle el rol de datos habría sido dar de más.
- **El sitio de la SPA se crea antes que las apps, y su contenido después.** El gateway limita
  el CORS al origen de la SPA y los correos enlazan ahí, así que las apps necesitan esa URL;
  pero el build se compila contra el gateway. De ahí `PASO=sitio|contenido|todo` en
  `desplegar-spa.sh`, y que `desplegar-apps.sh` tome esa URL por defecto del despliegue `spa`.
- **Las pruebas en CI necesitan entorno explícito:** las suites cargan `dotenv` y en el runner
  no hay `.env`. El workflow da `DB_*`, `JWT_SECRET` y `SERVICIO_JWT_SECRET`, y PostgreSQL 15
  como servicio. Las `MS_*_URL` no: cada suite levanta sus dobles y las fija ella misma.
- **Humo corto, verificaciones largas a mano.** `humo.sh` —gateway, login, SPA y CORS— tarda
  dos o tres minutos y cierra cada despliegue. Medir el arranque en frío, mandar un correo de
  recuperación o correr las dos rondas de Jobs se queda en los `verificar-*`, que se lanzan
  cuando toca cerrar un corte.
- **Leer los logs no puede tumbar un despliegue.** `ejecutar-trabajo.sh` decide por el estado
  de la ejecución, que da la API de Container Apps; la salida de Log Analytics es informativa
  y se tolera que falle, porque la identidad del pipeline es colaboradora del grupo y puede no
  tener acceso de consulta.
- **`calentar.yml`** sube a una réplica gateway e identidad, espera los minutos pedidos y los
  devuelve a cero con `if: always()`: si no, un fallo dejaría réplicas encendidas gastando. Los
  minutos se pasan por el entorno y se validan como número, en vez de interpolarse en el
  script.
- **Estrenado el 2026-09-16.** Ejecución completa en verde en ~18 min: pruebas 222 s, las seis
  imágenes 19–37 s cada una y el despliegue en Azure 837 s. Dentro de ese despliegue, lo más
  lento es aplicar las migraciones (283 s: cada Job arranca su contenedor) y la infraestructura
  base (218 s), que converge sin cambiar nada.
- **Repetirlo es inocuo, comprobado.** La segunda ejecución sin cambios terminó en verde, las
  cinco migraciones dijeron «sin migraciones pendientes» y **ninguna app creó una revisión
  nueva** —la activa siguió siendo la de la ejecución anterior—. El `what-if` sí anuncia
  «N to modify»: son propiedades que Azure rellena por su cuenta (`exposedPort`,
  `maxInactiveRevisions`, `runningStatus`, los secretos ocultos), no cambios reales. El
  contador de revisiones es la prueba, no el what-if.
- **Tres fallos al estrenarlo, los tres de configuración y ninguno de Azure:** el sujeto OIDC
  inmutable; la comprobación de secretos que pedía valores que el pipeline no puede leer; y el
  runner, que clona limpio, compilando la SPA sin dependencias instaladas.

### Despliegue independiente por servicio

- **El problema.** Con la etiqueta igual al commit de la rama, un cambio en un servicio
  cambiaba las seis imágenes, y Container Apps estrenaba revisión en las seis aunque su código
  fuera idéntico. Medido: un despliegue que sólo tocaba scripts de infraestructura creó
  revisión nueva en `gateway` y en `ms-notificaciones`.
- **La etiqueta es el último commit que tocó ese servicio** (`infra/azure/etiquetas.sh`). Una
  imagen que no cambió conserva su etiqueta, la plantilla queda idéntica y no hay revisión
  nueva. `packages/shared`, `packages/contracts`, los manifiestos de la raíz y el script que
  arma las imágenes cuentan para todos los servicios: si cambia el contrato compartido, se
  redespliegan los seis, que es lo correcto.
- **Un solo cálculo, dos usos.** El mismo script lo usan el workflow y quien despliega a mano,
  para que nunca discrepen. `desplegar-apps.sh` exige que los Jobs estén desplegados con esas
  mismas etiquetas: son los que aplican las migraciones que la revisión nueva da por hechas.
- **Se construye sólo lo que falta.** El workflow pregunta al registro si ya existe cada
  imagen con su etiqueta; si nadie tocó nada, no construye ninguna.
- **Se migra sólo lo que cambió.** `servicios-a-migrar.sh` compara las etiquetas desplegadas
  con las nuevas. Vale porque una migración viaja siempre dentro de su servicio:
  `database/<esquema>` es una de sus rutas. Al revés no siempre, y entonces el Job corre y no
  aplica nada, que es inocuo.
- **La SPA se republica sólo si cambió.** Lo publicado queda anotado en las etiquetas del
  recurso —el commit de `apps/web` y la URL de la API—; si ninguno cambió, recompilar daría
  exactamente lo mismo. `FORZAR=si` lo rehace igual.
- **Desplegar sigue siendo idempotente.** No se despliegan «sólo las apps que cambiaron»: se
  despliegan las seis siempre, con etiquetas que no cambiaron. Así, si alguien tocó algo a mano
  en el portal, el despliegue lo devuelve a su sitio; con despliegues selectivos, esa deriva
  sobreviviría hasta que alguien tocara ese servicio.

## Mediciones del corte 1 (local, Docker Desktop)

| Imagen | Compose hoy | `produccion` en disco | `produccion` a descargar |
|---|---|---|---|
| gateway | 354 MB | 188 MB | 45 MB |
| ms-identidad | 386 MB | 217 MB | 48 MB |
| ms-inmuebles | 386 MB | 216 MB | 48 MB |
| ms-contratos | 437 MB | 261 MB | 53 MB |
| ms-financiero | 426 MB | 248 MB | 54 MB |
| ms-notificaciones | 388 MB | 217 MB | 48 MB |

«A descargar» es el contenido comprimido, lo que baja una réplica nueva; la etapa
`desarrollo` equivalente baja ~80 MB. ms-contratos y ms-financiero pesan más por el SDK de
Blob y la generación de PDF.

- **Arranque hasta escuchar**, de `docker run` al log, tres veces cada uno: ms-identidad
  ~590 ms en producción frente a ~1,2–1,4 s con ts-node-dev; gateway ~580 ms frente a
  ~1,0 s con nodemon.
- **Primer login con gateway e identidad arrancando a la vez**: 200 a los 1,8 s de crear los
  dos contenedores. En local no hay descarga de imagen ni base remota: el número de Azure
  se mide en el corte 4.
- **Migraciones**: con `MIGRACIONES_AL_ARRANCAR=no` y la base vacía, la imagen sale con 1 y
  lista las siete pendientes. Dos `aplicar.js` lanzados a la vez aplican cada migración una
  sola vez —el segundo termina «sin migraciones pendientes»— y un tercero no hace nada.


## Consecuencias

- Quien arranque un servicio en local con `npm run dev` añade `MIGRACIONES_AL_ARRANCAR=si`
  a su `.env`.
- Una base atrasada ya no se arregla sola al desplegar: el servicio se niega a arrancar y
  dice qué migraciones faltan. Es a propósito.
