# Arriendos360

Plataforma web de gestión de arrendamientos para propietarios pequeños y medianos en
Bogotá D.C. Proyecto de grado, Especialización en Ingeniería de Software (UDFJDC).
Equipo de 2 personas con dedicación parcial, timebox de 16 semanas, presupuesto en
efectivo de $0 sobre créditos de Azure for Students.

Ese contexto es criterio de decisión, no adorno. Entre la solución elegante y la que
cabe en el cronograma y en los créditos, gana la segunda. Prefiere siempre el cambio
incremental que deja el sistema funcionando sobre la refactorización grande que lo deja
roto una semana. **Funciona: no lo rompas.**

## Jerarquía de autoridad

1. **Documento Principal — Protocolo de desarrollo** (Capítulo 2: Persistencia,
   Arquitectura de microservicios, Módulo de seguridad, Interfaz gráfica). Es la
   especificación vigente.
2. SRS y PMP, para requisitos funcionales y proceso.
3. El código existente.

El código se aparta del Capítulo 2 sólo donde lo registra un ADR. Si este archivo
contradice al documento, gana el documento y avísame. En los payloads del documento **lo
vinculante son los campos y sus nombres**, no los valores. La historia de cada decisión
está en `docs/adr/` y en `git log`, no aquí.

---

## Estado actual

**Los ocho pasos están hechos: los cinco servicios extraídos y el sistema corriendo en
Azure**, con su despliegue automatizado. Ver «Despliegue en Azure» y `docs/despliegue.md`.

| Servicio | Subdominio | Puerto | Esquema: tablas de dominio | Qué sirve |
|---|---|---|---|---|
| `ms-identidad` | Soporte | 3011 | `identidad`: Usuarios, Roles, RolesUsuario, TokensRevocados | `/api/auth`, `/api/usuarios`. Productor. |
| `ms-inmuebles` | Soporte | 3012 | `inmuebles`: Inmuebles | `/api/inmuebles`. Consume los eventos de contrato → estado. |
| `ms-contratos` | Core | 3013 | `contratos`: Contratos, Anexos | `/api/contratos` (anexos, reemisión de contraseña temporal). Productor. |
| `ms-financiero` | Core | 3014 | `financiero`: Cuentas_cobro, Transacciones | `/api/pagos` (comprobantes, anulación) y el motor. Consume y produce. |
| `ms-notificaciones` | Genérico | 3015 | `notificaciones`: ninguna (sólo `envios`, outbox de correos) | Sin API pública: sólo `POST /interno/eventos`. **Único que habla SMTP.** |
| `gateway` | — | 3001 | **ninguna** | Todo `/api/*`; atiende él mismo `/api/dashboard`. |
| `web` | — | 3000 | — | React 18 con CRA y Tailwind v3; marca en `src/ui/marca.md`. |

Servicios en TypeScript `strict`. Cada productor tiene su tabla de salida y cada
consumidor su `eventos_procesados`, en su esquema.

**El gateway no tiene base de datos** —arranca con PostgreSQL caído y da 502 de quien no
responda— y **no se le devuelve ninguna tabla**. Hace cuatro cosas: JWT con caché de
revocados y **matriz RBAC** (`src/routing/matriz.js`); **guardias**
(`src/routing/guardias.js`); **costura** (`src/routing/`: un prefijo es remoto si su
`MS_*_URL` tiene valor, hoy los cinco); y **dashboard**, compuesto por HTTP con
`src/clientes/`. Es JavaScript por `docs/adr/0002`.

**Política de fallo al componer.** Pedir datos para *decorar* degrada (la propiedad sale
`null`); para *autorizar* propaga y responde `502`, porque una lista vacía sería creíble y
falsa. `clientes/financiero.js` no degrada nunca: en el dashboard un «$0 en mora» miente.

**La pertenencia de un contrato se resuelve en un solo sitio**,
`services/ms-contratos/src/services/pertenencia.ts`, expuesta por `GET /interno/contratos`
(`?parte=<sub>`, `?incluir=inmueble`) para ms-financiero y el gateway. **No denormalices
`id_propietario` en `Contratos`**: de ese dato cuelga la autorización y un inmueble cambia
de dueño (`docs/adr/0017`).

**Desviaciones pendientes de incorporar al Capítulo 2** (PMP §13.3.2): `0004` alta de
inquilinos; `0005` filtro de pertenencia siempre activo; `0006` registrar pagos sólo el
propietario; `0007` contraseña temporal; `0010` recuperación (endpoints, tabla de tokens,
`contrasena_cambiada_en`); `0012` garantía de entrega al-menos-una-vez; `0013`
`ContratoFinalizado`; `0015` `observaciones`; `0016` anulación de transacciones; `0019`
el alta manual de un cobro notifica. Los demás ADR no se apartan del documento.

---

## Modelo de datos canónico

Capítulo 2, sección Persistencia. **Ocho tablas de dominio**, más una operativa de
seguridad (`TokensRevocados`, ver módulo de seguridad).

| Tabla | Atributos propios | Referencias |
|---|---|---|
| `Usuarios` | nombres, apellidos, email, contrasena, telefono, documento | — |
| `Roles` | nombre, descripcion | — |
| `RolesUsuario` | — | PK compuesta: `id_rol` + `id_usuario` |
| `Inmuebles` | alias, direccion, ciudad, tipo, descripcion, estado | `id_propietario` → Usuarios |
| `Contratos` | inicio, fin, canon, fecha_inicio_corte, fecha_limite_pago, info_contrato, estado, nombre_deudor_solidario, documento_deudor_solidario | `id_inmueble`, `id_inquilino` |
| `Anexos` | archivo_anexo, tipo | `id_contrato` |
| `Cuentas_cobro` | detalle, valor, inicio, fin, fecha_pago, estado | `id_contrato` |
| `Transacciones` | monto, tipo, fecha_pago, medio_pago, estado | `id_cuenta_cobro` |

- **Dos columnas fuera de esta tabla:** `observaciones` en `Transacciones`
  (`docs/adr/0015`) y `saldo_restante_momento`, la foto del saldo impresa en un
  comprobante ya emitido: **no se deriva ni se toca**, ni al anular.
- **El saldo de una cuenta de cobro NO es una columna.** Es `valor` menos la suma de sus
  transacciones `CONFIRMADA` (`services/ms-financiero/src/services/saldos.ts`), expuesto
  como `saldo_pendiente`. Anular una transacción no «devuelve» nada.
- **`medio_pago` no es `tipo`.** «Transferencia» o «Efectivo» son medios; `tipo` es
  `INGRESO`.
- **Estados:** Contratos `activo`/`finalizado`/`cancelado`; Cuentas_cobro
  `PENDIENTE`/`PAGADA`/`PARCIAL`/`EN_MORA`; Transacciones `CONFIRMADA`/`ANULADA`.
- **Propietario e inquilino son roles** en `RolesUsuario`, no tablas; un usuario puede
  ser los dos.
- **Toda tabla de dominio lleva auditoría:** `creado_por`, `fecha_creacion`,
  `ultima_actualizacion`, `actualizado_por`.
- **Todos los identificadores son UUID** generados en la aplicación con
  `crypto.randomUUID()`, no con `DEFAULT`: hay que conocer el ID antes de publicar un
  evento.

---

## Módulo de seguridad

Capítulo 2, sección Módulo de seguridad. Cuatro capas bajo **Defensa en Profundidad** y
**Confianza Cero**: ninguna petición se considera confiable por venir de la red interna.

### Claims del token

```
sub    UUID del usuario
email  correo del usuario
roles  arreglo de strings, en mayúsculas: ["PROPIETARIO"], ["PROPIETARIO","INQUILINO"]
jti    UUID único del token — necesario para la revocación
exp    expiración, 3600 segundos
```

`roles` es arreglo porque `RolesUsuario` es muchos a muchos. La respuesta del login
expone además un `rol` singular (el principal); son cosas distintas y no se contradicen:
**los claims le hablan al gateway y a los servicios, la respuesta le habla al frontend.**

### Contratos de autenticación

`POST /api/auth/login` — ruta pública, no interceptada por las políticas del gateway.

- Petición: `email`, `contrasena`.
- Respuesta: `token`, `tipo_token`, `expiracion`, y `usuario` con `id` y `rol`.

`POST /api/auth/logout` — ruta protegida, payload vacío, token en `Authorization`.
Registra el `jti` en la lista de revocados hasta su expiración natural.

### Revocación de tokens

Tabla `TokensRevocados` en el esquema de `ms-identidad`: `jti` (PK), `expira_en`. **Sin
barrido programado**: la verificación filtra por `expira_en > NOW()`; si estorba, un
`DELETE` manual. El gateway y cada servicio que verifica tokens guardan una copia en
memoria de los `jti` vigentes, refrescada cada 15 s (`docs/adr/0008`).

### Limitación de tasa

En **ms-identidad**, no en el gateway: contar fallos por cuenta exige leer el cuerpo y
saber si el login falló, y el gateway reenvía sin leer (`docs/adr/0020`). Tabla operativa
`identidad.limites_tasa` (`UNLOGGED`), ventana fija, un `INSERT … ON CONFLICT` atómico.

- Login: 100 / 15 min por IP y 5 fallos / 15 min **por cuenta e IP**. Nunca sólo por
  cuenta: sería bloquear a alguien a pedido. Registro 10 / h; recuperar y restablecer
  5 / h por IP; recuperar 3 / h por cuenta **en silencio** (mismo 200, sin enlace, log).
- 429 con `Retry-After` = la ventana entera y sin cabeceras de cuota. El login fallido
  responde un único 401 y compara con bcrypt aunque el correo no exista.
- La IP la **firma el gateway en cada reenvío** (`x-origen-cliente`,
  `apps/gateway/src/routing/origen.js`); si la firma no vale, el servicio usa la de la
  conexión. `PROXY_SALTOS_CONFIANZA`: vacía en local, 1 en Container Apps.
- El ingreso de Container Apps **no ofrece limitación de tasa** (sólo restricción por IP,
  CORS y afinidad de sesión): no hay nada que configurar ahí.

### Capa 1 — Cliente (SPA)

- El token vive **en memoria**, no en `localStorage` ni en cookies.
- Interceptor HTTP que adjunta `Authorization: Bearer <token>` a toda petición.
- Guardianes de ruta que abortan la navegación no autorizada, incluso por URL escrita a
  mano. La barra lateral se renderiza según los claims de rol.
- **Descargas:** los PDF se piden con `fetch` por el interceptor, como blob, y se
  disparan con un enlace temporal. Nada de `window.open` ni `?token=`.

### Capa 2 — Gateway (Policy Enforcement Point)

- Terminación SSL: todo el tráfico externo va por HTTPS.
- Validación de la firma y vigencia del JWT, y consulta a la lista de revocados.
- **Enrutador RBAC:** una matriz declarativa que cruza método HTTP, ruta y rol, junto a
  la costura, y deniega por defecto. Si no cuadra, `403` y la petición no llega a la red
  interna.

### Capa 3 — Microservicios (dominio)

- Cada servicio **revalida el token por su cuenta** con el middleware de
  `packages/shared`. No confía en que el gateway ya lo hizo.
- **Validación ABAC en los controladores:** no basta el rol. Antes de ejecutar la lógica
  hay que confirmar la pertenencia del recurso — que el inmueble a editar sea del
  `sub` del token, que el contrato consultado sea suyo. Explícito, no implícito en un
  filtro de consulta.

---

## Estructura del repositorio

```
apps/web/              React SPA
apps/gateway/          PEP: JWT, matriz RBAC, guardias, costura, dashboard. SIN base.
services/ms-*/         Los cinco servicios: package.json, Dockerfile, tsconfig, tests/
packages/contracts/    DTOs en TS; los catálogos cerrados emiten JS
packages/shared/       JWT y revocados, auth entre servicios, errores, cliente HTTP,
                       bus (eventos, salida, entrega, entrada) y calendario (fechas.ts)
database/<esquema>/    Migraciones SQL versionadas (docs/adr/0003)
infra/                 Dockerfiles, docker-compose, Bicep, sembrador de la demostración
docs/                  ADRs, ERD, Postman. docs/erd/schema-legacy.sql: NO usar
```

Monorepo con **npm workspaces**.

---

## Reglas duras

Vienen del Capítulo 2 y sostienen la justificación arquitectónica del proyecto. No son
negociables sin solicitud de cambio formal.

**1. Cero claves foráneas entre esquemas.** Ningún servicio declara FK física hacia
tabla de otro servicio. Las referencias cruzadas son UUID sin constraint:
`Inmuebles.id_propietario`, `Contratos.id_inmueble`, `Contratos.id_inquilino`.

**2. Cero JOIN entre servicios.** Ningún `include` de Sequelize ni `JOIN` cruza la
frontera de un bounded context. Las agregaciones se resuelven en el gateway.

**3. Cada servicio es dueño exclusivo de su esquema.** Si necesitas un dato de otro
contexto, se pide por su API.

**4. El `id_propietario` sale del `sub` del token, nunca del payload.**

**5. El dashboard no es un microservicio.** Vive en el gateway, sin tablas propias.

**6. Ningún secreto entra al repositorio.** Solo `.env.example` con valores vacíos.

**7. Confianza cero.** Cada servicio revalida el token aunque venga del gateway.

**8. Autorización en dos niveles.** RBAC en el gateway (¿este rol puede llamar esta
ruta?) y ABAC en el controlador (¿este recurso es suyo?). Ninguno reemplaza al otro.

**9. El estado del inmueble es consistente en el tiempo.** Firmar o finalizar anota un
evento y `ms-inmuebles` converge en ~5 s (`EVENTOS_INTERVALO_MS`). Nada puede afirmar el
estado justo después de firmar: se entregan los eventos (`entregarEventos()`) o se espera
(`esperarA()`).

---

## Comunicación entre servicios

**Síncrono (REST/JSON)** para consultas y comandos del usuario. **Asíncrono (bus)** para
la creación en cadena —`ms-contratos` emite `ContratoFormalizado` y `ms-financiero`
inserta la primera `Cuenta_cobro` con `id_contrato`, `canon` y `fecha_inicio_corte`— y
para avisar a personas: Identidad y Financiero anuncian hechos, Notificaciones decide a
quién. **Coreografía**: el emisor no llama al consumidor ni sabe que existe.

### El bus (`docs/adr/0012`)

PostgreSQL con outbox, sin broker, entero en `packages/shared`. Ningún servicio lo
reimplementa.

- **El evento se escribe en la misma transacción que el cambio de dominio**, en la tabla
  de salida del productor y en SU esquema. Nunca una tabla compartida.
- **El publicador** barre cada 5 s, entrega por `POST /interno/eventos` y reintenta con
  espera creciente. La fila se marca cuando aceptan **todos** los consumidores.
- **Al-menos-una-vez:** el consumidor descarta repetidos por `id_evento`, anotándolo en
  la misma transacción que el efecto. No se intenta exactamente-una-vez.
- **Un evento que falla siempre** sólo frena su `clave_orden` (`id_inmueble`); tras 10
  intentos (~13 min) queda `apartado`, ya no converge solo y hay que reencolarlo.
- **Sobre:** `id_evento`, `tipo`, `version`, `ocurrido_en`, `payload`. **Sin actor**: lo
  que escribe un consumidor se audita como del sistema (`docs/adr/0011`).
- **`RecuperacionSolicitada` lleva el token en claro**; su `payload` se borra en la
  **misma sentencia** que marca la entrega (`tiposRedactados`, `salida.ts`). No lo partas.

### Eventos definidos

Tipos en `packages/shared/src/eventos.ts`.

| Evento | Emisor | Carga | Consumidores |
|---|---|---|---|
| `ContratoFormalizado` **v2** | `ms-contratos` | `id_contrato`, `id_inmueble`, `canon`, `fecha_inicio_corte`, `id_inquilino` | **DOS:** `ms-inmuebles` → `arrendado`, y `ms-financiero` → primera cuenta de cobro. |
| `ContratoFinalizado` | ídem | `id_contrato`, `id_inmueble` | `ms-inmuebles` → `disponible`. Ver `docs/adr/0013`. |
| `RecuperacionSolicitada` | `ms-identidad` | `id_usuario`, `token`, `expira_en` | `ms-notificaciones` → correo con el enlace. |
| `ContrasenaTemporalEmitida` | ídem | `id_usuario`, `motivo` (`ALTA`\|`REEMISION`) | `ms-notificaciones` → aviso de que la cuenta existe. **No lleva la contraseña.** |
| `CuentaCobroGenerada` | `ms-financiero` | `id_cuenta_cobro`, `id_contrato`, `id_inquilino`, `valor`, `inicio`, `fin` | `ms-notificaciones` → recibo al inquilino. |
| `CuentaCobroPorVencer` | ídem | ídem + `id_propietario`, `entra_en_mora_el`, `direccion_inmueble` | `ms-notificaciones` → aviso al inquilino **y** al propietario. |
| `CuentaCobroEnMora` | ídem | ídem + `dias_de_mora` | `ms-notificaciones` → aviso a los dos. |

- **NINGÚN EVENTO LLEVA UNA DIRECCIÓN DE CORREO.** Llevan `id_usuario` y Notificaciones
  resuelve el correo contra ms-identidad al manejar el evento. Sí viaja el asunto
  (dirección, valor, periodo) e `id_propietario` como foto del momento (`docs/adr/0019`).
- **`id_inquilino` es opcional en la v2** a propósito: un sobre v1 crea la cuenta sin
  notificar.
- **`ContratoFinalizado` no tiene consumidor en Financiero**, deliberado: finalizar no
  cancela lo que se debe.

### El motor

`services/ms-financiero/src/services/motor.ts`. **Cuándo corre lo decide
`MOTOR_PROGRAMACION`, obligatoria y sin defecto:** `cron` en Compose y local (node-cron en
el proceso, 00:01 de Bogotá) y `trabajo` en Container Apps, donde el Job programado
`motor-financiero` (`infra/azure/apps.bicep`, `1 5 * * *` en UTC) ejecuta
`node dist/scripts/motor.js` —lo mismo que `npm run motor`, compilado— y el proceso no
programa nada (`docs/adr/0021`). **El motor es idempotente**: puede correr dos veces el
mismo día, seguidas o a la vez, sin duplicar cuentas ni avisos, y sale con 1 si algo falla
para que el Job reintente. **Antes de salir entrega sus avisos** con unos barridos del
publicador: con ms-financiero escalado a cero nadie más lo haría. Por eso exige
`MS_NOTIFICACIONES_URL`: sin ella el publicador marcaría los avisos como entregados.

**La primera cuenta de cobro es del evento**: `procesarContratos()` hace las siguientes y
**salta el primer periodo SIEMPRE, exista o no**, para no facturar dos veces dentro de la
ventana de entrega. Motor y `verificar-mora` comparten `DIAS_PARA_MORA` y
`ESTADOS_QUE_ENTRAN_EN_MORA` (`PENDIENTE` y `PARCIAL`): **saldo mayor que cero y corte
vencido es mora, haya abonos o no** (`docs/adr/0018`).

---

## Contratos de interfaz

Respeta los nombres de campo exactos. Los valores de ejemplo son ilustrativos.

**MS-Identidad** — `POST /api/auth/registro`
```json
{ "nombres": "string", "apellidos": "string", "email": "string",
  "contrasena": "string", "telefono": "string", "documento": "string" }
```
La asignación del rol en `RolesUsuario` se maneja internamente.

**MS-Identidad** — `POST /api/auth/login` y `POST /api/auth/logout`: ver módulo de
seguridad.

**MS-Inmuebles** — `POST /api/inmuebles`
```json
{ "alias": "string", "direccion": "string", "ciudad": "string",
  "tipo": "string", "descripcion": "string" }
```
El `id_propietario` se inyecta desde el `sub` del token.

**MS-Contratos** — `POST /api/contratos`
```json
{ "id_inmueble": "uuid", "id_inquilino": "uuid",
  "inicio": "YYYY-MM-DD", "fin": "YYYY-MM-DD",
  "fecha_inicio_corte": "YYYY-MM-DD", "fecha_limite_pago": 5,
  "canon": 1500000.00,
  "nombre_deudor_solidario": "string", "documento_deudor_solidario": "string" }
```
`fecha_limite_pago` es un **día del mes** (entero), no una fecha.

**MS-Contratos** — `POST /api/contratos/{id_contrato}/anexos`
`multipart/form-data` con `file` (PDF) y `tipo` (`CONTRATO_FIRMADO`, `OTROSI`, etc.).
Valida que sea PDF y que el contrato exista, **sube el archivo a almacenamiento en la
nube**, y guarda la URL devuelta en `archivo_anexo`. Los anexos sólo se descargan por la
API autenticada, nunca con URL firmada (`docs/adr/0014`).

**MS-Financiero** — `POST /api/pagos`
```json
{ "id_cuenta_cobro": "uuid", "monto": 1500000.00, "tipo": "INGRESO",
  "medio_pago": "TRANSFERENCIA", "fecha_pago": "YYYY-MM-DDTHH:mm:ssZ" }
```
El alta manual de un cobro es `POST /api/pagos/cuentas-cobro`.

---

## Llamadas entre servicios

**Todo `/interno` exige credencial de servicio**, sin excepción y desde su primer commit.
No pasan por la matriz ni por la costura, y el puerto está publicado en desarrollo: la red
interna no protege nada. Se aplica en las dos puntas con `packages/shared`:

```js
// El que recibe: una línea, al montar el router.
router.use(exigirServicio({
    destinatario: process.env.SERVICIO_NOMBRE,
    secreto: process.env.SERVICIO_JWT_SECRET
}));

// El que llama: la cabecera en cada petición.
fetch(url, { headers: cabeceraDeServicio({
    emisor: process.env.SERVICIO_NOMBRE,
    destinatario: 'ms-identidad',
    secreto: process.env.SERVICIO_JWT_SECRET
}) });
```

Con `router.use`, no ruta por ruta, para que un endpoint nuevo nazca protegido.
`SERVICIO_JWT_SECRET` **no es** `JWT_SECRET`, o el token de un inquilino abriría
`/interno` (`docs/adr/0009`).

## Reglas que no caben en un solo servicio

Las que dependen de **dos contextos** («no borres un inmueble con contrato activo») van en
`apps/gateway/src/routing/guardias.js`, **después del RBAC y antes de la costura**. No en
el servicio que escribe: Inmuebles es Soporte y Contratos es Core, e invertiría las
dependencias. **Un guardia que rechaza por el estado del recurso responde `409`, no
`403`.**

## Cómo se prueba

- **Contra dobles HTTP**, no contra el stack ni con mocks de función: la costura reenvía
  por red. El gateway los tiene en `apps/gateway/tests/dobles/` y apunta `MS_*_URL` a
  ellos. Sin Docker, en segundos.
- **Los dobles se portan como el real**: exigen credencial de servicio, descartan eventos
  repetidos y resuelven la pertenencia preguntando.
- **Cada servicio contra su propio esquema** en `arriendos360_test`, con `NODE_ENV=test`.
- **Sin temporizadores:** el publicador no se arranca; se llama a `ciclo()` a mano
  (`entregarEventos()` en `tests/utiles/entorno.js`).
- **Integración aparte** (`tests/integracion/`): sólo caminos críticos —entrar, firmar,
  pagar, recuperar la contraseña— contra el stack real. **No** entra en `npm test`.

## Comandos

```bash
docker compose -f infra/docker-compose.yml up --build     # levantar todo
docker compose -f infra/docker-compose.yml down -v        # reinicio limpio
npm test --workspace=services/ms-identidad                # pruebas de un servicio
npm test --workspaces --if-present                        # todas, contra dobles
npm run motor --workspace=services/ms-financiero          # motor: demostraciones y comando del Job
npm run enviar --workspace=services/ms-notificaciones     # barrido manual de los envios
npm run test:integracion                                  # caminos criticos, stack arriba
npm run seed --workspace=services/ms-identidad            # usuarios de prueba
npm run demo                                              # cartera de demostracion (stack arriba)
```

---

## TypeScript incremental

- `tsconfig.json` con `"allowJs": true` y `"checkJs": false`.
- **Todo código nuevo en `.ts`**, salvo `apps/gateway` (ADR 0002).
- `packages/contracts` y `packages/shared` son 100% TypeScript y emiten CommonJS.
- Un `.js` se convierte a `.ts` solo cuando ya lo estás modificando por otra razón.
- `strict: true` en paquetes y servicios nuevos.

## Convenciones

- **Dominio en español, plataforma en inglés.** `contrato`, `canon`, `mora`,
  `cuenta_cobro`; `middleware`, `router`, `handler`.
- **Rutas REST:** `/api/{recurso}` en plural.
- **Errores:** `{ mensaje: "..." }`. 401 sin token o revocado, 403 rol insuficiente o
  recurso ajeno, 400 validación, 404 no encontrado, 409 recurso que no está en
  condiciones.
- **Roles en mayúsculas**: `PROPIETARIO`, `INQUILINO`.
- **Catálogos cerrados en `packages/contracts`, en minúsculas** (Inmuebles), compartidos
  con el frontend y el `CHECK` de la migración. **Nada los sincroniza**: toca los dos.
- **Los de Financiero van en MAYÚSCULAS**, porque el Capítulo 2 fija `"INGRESO"` y
  `"TRANSFERENCIA"` en `POST /api/pagos`.
- **`tipo` de Anexos es un catálogo abierto** (el documento dice «etc.»): sin `CHECK` ni
  `isIn`.
- **Dinero:** pesos colombianos, `NUMERIC`, nunca `float`.
- **Fechas:** guardar en UTC, presentar en `America/Bogota`. Para «hoy» se usa
  `hoyEnZonaNegocio()` y `diasEntre()` (días de calendario), nunca `new Date()` local: en
  un contenedor en UTC el corte de mora se adelantaría cinco horas.
- **Periodo de una cuenta de cobro:** de la fecha de corte al día ANTERIOR al siguiente
  corte, para que los periodos teselen el calendario. Sólo lo calcula `periodoDeCorte()`
  en `packages/shared/src/fechas.ts`.
- **Día pactado que el mes no tiene** (un 31 en febrero): se recorta al último día del mes
  al resolverlo; el día pactado se guarda sin tocar.
- **Variables de entorno: nunca `process.env.X ?? defecto` ni `|| defecto`.** Compose y
  un `.env` copiado de `.env.example` dejan `VAR=` como cadena vacía, que `??` deja pasar
  (mordió en `REVOCADOS_INTERVALO_MS`, el mailer y el remitente). Se lee con
  `leerEntorno`, `textoDeEntorno` o `enteroDeEntorno` de `packages/shared/src/entorno.ts`:
  vacío es ausente y un entero mal formado lanza. Lo que no tiene defecto razonable
  —secretos, `DB_PASSWORD`, las `MS_*_URL` de las que depende— se exige con
  `validarEntorno` al arrancar, y **sin eso el proceso no levanta**. Fuera de alcance:
  `apps/web` (CRA, se resuelve al compilar) y `tests/integracion`.

## Git Flow

- `main` solo con código funcional y desplegable. Nunca commit directo.
- Una rama por historia: `feature/nombre-modulo`.
- **Todo cambio entra por Pull Request** (PMP: quien codifica no es quien prueba).
- Mensajes en español, imperativo: `Extrae ms-identidad del monolito`.

---

## Migración

Terminada. Pasos 1 a 7: monorepo, gateway, identidad y seguridad, ms-inmuebles, bus,
ms-contratos y ms-financiero, ms-notificaciones. **Paso 8: el despliegue en Azure**, que no
creó servicios ni tocó tablas ni bus, y está resumido justo debajo.

## Despliegue en Azure (paso 8)

Hecho y funcionando. El **cómo** está en `docs/despliegue.md` —desplegar, verificar, calentar
antes de una sustentación y qué mirar cuando algo falla—; el **porqué** de cada decisión y las
mediciones, en `docs/adr/0022`. Aquí queda lo que hay que saber sin abrir nada más.

**Qué corre**, todo en el grupo `rg-arriendos360` (`mexicocentral`), salvo la SPA:

| Pieza | Detalle |
|---|---|
| Gateway | `https://gateway.ambitioussea-8d2f1b9e.mexicocentral.azurecontainerapps.io`, Container App con ingreso público sólo por HTTPS. |
| Servicios | `ms-identidad`, `ms-inmuebles`, `ms-contratos`, `ms-financiero`, `ms-notificaciones`: ingreso interno, alcanzables sólo por `http://ms-*` dentro del entorno. Todos de 0 a 1 réplica. |
| SPA | `https://victorious-sand-0d7da490f.5.azurestaticapps.net` (Static Web Apps Free, metadatos en `eastus2`). |
| Jobs | `migrar-*` ×5 y `seed-identidad`, manuales; `motor-financiero`, a las 00:01 de Bogotá (`1 5 * * *` UTC). |
| Datos y secretos | `psql-arriendos360-8b4d5b` (PostgreSQL 15 B1ms, base `arriendos360_db`), `kv-arriendos360-8b4d5b` (siete secretos), `starriendos3608b4d5b` (contenedor `anexos`), `log-arriendos360`. |
| Entorno | `cae-arriendos360`, modo `WorkloadProfiles` con perfil `Consumption`. |

**Cómo se despliega:** solo, con cada push a `main`: **fusionar un PR es desplegarlo**. Un push
que sólo toca `.md` o `docs/` no dispara nada, y el disparo manual (Actions → **Desplegar**)
queda para repetir un despliegue o sembrar. Entra a Azure por OIDC con
`id-arriendos360-despliegue`; no hay ninguna credencial guardada en GitHub. Encadena pruebas
—las mismas que corren en cada PR—, imágenes a GHCR y los scripts de `infra/azure`: base, sitio
de la SPA, migraciones, apps, contenido de la SPA y `humo.sh`. Repetirlo no cambia nada; para
volver atrás, `docs/despliegue.md` § «Revertir un despliegue».
Antes de una sustentación, **Calentar** evita los 37 s del primer login.

**Las decisiones que siguen mandando:**

- **El entorno declara `workloadProfiles` explícito.** Sin eso Azure lo crea en modo Express,
  que no admite Jobs, ni referencias a Key Vault, ni descubrimiento interno, y no se revierte
  sin recrearlo.
- **Cada servicio se despliega solo si cambió.** La etiqueta de su imagen es el último commit
  que tocó sus rutas (`infra/azure/etiquetas.sh`), no el de la rama: el que no cambió conserva
  su etiqueta, su plantilla queda idéntica y Container Apps no le crea revisión. Tocar
  `packages/shared` sí mueve a los seis, y es correcto: el contrato compartido cambió para
  todos.
- **Las migraciones no corren al arrancar** (`MIGRACIONES_AL_ARRANCAR=no`): las aplica un Job
  por servicio antes de publicar revisiones, y con una pendiente el servicio no arranca. Sólo
  se ejecutan las de los servicios que cambiaron (`servicios-a-migrar.sh`).
- **Volver atrás es un `git revert`**, no un botón: el revert vuelve a tocar las rutas del
  servicio, cambia su etiqueta y el push redespliega esa app sola. Lo que no vuelve atrás son
  las migraciones —no hay `down`—, así que una migración tiene que ser compatible con la
  versión anterior del servicio.
- **El motor es un Job programado**, no un cron dentro del proceso: con escala a cero, un
  contenedor dormido no dispara nada (`docs/adr/0021`).
- **Ningún secreto en el repositorio ni en GitHub.** Key Vault por referencia, resuelta con
  identidad administrada; el token del Static Web App se pide al vuelo.
- **La SPA se compila contra el gateway**: `REACT_APP_API_URL` se resuelve al construir, así
  que cambiar de gateway obliga a recompilar.
- **Correo con una cuenta personal de Gmail**, temporal: revocar la contraseña de aplicación
  tras la sustentación.

**Lo que se midió** (detalle en el ADR): primer login con todo dormido **36,8 s**, y 0,6 s
despierto; imágenes de producción de 188 a 261 MB, frente a 354–437 MB de las de desarrollo;
un despliegue completo, con pruebas e imágenes, ~18 min.

**Datos de prueba en Azure:** los tres usuarios del seed (`propietario@`, `inquilino@` y
`ambos@arriendos360.test`, contraseña `Prueba123`), la cartera de demostración que siembra
`infra/demo/sembrar-demo.js` sobre la propietaria —cinco inmuebles, cuatro contratos y su
historial de cobros, con un caso de cada estado— y un propietario con el correo real del
usuario, creado para probar la recuperación. El sembrador entra por el gateway como una
persona más: no escribe en ninguna base, así que los eventos y las cuentas de cobro los
genera el sistema. **Ninguna dirección personal va en el repositorio**; el remitente vive en
el secreto `email-usuario` y el correo del inquilino moroso se pasa por `CORREO_MOROSO`.
Borrar esa cuenta al terminar.

**Riesgos vivos:**

- **La base se puede apagar entre sesiones**, y es lo que conviene cuando nadie va a usar el
  sistema: `az postgres flexible-server stop|start -g rg-arriendos360 -n psql-arriendos360-8b4d5b`.
  Azure la vuelve a encender sola a los siete días. Con la base apagada no arranca ninguna
  app, así que hay que encenderla antes de una demostración. `pg_dump` antes de cada hito.
- **El token de GHCR vence.** Cuando pase, Container Apps no podrá descargar imágenes y las
  réplicas nuevas no arrancarán: renovarlo y actualizar el secreto `ghcr-token`.
- **Node 18 sin soporte** en las imágenes, y **34 vulnerabilidades** que GitHub reporta en las
  dependencias de `main`. Un PR aparte, antes de la sustentación.
- **Recargar la página cierra la sesión**: el token vive en memoria, por diseño (Capa 1).

**Trabajar desde la máquina de desarrollo:** los scripts de `infra/azure` corren en Git Bash y
en Cloud Shell; `comun.sh` resuelve lo de Windows (el `\r` de `az`, las rutas de MSYS). La
única excepción es la prueba de TLS de `verificar-base.sh`, que sólo pasa desde Cloud Shell,
porque la base no acepta conexiones de fuera de Azure. Para las pruebas locales hace falta
Docker Desktop y `docker compose -f infra/docker-compose.yml up -d db`.

## Decisiones abiertas

Resuélvelas con un ADR cuando llegue el momento, no antes.

- **Varias réplicas de un productor.** La doble entrega está cubierta; el orden por clave
  no, si se usa `FOR UPDATE SKIP LOCKED` (`docs/adr/0012`).
- **Clave por servicio.** Todos comparten `SERVICIO_JWT_SECRET`. Claves asimétricas por
  emisor o identidad administrada de Azure (`docs/adr/0009`).
- **Usuario de base por servicio.** En Azure, como en Compose, los cinco servicios entran
  con el mismo usuario administrador: la regla 3 la sostiene el código, no la base. Un rol
  por servicio con permisos sólo sobre su esquema (`docs/adr/0022`).
- **Límite holgado para el resto de la API.** Aplazado: el estricto de las rutas de
  autenticación está hecho (`docs/adr/0020`); si hace falta frenar abuso en lo demás,
  cada servicio se limita a sí mismo.
- **Sesión que sobreviva a la recarga.** Hoy F5 devuelve al login, a conciencia. La única
  salida que no rompe la Capa 1 es un *refresh token* en cookie `HttpOnly` y `SameSite`
  emitido por el gateway, con su rotación y su revocación; guardar el de acceso en el
  navegador no es opción. Sólo si estorba en la sustentación.
- **Autoservicio de pago del inquilino** (`docs/adr/0006`): reporte + confirmación, o
  pasarela. La regla iría en el ABAC de ms-financiero.
- **Devoluciones:** `EGRESO` en `TIPOS_TRANSACCION` y en el `CHECK`. No es anular.
- **Usuario sin correo**: no recibe nada y sólo queda en el log; resolverlo es pantalla.
- **Reencolar un envío apartado** o atascado en `enviando` exige un `UPDATE` a mano.

## Trampas conocidas

- **En desarrollo el correo no sale de la máquina**: sin `EMAIL_USER` va al log de
  ms-notificaciones, único sitio donde leer el enlace de recuperación.
- **La contraseña temporal se entrega en mano** (`docs/adr/0007`): el correo sólo avisa.
- **Recargar la página cierra la sesión y devuelve al login.** No es un fallo del
  despliegue: el token vive en memoria (Capa 1, `apps/web/src/auth/sesion.js`). Lo que el
  corte 5 arregló es otra cosa —que la recarga diera 404 en Static Web Apps—, y ya no pasa.
- **CRA** ya no recibe mantenimiento: migrar a Vite es barato, no urgente.

## Qué no hacer

- No reescribas módulos que funcionan solo para modernizarlos.
- No agregues dependencias sin necesidad clara: pesan en la imagen y en Container Apps.
- No introduzcas service mesh, Kubernetes ni service discovery.
- No guardes el token en `localStorage`, `sessionStorage` ni cookies, ni lo aceptes por
  query string.
- No crees tablas **de dominio** fuera de las canónicas sin actualizar el documento
  primero. La regla es del modelo de negocio: las tablas operativas internas de un
  servicio —salida, procesados, envíos, `limites_tasa`— no lo amplían y no se tramitan.
  Una tabla nueva sí se tramita cuando llega con un flujo de negocio nuevo, como
  `tokens_recuperacion` con la recuperación de contraseña.
- No cambies el SRS ni el PMP por tu cuenta: los cambios van por PMP §13.3.2.
- No borres pruebas para que el build pase.

## Documentos de referencia

En OneDrive, fuera del repo: Documento Principal, Anteproyecto, PMP, SRS, Anexo de Diseño
y Especificación de Microservicios, Matriz de Evaluación Tecnológica, Mockups UI/UX.
Cuando una decisión técnica se aparte de ellos, escribe un ADR: eso sustenta la defensa.
