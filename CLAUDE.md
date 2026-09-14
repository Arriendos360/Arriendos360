# Arriendos360

Plataforma web de gestión de arrendamientos para propietarios pequeños y medianos en
Bogotá D.C. Proyecto de grado, Especialización en Ingeniería de Software (UDFJDC).
Equipo de 2 personas con dedicación parcial, timebox de 16 semanas, presupuesto en
efectivo de $0 sobre créditos de Azure for Students.

Ese contexto es criterio de decisión, no adorno. Entre la solución elegante y la que
cabe en el cronograma y en los créditos, gana la segunda. Prefiere siempre el cambio
incremental que deja el sistema funcionando sobre la refactorización grande que lo deja
roto una semana.

## Jerarquía de autoridad

Cuando algo entre en conflicto, este es el orden:

1. **Documento Principal — Protocolo de desarrollo** (Capítulo 2: Persistencia,
   Arquitectura de microservicios, Módulo de seguridad, Interfaz gráfica). Es la
   especificación vigente.
2. SRS y PMP, para requisitos funcionales y proceso.
3. El código existente.

El código actual **no** cumple el Capítulo 2. Donde discrepen, manda el documento. Este
archivo traduce el documento a reglas operativas; si detectas una contradicción entre
este archivo y el documento, gana el documento y avísame.

Los ejemplos de payload del documento son ilustrativos: **lo vinculante son los campos y
sus nombres**, no los valores de muestra.

---

## Estado actual

**Pasos 1 a 7 completados. Los CINCO servicios del catálogo están extraídos** y no
queda ninguno por crear: el paso 8 es despliegue.

El gateway dejó de ser un monolito en el 6e —no le queda ninguna tabla, ni modelos, ni
conexión a PostgreSQL— y las ocho tablas de dominio del Capítulo 2 están repartidas
entre los cuatro microservicios de dominio. El paso 7 añade el quinto, que no tiene
ninguna: **ningún servicio de dominio sabe ya que existe SMTP**, y los dos mailers que
vivían en Identidad y en Financiero se borraron. El correo tiene un solo sitio.

- `apps/gateway/` — el antiguo `backend/`. Express en JavaScript (CommonJS), y desde
  el paso 6e **sin Sequelize, sin modelos y sin base de datos**. Le quedan cuatro
  cosas, que son exactamente las que el Capítulo 2 le asigna: la validación del JWT
  y la **matriz RBAC**, los **guardias** (reglas que dependen de dos contextos), la
  **costura de enrutamiento** —cada prefijo se resuelve local o remoto según haya o
  no valor en su variable `MS_*_URL`; hoy los cinco de la API son remotos— y el
  **dashboard**. Arranca sin base: si PostgreSQL está caído, el gateway sigue en pie
  devolviendo 502 de quien no responde.
- `apps/web/` — el antiguo `frontend/`. React 18 con CRA. **Sin Tailwind**, aunque el
  PMP lo declara.
- `packages/contracts/` — DTOs en TypeScript de los endpoints documentados. Casi
  todo son tipos, salvo los **catálogos cerrados** de `inmuebles.ts` (`tipo`,
  `estado`), que emiten JavaScript porque los comparten el servicio, el frontend
  y el `CHECK` de la migración. **ms-notificaciones no lo consume**: no tiene API
  pública, así que no comparte ningún DTO con el frontend.
- `packages/shared/` — verificación local del JWT y de revocados, autenticación
  entre servicios, caché de invalidación, error estándar, cliente HTTP, **el bus
  de eventos completo** —tipos (`eventos.ts`), tabla de salida y publicador
  (`salida.ts`), transporte (`entrega.ts`) y consumidor idempotente
  (`entrada.ts`)— y, desde el paso 6d, **el calendario del arrendamiento**
  (`fechas.ts`): la regla del día 31 y la regla del periodo. Subió aquí porque la
  comparten ms-contratos, que deriva las dos fechas del ciclo de facturación, y
  Financiero, que construye el periodo de cada cuenta de cobro; duplicarla habría
  sido tener dos calendarios que nada sincroniza.
- `database/` — migraciones SQL versionadas, una carpeta por esquema
  (`identidad/`, `inmuebles/`, `contratos/`, `financiero/`, `notificaciones/`).
  Reemplazan a `sequelize.sync()`; ver `docs/adr/0003`. **`dominio/` ya no existe**:
  se vació con el paso 6e y se fue con el aplicador de migraciones del gateway.
- `services/ms-identidad/` — primer microservicio real y **ya en producción de la
  demo**. TypeScript `strict`, puerto 3011, esquema PostgreSQL propio (`identidad`).
  Sirve `/api/auth` y `/api/usuarios`; el gateway se los reenvía por la costura.
- `services/ms-inmuebles/` — segundo servicio. TypeScript `strict`, puerto 3012,
  esquema propio (`inmuebles`). Sirve `/api/inmuebles`; el gateway se lo reenvía
  por la costura. El gateway ya no tiene tabla ni modelo de inmuebles: lo que
  necesita —qué inmuebles son de un propietario, los datos de uno concreto— lo
  pide por HTTP a `/interno/inmuebles` y lo compone
  (`apps/gateway/src/clientes/inmuebles.js`). Y **ya no le ordena nada**: el
  estado de ocupación lo deduce el propio servicio de los eventos que consume por
  `/interno/eventos` (`services/ms-inmuebles/src/eventos/`).
- `services/ms-contratos/` — tercer servicio, y el primero **Core**. TypeScript
  `strict`, puerto 3013, esquema propio (`contratos`) con `Contratos`, `Anexos` y
  su tabla de salida. Sirve `/api/contratos` —incluidos los anexos y la reemisión
  de la contraseña temporal— y **es el productor del bus**: emite
  `ContratoFormalizado` y `ContratoFinalizado` en la misma transacción que
  escribe el contrato.
- `services/ms-financiero/` — cuarto servicio, y el segundo **Core**. TypeScript
  `strict`, puerto 3014, esquema propio (`financiero`) con `Cuentas_cobro`,
  `Transacciones` y su bitácora de eventos procesados. Sirve `/api/pagos` —incluidos
  los dos comprobantes en PDF y la anulación— y se lleva el **motor** completo
  (`procesarContratos`, `procesarPagos`, `npm run motor`). Es el **segundo consumidor
  del bus** —crea la primera cuenta de cobro al recibir `ContratoFormalizado`— y desde
  el paso 7 también **productor**, con su propia tabla de salida: es el primer servicio
  del sistema que hace las dos cosas, y las dos mitades caben en la misma transacción.
  Con él, el gateway se quedó sin tablas.
- `services/ms-notificaciones/` — quinto y último servicio, subdominio **Genérico**.
  TypeScript `strict`, puerto 3015, esquema propio (`notificaciones`) con **ninguna
  tabla de dominio**: sólo su bitácora de eventos procesados y la de envíos.
  **No tiene API pública** —no aparece en la costura ni en la matriz RBAC— y su única
  entrada es `POST /interno/eventos`. Es el **único sitio del sistema que habla SMTP**,
  y se llevó las cinco plantillas de correo que estaban incrustadas en el código de
  otros dos servicios. Ver `docs/adr/0019`.
- `docs/erd/schema-legacy.sql` — modelo viejo, histórico. **No usar como referencia.**

**El gateway no tiene NINGUNA tabla.** Todo lo que necesita lo pide por HTTP y lo
compone (`apps/gateway/src/clientes/`, cuatro clientes: identidad, inmuebles,
contratos y financiero). La revocación la resuelve una copia en memoria que refresca
cada 15 s; ver `docs/adr/0008`.

**El gateway ya NO es el productor del bus.** Lo fue mientras `contratos` era suya; en
el paso 6d la tabla de salida y el publicador se mudaron a `ms-contratos`, que es quien
escribe el contrato. `public.eventos_salida` se retiró con la migración que retiraba los
contratos, y con ella el último cambio de dominio que el gateway anunciaba.

**Y desde el paso 7 hay TRES productores**: `ms-contratos`, `ms-identidad` y
`ms-financiero`, cada uno con su tabla de salida en su esquema. Las dos últimas no
trajeron ni una línea de mecanismo nuevo —el bus vive en `packages/shared` y se hereda
con dos llamadas a función— que es el argumento a favor de haberlo puesto allí en el
paso 5, cobrado.

**Sólo una de las tres guarda un secreto, y por poco tiempo.** El sobre de
`RecuperacionSolicitada` lleva el token de restablecimiento EN CLARO, porque el consumidor
construye con él el enlace del correo — mientras `identidad.tokens_recuperacion` guarda
sólo su SHA-256 precisamente para que leer esa tabla no permita restablecer la contraseña
de nadie. Se acota borrando el `payload` **en la misma sentencia** que marca la fila como
entregada (`tiposRedactados` en `packages/shared/src/salida.ts`): si fueran dos
operaciones, una caída entre ellas dejaría el token legible indefinidamente. Ver
`docs/adr/0019`.

**La política de fallo no es la misma en los dos casos, y la distinción importa.**
Componer datos para *decorar* una respuesta degrada: si el servicio no contesta, la
propiedad queda en `null` y el listado sale sin el nombre del inquilino o sin la
dirección. Pedir datos para *autorizar* propaga el fallo y responde `502`: una lista
vacía de «inmuebles de este propietario» haría que su dueño viera «no tienes
contratos» —una respuesta creíble y falsa— y reduciría la disyunción de visibilidad a
«eres el inquilino». Ver la cabecera de `apps/gateway/src/clientes/inmuebles.js`.

**`clientes/financiero.js` es la excepción: no degrada nunca.** Y no porque autorice
—no lo hace— sino porque su único consumidor es el dashboard, y ahí degradar es MENTIR:
un «$0 de ingresos, 0 en mora» no es un hueco visible como una dirección que falta en un
listado, es una cifra que parece una respuesta. Un 502 le dice al propietario que vuelva
luego; un cero le dice que nadie le debe nada.

**La pertenencia de un contrato se resuelve en ms-contratos desde el paso 6d**, y esto
hay que saberlo antes de tocar cualquier autorización. «¿Este contrato es de este
propietario?» necesita dos contextos —el contrato está aquí, el dueño del inmueble en
ms-inmuebles— y hasta ahora se contestaba CUATRO veces en el gateway, con cuatro formas
distintas. Ahora se contesta una, en `services/pertenencia.ts` de ms-contratos, y se
expone por `GET /interno/contratos`. Desde el paso 6e sus dos clientes son
**ms-financiero**, que filtra con ella sus cuentas de cobro y sus transacciones, y el
gateway, que veta borrados y compone el dashboard — ninguno de los dos necesita saber
nada de inmuebles.

Ese endpoint acepta además `?incluir=inmueble`, que adjunta el `Inmueble` de cada
contrato en un solo lote. Lo usa ms-financiero para los comprobantes y para el motor, y
existe para no encadenar dos saltos de red desde allí: hasta que Contratos no dice de
qué inmueble es cada contrato, nadie sabe qué inmuebles pedir.

**No se denormalizó `id_propietario` en `Contratos`**, aunque la cabecera del viejo
`anexo.controller.js` lo recomendara: un inmueble puede cambiar de dueño, y de ese dato
depende toda la autorización. Una copia vieja le daría acceso al propietario anterior y
se lo negaría al nuevo, sin que nada lo delatara. Ver `docs/adr/0017`, y la prueba que lo
sostiene en `services/ms-contratos/tests/pertenencia.test.ts`.

Lo que el paso 3a ya dejó hecho: `Usuarios` + `Roles` + `RolesUsuario` (adiós a
`propietarios` e `inquilinos`), UUID en todas las claves, columnas de auditoría,
claims nuevos (`sub`/`email`/`roles`/`jti`), `logout` con `TokensRevocados`, token en
memoria en la SPA y descargas por blob. Después llegaron el build en contexto raíz, la
matriz RBAC, la extracción de los dos servicios y el bus. Y después el paso 6 entero
—separar `Pago`/`Abono` en `Cuentas_cobro`/`Transacciones`, y extraer Contratos y
Financiero— y el paso 7, que saca Notificaciones. **No falta ningún servicio: falta el
despliegue.**

**Contratos habla el idioma del Capítulo 2** desde el paso 6a, y vive en su servicio
desde el 6d: `inicio`, `fin`, `canon`, y `estado` como catálogo cerrado
—`activo`, `finalizado`, `cancelado`— en vez del entero sin significado que había.
Tiene además `fecha_inicio_corte`, `fecha_limite_pago`, `info_contrato` y los dos
campos del deudor solidario, que son opcionales. Se fueron `deposito` e
`inventario_fotografico`, que no están en el modelo canónico y nadie escribía.
Y desde el paso 6b tiene sus **`Anexos`**, la octava tabla: un archivo por fila, con
tipo y auditoría, en vez del `url_pdf` suelto que había. Los archivos ya no viven en
el disco del contenedor sino detrás de una interfaz de almacenamiento —disco en
desarrollo, Azure Blob en despliegue— y **sólo salen por la API autenticada**. Con eso
el modelo canónico de Contratos queda completo. Ver `docs/adr/0014`.

**Y Financiero habla el idioma del Capítulo 2 desde el paso 6c**, y desde el 6e vive en
su propio servicio. `Pago` y `Abono` no se renombraron: se **partieron** en los dos
conceptos que mezclaban. `Cuentas_cobro` es la factura —`valor`, el periodo explícito
`inicio`/`fin`, `detalle`, y `estado` como catálogo cerrado (`PENDIENTE`, `PAGADA`,
`PARCIAL`, `EN_MORA`) en vez de los enteros 1, 2, 4 y 3—; `Transacciones` es el
movimiento de dinero contra ella, con `tipo`, `medio_pago` y un `estado` que permite
anular sin borrar. Tres cosas de ahí conviene tenerlas presentes antes de tocar nada:

- **`saldo_pendiente` ya no es una columna.** Se deriva de `valor` menos la suma de las
  transacciones CONFIRMADAS (`services/ms-financiero/src/services/saldos.ts`) y se
  adjunta a la respuesta con ese mismo nombre, así que el frontend recibe lo de siempre. La
  consecuencia buena es que anular una transacción no tiene que «devolver» nada: la suma
  deja de contarla y el saldo se corrige solo.
- **`saldo_restante_momento` de las transacciones NO se deriva y no se toca.** Es la foto
  del saldo en el instante en que se emitió ese comprobante, y ese comprobante ya está
  impreso en casa de alguien. Es la única cifra de saldo que se guarda.
- **`tipo_transaccion` no se convirtió en `tipo`.** Guardaba "Transferencia Bancaria" y
  "Efectivo", que son MEDIOS de pago; su destino es `medio_pago`. Mapearlo por el
  parecido del nombre habría puesto el dato en el campo equivocado y sólo se habría
  notado al imprimir un comprobante.

`PUT /api/pagos/:id/pagar` desapareció: registrar un pago es `POST /api/pagos` con el
cuerpo del Capítulo 2, y el alta manual de un cobro se movió a
`POST /api/pagos/cuentas-cobro`. Ver `docs/adr/0015` y `docs/adr/0016`.

Desviaciones de la línea base acumuladas, todas con ADR y **todas pendientes de
incorporar al Capítulo 2** por el proceso de la sección 13.3.2 del PMP:

| ADR | Desviación |
|---|---|
| `0004` | Alta de inquilinos por `POST /api/usuarios/inquilinos`, que el documento no contempla. |
| `0005` | El filtro de pertenencia de Inmuebles se aplica siempre. Cambio de comportamiento observable. |
| `0006` | Registrar un abono es exclusivo del propietario; el documento no marca ese componente como tal. |
| `0007` | Contraseña temporal para altas por terceros, con una columna nueva en `Usuarios`. |
| `0008` | Caché de revocados en el gateway, con ventana de 15 s. Resuelve una decisión abierta; no se aparta del documento. |
| `0009` | Autenticación entre servicios para `/interno`. Resuelve una decisión abierta; el documento no la contempla pero tampoco la contradice. |
| `0010` | Recuperación de contraseña: endpoints, tabla de tokens y columna `contrasena_cambiada_en`. El envío de correo desde `ms-identidad` ~~debe desaparecer en el paso 7~~ **desapareció en el paso 7: esa parte queda SALDADA**, no se documenta. El resto sigue pendiente de incorporar. |
| `0011` | ~~El estado del inmueble deja de moverse dentro de la transacción del contrato.~~ **Reemplazada por `0012` en el paso 5.** La garantía que registraba como perdida está saldada; no hay nada que tramitar. |
| `0012` | Bus de eventos sobre PostgreSQL con patrón outbox, en vez de Dapr. Resuelve una decisión abierta y **no se aparta del documento**, que ordena el mecanismo pero no la tecnología. Lo que sí conviene incorporar es la **garantía de entrega**: al-menos-una-vez con descarte de repetidos. |
| `0013` | El evento `ContratoFinalizado`, que el documento no contempla. **Esta sí es desviación**: añade una pieza al diseño de comunicación entre servicios. |
| `0014` | Almacenamiento de anexos detrás de una interfaz, con Azure Blob en despliegue, y servidos por la API en vez de con URL firmada. Resuelve una decisión abierta; **no se aparta del documento**, que no fija proveedor ni forma de servir el archivo. |
| `0015` | `Transacciones` conserva `observaciones`, que el modelo canónico no lista. **Es desviación por adición**: la imprime el comprobante en «Referencia trans.». |
| `0016` | Anulación de transacciones: endpoint, estado `ANULADA` y 409 al repetir. **Es desviación**: el documento no contempla ni el endpoint ni el estado. |
| `0017` | La pertenencia de un contrato se resuelve preguntando a ms-inmuebles, sin denormalizar. Resuelve una decisión abierta y **no se aparta del documento**; corrige además el emplazamiento que el `0010` daba a la reemisión de la contraseña temporal, que se muda a ms-contratos. |
| `0018` | Extracción de ms-financiero: la primera cuenta de cobro nace del evento, la mudanza copia y retira en una sola migración, `pdfService.js` se muda intacto con `allowJs`, y `verificar-mora` se unifica con el motor. **No se aparta del documento**: implementa la creación en cadena que el Capítulo 2 especifica y deja al gateway sin tablas, como ahí se describe. El mailer del motor que dejaba pendiente **quedó SALDADO en el paso 7**. Lo que sigue abierto —y **bloqueante para producción**— es el cron dentro del contenedor. |
| `0019` | Extracción de ms-notificaciones: cinco eventos que no llevan direcciones de correo, la bitácora de envíos como outbox de correos, el token de recuperación redactado al entregarlo y el mensaje de `/recuperar` en futuro. **No se aparta del documento**: crea el quinto servicio del catálogo y salda las desviaciones de correo del `0010` y del `0018`. **Sí es desviación por adición** una cosa: el alta manual de un cobro (`POST /api/pagos/cuentas-cobro`) pasa a notificar al inquilino, que antes no lo hacía. |

La costura del gateway está en JavaScript por decisión documentada en
`docs/adr/0002`: meter TypeScript ahí obligaba a montar build, cambiar el Dockerfile y
reconfigurar las 6 suites. Es una excepción acotada a la regla de TypeScript.

**Funciona. No lo rompas.** En cada paso el sistema debe poder levantarse y demostrarse.

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

Dos columnas que el código tiene y esta tabla no, las dos con ADR: `observaciones` en
`Transacciones` (`docs/adr/0015`) y `saldo_restante_momento`, que ya estaba en `abonos` y
sobrevive porque es la foto que imprime un comprobante ya emitido.

**El saldo de una cuenta de cobro NO es una columna.** No está aquí porque no debe estar:
es `valor` menos la suma de sus transacciones confirmadas. Se calcula en
`services/ms-financiero/src/services/saldos.ts` y se expone como `saldo_pendiente`.

**Toda tabla de dominio lleva columnas de auditoría:** `creado_por`, `fecha_creacion`,
`ultima_actualizacion`, `actualizado_por`.

**Todos los identificadores son UUID**, generados en la aplicación con
`crypto.randomUUID()`, no con `DEFAULT` de la base: los servicios necesitan conocer el ID
antes de publicar un evento.

### Mapeo desde el código actual

No es un cambio de nombres, es un cambio de modelo:

| Hoy en el código | Destino |
|---|---|
| `Usuario`, `Propietario`, `Inquilino` (3 tablas) | `Usuarios` + `Roles` + `RolesUsuario` |
| `Inmueble` | `Inmuebles` |
| `Contrato` | `Contratos` |
| — (no existía; era `contratos.url_pdf`) | `Anexos` |
| `Pago` | `Cuentas_cobro` |
| `Abono` | `Transacciones` |

`Cuentas_cobro` y `Transacciones` **no son sinónimos** de `Pago` y `Abono`. Una cuenta de
cobro es la factura mensual que el sistema genera solo; una transacción es el movimiento
de dinero contra esa factura. **Hecho en el paso 6c**, con una migración que transformó
los datos existentes y que antes de borrar `saldo_pendiente` comprobaba fila a fila que
lo guardado cuadrara con lo derivado. Esa migración vivía en `database/dominio/006`; con
el paso 6e la carpeta desapareció, así que en una base nueva las tablas nacen ya en su
forma final desde `database/financiero/001`.

Las tablas `propietarios` e `inquilinos` **desaparecen**. La distinción pasa a ser un rol
en `RolesUsuario`. Un mismo usuario puede ser ambas cosas.

Ojo: hoy `Inmuebles.id_propietario` y `Contratos.id_inquilino` guardan **cédulas**
(`VARCHAR(20)`), no IDs de usuario. Al migrar a UUID pasan a guardar el UUID del usuario.

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

Tabla `TokensRevocados` en el esquema de `ms-identidad`: `jti` (PK), `expira_en`.

**No hay barrido programado.** La consulta de verificación filtra por
`expira_en > NOW()`, así que un registro vencido deja de tener efecto aunque siga en la
tabla. Con tokens de una hora el volumen es despreciable. Si algún día estorba, se limpia
con un `DELETE` manual.

Para que la consulta no pese en cada petición, el gateway mantiene una copia en memoria
de los `jti` vigentes y la refresca periódicamente.

### Capa 1 — Cliente (SPA)

- El token vive **en memoria**, no en `localStorage` ni en cookies.
- Interceptor HTTP que adjunta `Authorization: Bearer <token>` a toda petición saliente.
- Guardianes de ruta que abortan la navegación a módulos no autorizados, incluso por URL
  escrita a mano.
- La barra lateral se renderiza según los claims de rol.
- **Descarga de archivos:** con el token en memoria, `window.open` deja de servir porque
  no manda cabeceras. Los PDF se piden con `fetch` por el mismo interceptor, se reciben
  como blob y se disparan con un enlace temporal. Esto elimina el parámetro `?token=`.

### Capa 2 — Gateway (Policy Enforcement Point)

- Terminación SSL: todo el tráfico externo va por HTTPS.
- Validación de la firma y vigencia del JWT, y consulta a la lista de revocados.
- **Enrutador RBAC:** una matriz de políticas que cruza método HTTP, ruta y rol. Si no
  cuadra, `403` y la petición no llega a la red interna. La matriz es declarativa y vive
  junto a la costura de enrutamiento.

### Capa 3 — Microservicios (dominio)

- Cada servicio **revalida el token por su cuenta** con el middleware de
  `packages/shared`. No confía en que el gateway ya lo hizo.
- **Validación ABAC en los controladores:** no basta el rol. Antes de ejecutar la lógica
  hay que confirmar la pertenencia del recurso — que el inmueble a editar sea del
  `sub` del token, que el contrato consultado sea suyo. Explícito, no implícito en un
  filtro de consulta.

---

## Catálogo de microservicios

| Servicio | Subdominio | Tablas propias | Puerto local |
|---|---|---|---|
| `ms-identidad` | Soporte | Usuarios, Roles, RolesUsuario, TokensRevocados | 3011 |
| `ms-inmuebles` | Soporte | Inmuebles | 3012 |
| `ms-contratos` | Core | Contratos, Anexos | 3013 |
| `ms-financiero` | Core | Cuentas_cobro, Transacciones | 3014 |
| `ms-notificaciones` | Genérico | ninguna de dominio | 3015 |
| `gateway` | — | **ninguna, y ya es literal** | 3001 |
| `web` | — | — | 3000 |

El gateway conserva el puerto 3001 a propósito: el frontend y la colección de Postman
siguen funcionando durante toda la migración.

**Los cinco están extraídos desde el paso 7.** `ms-notificaciones` es el único sin
prefijo en la costura y sin filas en la matriz RBAC, porque no tiene endpoints públicos:
sólo `POST /interno/eventos`. «Ninguna de dominio» es literal —no es dueño de ningún
concepto del negocio— pero sí tiene dos tablas operativas en su esquema, de la misma
familia que `TokensRevocados` o que las tablas de salida: la bitácora de eventos
procesados, sin la cual mandaría un correo dos veces, y la de envíos, que es un outbox
de correos. Ver `docs/adr/0019`.

---

## Estructura del repositorio

```
Arriendos360/
├─ apps/
│  ├─ web/                     React SPA
│  └─ gateway/                 PEP: SSL, validación JWT, matriz RBAC, guardias,
│  │                           enrutamiento y dashboard. SIN base de datos.
├─ services/
│  ├─ ms-identidad/  ms-inmuebles/  ms-contratos/
│  ├─ ms-financiero/  ms-notificaciones/
├─ packages/
│  ├─ contracts/               DTOs compartidos en TypeScript
│  └─ shared/                  JWT, errores, cliente HTTP, el bus de eventos
│                              (tipos, tabla de salida, publicador, consumidor)
│                              y el calendario: regla del dia 31 y del periodo
├─ database/                   Migraciones y seeds, una carpeta por esquema:
│                              identidad, inmuebles, contratos, financiero,
│                              notificaciones
├─ infra/                      Dockerfiles, docker-compose, Bicep de Azure
├─ docs/                       ADRs, ERD, colección Postman
└─ .github/workflows/
```

Monorepo con **npm workspaces**. Cada servicio tiene su `package.json`, `Dockerfile`,
`tsconfig.json` y `tests/`.

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

---

## Comunicación entre servicios

**Síncrono (REST/JSON)** para consultas y comandos del usuario.

**Asíncrono (bus de eventos)** para la creación en cadena:

- `MS-Contratos` guarda el contrato y emite `ContratoFormalizado`.
- `MS-Financiero` consume el evento, extrae `id_contrato`, `canon` y
  `fecha_inicio_corte`, e inserta la primera `Cuenta_cobro`.

Coreografía, no orquestación: Contratos no llama a Financiero ni sabe que existe.

**Y para avisar a las personas, desde el paso 7.** Es el segundo uso del bus y el que
justifica que exista un subdominio Genérico: ms-identidad y ms-financiero anuncian hechos
de su dominio, y `ms-notificaciones` decide a quién avisar y por qué canal. Ninguno de los
dos sabe que existe SMTP, y ninguno de los dos llama a Notificaciones — lo entrega el
publicador, que es transporte y no orquestación (ver la cabecera de `entrega.ts`).

**Esto está implementado desde el paso 6e**, y con ello el bus deja de tener un solo
consumidor y un solo efecto. La consecuencia que hay que tener presente antes de tocar
el motor: **`procesarContratos()` ya NO genera la primera cuenta de cobro**. La primera
es del evento; el barrido se queda con los meses siguientes y **salta el primer periodo
siempre, exista la cuenta o no**. Saltarlo sólo cuando ya existe dejaría que el barrido
de medianoche se colara en la ventana de entrega del evento y facturara dos veces. Ver
`docs/adr/0018`.

### El bus, en concreto

**PostgreSQL con patrón outbox. Sin broker.** Ver `docs/adr/0012`. El mecanismo entero
vive en `packages/shared` y ningún servicio lo reimplementa:

- **El productor escribe el evento en la misma transacción que el cambio de dominio**,
  en SU tabla de salida, en SU esquema. Hoy es `contratos.eventos_salida`, en
  ms-contratos. Nunca una tabla compartida: sería un punto de
  acoplamiento y rompería lo único que hace que esto funcione, que es que las dos
  escrituras quepan en una transacción.
- **Un publicador aparte** barre la tabla cada 5 s, entrega por `POST /interno/eventos`
  con credencial de servicio y marca lo entregado. Si la entrega falla, reintenta con
  espera creciente; el evento no se pierde porque ya está en disco.
- **Entrega al-menos-una-vez.** Cada consumidor lleva su tabla `eventos_procesados` y
  descarta repetidos por `id_evento`, anotándolo en la misma transacción en que aplica el
  efecto. **No se intenta exactamente-una-vez**: exigiría un coordinador distribuido.
- **Un evento que falla siempre no bloquea la cola ni se reintenta sin fin.** Sólo frena
  a los que comparten su `clave_orden` (el `id_inmueble`), y tras 10 intentos —unos 13
  minutos— pasa a `apartado`: deja de intentarse, deja de bloquear y queda a la vista.
  Se aparta, no se borra.

**El sobre lleva cinco campos**: `id_evento`, `tipo`, `version`, `ocurrido_en` y
`payload`. La versión va desde el primer evento. **No lleva actor**, y eso tiene una
consecuencia visible: lo que un consumidor escribe al reaccionar se audita como del
sistema, no de la persona que provocó el hecho. Quién lo provocó queda registrado en el
agregado del emisor, que es donde corresponde. **El rastro no se pierde, cambia de forma:**
`docs/adr/0011` tiene la cadena de tres eslabones y la consulta que la recorre.

### Eventos definidos

| Evento | Emisor | Carga | Consumidores |
|---|---|---|---|
| `ContratoFormalizado` **v2** | `ms-contratos` | `id_contrato`, `id_inmueble`, `canon`, `fecha_inicio_corte`, `id_inquilino` | **DOS:** `ms-inmuebles` → `arrendado`, y `ms-financiero` → primera cuenta de cobro. |
| `ContratoFinalizado` | ídem | `id_contrato`, `id_inmueble` | `ms-inmuebles` → `disponible`. Ver `docs/adr/0013`. |
| `RecuperacionSolicitada` | `ms-identidad` | `id_usuario`, `token`, `expira_en` | `ms-notificaciones` → correo con el enlace. |
| `ContrasenaTemporalEmitida` | ídem | `id_usuario`, `motivo` (`ALTA`\|`REEMISION`) | `ms-notificaciones` → aviso de que la cuenta existe. **No lleva la contraseña.** |
| `CuentaCobroGenerada` | `ms-financiero` | `id_cuenta_cobro`, `id_contrato`, `id_inquilino`, `valor`, `inicio`, `fin` | `ms-notificaciones` → recibo al inquilino. |
| `CuentaCobroPorVencer` | ídem | ídem + `id_propietario`, `entra_en_mora_el`, `direccion_inmueble` | `ms-notificaciones` → aviso al inquilino **y** al propietario. |
| `CuentaCobroEnMora` | ídem | ídem + `dias_de_mora` | `ms-notificaciones` → aviso a los dos. |

**NINGÚN EVENTO LLEVA UNA DIRECCIÓN DE CORREO, y es una regla, no un olvido.** Llevan el
`id_usuario`, y `ms-notificaciones` resuelve el destinatario preguntando a ms-identidad al
manejar el evento, que es el único momento en que la respuesta es actual. Un correo
pertenece a `identidad.usuarios` y a nadie más: copiarlo en un sobre convertiría a cada
emisor en responsable de mantenerlo al día y dejaría copias viejas en dos tablas de salida
que no tienen forma de enterarse de que alguien cambió su correo.

Lo que **sí** viaja es el *asunto* del mensaje —la dirección del inmueble, el valor, el
periodo— porque no son datos de contacto sino el hecho que se anuncia. Mismo criterio que
puso `canon` aquí. Y `id_propietario` viaja como foto del momento: si el inmueble cambia
de dueño en la ventana de entrega, el aviso va al anterior, que es quien lo era cuando
ocurrió. Es distinto de denormalizarlo, que es lo que `docs/adr/0017` prohíbe porque allí
se usa para **autorizar**.

Efecto lateral que no se buscaba: **el motor perdió una petición HTTP por barrido**. Ya no
llama a ms-identidad para nada.

**`ContratoFormalizado` subió a la versión 2 en el paso 7** para llevar `id_inquilino`,
que es lo que necesita el aviso de la primera cuenta de cobro. El campo es **opcional** a
propósito: un sobre versión 1 que estuviera esperando en la tabla de salida durante el
despliegue tiene que seguir creando su cuenta, y el consumidor se limita a no notificar.
Facturar sin avisar es una degradación aceptable; no facturar, no. Es la primera vez que
`VERSION_EVENTO` sirve para algo.

**`ContratoFormalizado` tiene dos consumidores desde el paso 6e**, y eso cambia algo para
el que ya estaba: la fila de la tabla de salida se marca entregada cuando aceptan **los
dos**. Si ms-financiero está caído, el evento se reintenta y ms-inmuebles lo recibe otra
vez. La idempotencia del consumidor deja de ser una precaución teórica y pasa a
ejercitarse de verdad.

**`ContratoFinalizado` NO tiene consumidor en Financiero, y es deliberado.** Finalizar un
contrato no cancela lo que se debe: las cuentas emitidas siguen emitidas y las que están
en mora siguen en mora. Lo único que cambia es que dejan de generarse cuentas nuevas, y
eso ya ocurre solo porque el motor barre los contratos `activo`.

### El sistema es consistente en el tiempo para el estado del inmueble

**Esto hay que saberlo antes de tocar nada que lo mire.** Firmar un contrato ya no deja
el inmueble en `arrendado` dentro de la misma petición: deja el evento anotado, y el
estado converge cuando el publicador lo entrega.

**Ventana esperada: unos 5 segundos** —el intervalo del publicador, configurable con
`EVENTOS_INTERVALO_MS`— más lo que tarde el consumidor. En el peor caso realista, si
`ms-inmuebles` está caído, la ventana es lo que dure la caída más el reintento pendiente.
Pasados los 10 intentos el evento se aparta y entonces **ya no converge solo**: hay que
mirar la tabla de salida y reencolarlo.

No es la ventana del ADR 0011, y la diferencia importa: aquella era una ventana en la que
el aviso **se perdía** y nadie se enteraba; ésta es una en la que el aviso **todavía no ha
llegado**. Consecuencias prácticas:

- Una prueba **no puede afirmar el estado del inmueble justo después de firmar**. Tiene
  que entregar los eventos (`entregarEventos()` en las suites del gateway) o esperar a
  que converja (`esperarA()` en la de integración). Afirmarlo sin más es afirmar algo que
  el diseño no promete.
- La respuesta de `POST /api/contratos` **ya no lleva aviso** de que el estado no se pudo
  actualizar: ese caso dejó de existir.
- En una demostración en vivo, la pantalla de Inmuebles puede tardar un barrido en
  reflejar el contrato recién firmado. Es el comportamiento correcto, no un fallo.

**Generación recurrente:** las cuentas de cobro de meses siguientes las genera
`MS-Financiero` con un proceso programado que barre fechas de corte
(`services/ms-financiero/src/services/motor.ts`). **Ese cron vive dentro del contenedor y
no dispara con scale-to-zero**: ver la decisión abierta marcada como bloqueante, más
abajo.

Los tipos de evento viven en `packages/shared/src/eventos.ts`. **Dapr pub/sub sigue
siendo el camino natural** el día que haya más de un consumidor por evento y el volumen
lo justifique; lo que el ADR 0012 decide es el *cuándo*, no el *nunca*, y el cambio está
acotado a `entrega.ts`. Adoptarlo hoy no habría ahorrado nada: un broker **no elimina el
outbox**, se pone detrás de él.

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
nube**, y guarda la URL devuelta en `archivo_anexo`.

**MS-Financiero** — `POST /api/pagos`
```json
{ "id_cuenta_cobro": "uuid", "monto": 1500000.00, "tipo": "INGRESO",
  "medio_pago": "TRANSFERENCIA", "fecha_pago": "YYYY-MM-DDTHH:mm:ssZ" }
```

---

## Migración: en qué orden

El monolito y los microservicios convivieron mientras duró la migración: el gateway
resolvía local lo no extraído y remoto lo ya extraído. **Desde el paso 6e no queda nada
local**: los cinco prefijos de la API son remotos y la costura no tiene a dónde caer. La
tabla de enrutamiento se conserva igual, porque es la que documenta a qué servicio va
cada prefijo y la que imprime el listado de arranque.

1. ~~**Estructura.** Monorepo con npm workspaces.~~ **Hecho.**
2. ~~**Gateway.** Costura de enrutamiento y paquetes compartidos.~~ **Hecho.**
3. **Identidad y seguridad.** Se parte en tres PRs:
   - ~~**3a.** Rehacer el modelo de identidad dentro del gateway.~~ **Hecho.**
   - ~~**Contexto de build.** Mover el build de Docker al contexto raíz.~~ **Hecho.**
     Los Dockerfiles construyen desde la raíz con `npm ci --workspace=...`, `database/`
     entra por `COPY` y el gateway consume `packages/shared`.
   - ~~**Matriz RBAC.** Políticas declarativas en el gateway, denegar por defecto.~~
     **Hecho.** Se adelantó a la extracción: no depende de ella y vale igual cuando
     `/api/auth` pase a remoto.
   - ~~**3b.** Extraer físicamente `ms-identidad`.~~ **Hecho.** Se llevó
     `database/identidad/`, el gateway pasó a componer por HTTP y a cachear los
     revocados, y las pruebas se reestructuraron sobre dobles.
   - ~~**3c.** Contraseña temporal del inquilino.~~ **Hecho.** Ver `docs/adr/0007`.
4. **`ms-inmuebles`.** Se parte en dos PRs, cada uno verde:
   - ~~**4a.** Crear el servicio.~~ **Hecho.** `services/ms-inmuebles/` con su
     esquema, sus migraciones en `database/inmuebles/`, el catálogo cerrado de
     `tipo` en `packages/contracts`, el `/interno` de estado y sus pruebas. Es
     **puramente aditivo**: el gateway no lo consume todavía, así que durante
     este PR conviven dos tablas de inmuebles y la del servicio está vacía.
   - ~~**4b.** Voltear el gateway.~~ **Hecho.** `MS_INMUEBLES_URL` activa, modelo
     y controlador borrados, y los **29 sitios** que alcanzaban `inmuebles` por
     asociación de Sequelize reescritos como composición. Eso adelantó la mitad
     del trabajo que este archivo programaba para el paso 6: no había forma de
     extraer el servicio y dejar los JOIN en pie. La tabla se movió de esquema
     con `database/inmuebles/002` (copia) y `database/dominio/002` (retirada), en
     ese orden y con Compose garantizándolo.
5. ~~**Bus de eventos.** Infraestructura de mensajería y tipos en `packages/shared`.~~
   **Hecho.** PostgreSQL con patrón outbox, sin broker (`docs/adr/0012`). El productor
   es el gateway mientras `contratos` sea suya. `ContratoFormalizado` y
   `ContratoFinalizado` (`docs/adr/0013`) reemplazaron la llamada síncrona del paso 4:
   el `/interno` que la servía se retiró y el ADR 0011 quedó saldado.
6. **`ms-contratos`** y **`ms-financiero`.** El trabajo duro. Se parte igual que el 4:
   - ~~**6a.** Realinear Contratos con el modelo canónico, sin extraer nada.~~
     **Hecho.** Renombres, `estado` como catálogo, las columnas que faltaban y las
     dos muertas fuera, todo con una migración que TRANSFORMA los datos existentes.
     El evento `ContratoFormalizado` dejó de traducir nombres postizos.
   - ~~**6b.** Tabla `Anexos` y almacenamiento fuera del disco local.~~ **Hecho.**
     Interfaz con dos implementaciones, subida en dos pasos, descarga en streaming
     por la API autenticada y fuera `express.static('uploads')`. Ver `docs/adr/0014`.
   - ~~**6c.** Separar `Pago`/`Abono` en `Cuentas_cobro`/`Transacciones`, sin
     extraer nada.~~ **Hecho.** Las dos tablas, el saldo derivado, la anulación,
     `POST /api/pagos` con el cuerpo del Capítulo 2 y el motor comparando contra
     el calendario de Bogotá. Todo con una migración que TRANSFORMA los datos y
     que se niega a borrar `saldo_pendiente` si no cuadra con lo derivado.
     **Queda pendiente extraer `ms-financiero`**, que va con el 6d.
   - ~~**6d.** Extraer `ms-contratos` con `Contratos` + `Anexos`, con su tabla de
     salida.~~ **Hecho.** El productor se mudó con lo que produce. El ABAC de los
     anexos se resolvió SIN denormalizar `id_propietario` (`docs/adr/0017`), el
     salto Financiero → Contratos dejó de ser un `include` y pasó a componerse por
     HTTP, y el calendario subió a `packages/shared`.
   - ~~**6e.** Extraer `ms-financiero` con `Cuentas_cobro` + `Transacciones`, y con él
     el motor de mora.~~ **Hecho.** `ContratoFormalizado` ganó su segundo consumidor
     y la primera cuenta de cobro nace del evento, que es el caso que el Capítulo 2
     especifica. El gateway se quedó sin tablas, sin modelos y sin conexión a
     PostgreSQL; `database/dominio/` desapareció; `verificar-mora` y el motor pasaron
     a aplicar la misma regla de mora. Ver `docs/adr/0018`.
   - ~~Y en algún punto de los tres: obtener datos del contrato por API en vez de por
     `include`.~~ **Hecho.** No queda ningún `include` que cruce frontera.
7. ~~**`ms-notificaciones`.** Mailer y recordatorios, con las dos deudas de correo que
   ya tenían dueño.~~ **Hecho.** Cinco eventos, ninguno con direcciones de correo; los
   dos mailers borrados y `Notificador` retirado **con su interfaz**, no sustituyendo la
   implementación —sus tres campos eran precisamente los que un evento no lleva—. El
   motor publica en vez de mandar, así que ms-financiero es ahora el primer servicio que
   consume Y produce, y de paso perdió una petición HTTP por barrido. Y el paso descubrió
   algo que llevaba tiempo oculto: el correo de desarrollo **nunca había funcionado**
   —credenciales inventadas contra Ethereal, y dos mailers que se tragaban el error—; se
   vio en cuanto el mecanismo nuevo dejó de tragárselo. Ver `docs/adr/0019`.
8. **Azure Container Apps.** Bicep, pipeline y terminación SSL. Al final. **Es lo único
   que queda**, y no crea ningún servicio nuevo: los cinco están extraídos. Lo que hay
   que hacer ahí está en «Decisiones abiertas», y lo primero de la lista es el
   **trabajo programado del motor**, que es la única deuda marcada como bloqueante.

---

## TypeScript incremental

- `tsconfig.json` con `"allowJs": true` y `"checkJs": false`.
- **Todo código nuevo en `.ts`**, salvo la excepción de `apps/gateway` (ADR 0002).
- `packages/contracts` y `packages/shared` son 100% TypeScript y emiten CommonJS para
  que el gateway pueda consumirlos.
- Un `.js` se convierte a `.ts` solo cuando ya lo estás modificando por otra razón.
- `strict: true` en paquetes y servicios nuevos.

---

## Convenciones

- **Dominio en español, plataforma en inglés.** `contrato`, `inmueble`, `canon`, `mora`,
  `cuenta_cobro`, `transaccion` en español; `middleware`, `router`, `handler` en inglés.
- **Rutas REST:** `/api/{recurso}` en plural.
- **Errores:** `{ mensaje: "..." }` en el body. 401 sin token o token revocado, 403 rol
  insuficiente o recurso ajeno, 400 validación, 404 no encontrado.
- **Roles en mayúsculas** en claims y respuestas: `PROPIETARIO`, `INQUILINO`.
- **Catálogos ABIERTOS y cerrados no son lo mismo.** `tipo` de Anexos es abierto: el
  Capítulo 2 enumera `CONTRATO_FIRMADO` y `OTROSI` seguidos de «etc.», así que no
  lleva `CHECK` ni `isIn` y los valores conocidos de `packages/contracts` son una
  sugerencia para el desplegable. Un catálogo cerrado que se queda corto obliga a una
  migración; uno abierto que se cierra de más, a una migración y a un enfado.
- **Catálogos cerrados en `packages/contracts`, en minúsculas.** `tipo` y `estado`
  de Inmuebles son listas fijas que comparten el servicio, el frontend y el
  `CHECK` de la migración. Van en minúsculas, a diferencia de los roles: un rol
  viaja en los claims y el Capítulo 2 lo fija en mayúsculas; esto es un atributo
  de negocio. Si agregas un valor, tócalo en los dos sitios — nada los sincroniza.
- **Los catálogos de Financiero son la excepción: van en MAYÚSCULAS.** Los cuatro
  —`ESTADOS_CUENTA_COBRO`, `ESTADOS_TRANSACCION`, `TIPOS_TRANSACCION` y el abierto
  `MedioPago`— porque el Capítulo 2 fija `"tipo": "INGRESO"` y
  `"medio_pago": "TRANSFERENCIA"` en el cuerpo de `POST /api/pagos`, que es un
  contrato de interfaz. Bajar esos dos a minúsculas obligaría a traducir en el
  límite de la API; subir los otros dos deja las cuatro columnas del servicio con
  el mismo aspecto. Dentro de un servicio pesa más la coherencia con sus propias
  columnas que con las de otro.
- **Dinero:** pesos colombianos. `NUMERIC` en PostgreSQL, nunca `float`.
- **Fechas:** guardar en UTC, presentar en `America/Bogota`. **Cerrado en el paso 6c.**
  El 6a arregló la mitad: `fecha_inicio_corte` y `fecha_limite_pago` se derivan en UTC
  (`packages/shared/src/fechas.ts`) y la migración las rellenó con `AT TIME ZONE 'UTC'`.
  El
  6c cerró la otra: el motor de mora ya no compara contra `new Date()` local sino
  contra `hoyEnZonaNegocio()`, que devuelve el día de calendario en `America/Bogota`,
  y `diasEntre()` cuenta días de calendario en vez de intervalos de 24 horas. La zona
  es la del NEGOCIO y no la del servidor: quien decide que un arriendo entró en mora al
  sexto día lo hace en Bogotá, y en un contenedor en UTC el corte se adelantaría cinco
  horas. Tuvo que decidirse aquí porque `inicio` pasó de `TIMESTAMPTZ` a `DATE`, y una
  fecha de calendario no significa nada sin decir en qué zona se lee.
- **Periodo de una cuenta de cobro:** `inicio` es la fecha de corte del mes que se
  factura y `fin` es el día ANTERIOR al siguiente corte. Así definidos, los periodos
  **teselan** el calendario: cada día pertenece a uno y sólo a uno, sin huecos ni
  solapes, sea cual sea el día pactado. «Un mes menos un día» lo rompería en cuanto un
  mes tuviera 28 días y el siguiente 31. La regla está en `periodoDeCorte()`, en
  `packages/shared/src/fechas.ts`, y no se calcula en ningún otro sitio. Subió allí en
  el paso 6d, cuando Contratos y Financiero dejaron de compartir proceso: la usan los
  dos, y desde el 6e también el consumidor del evento que crea la primera cuenta de
  cobro. Duplicarla habría sido tener dos calendarios que nada sincroniza.
- **Días del mes que no existen:** un contrato que vence el 31 no tiene ese día en
  febrero. La regla es **recortar al último día del mes**, y el día pactado se guarda
  sin tocar: el recorte se aplica al resolverlo contra cada mes, no al guardarlo. Ver
  la cabecera de `packages/shared/src/fechas.ts`.

---

## Llamadas entre servicios

**Todo endpoint bajo `/interno` exige credencial de servicio.** Sin excepción, y desde el
primer commit en que existe: no hay un momento en que sea aceptable dejarlo abierto «por
ahora».

Los `/interno` los llama otro servicio, no una persona. No llevan token de usuario, no
pasan por la matriz RBAC y la costura no los reenvía, porque sólo reenvía `/api/*`. Nada
de eso los protege — el puerto está publicado al host en desarrollo, y la regla dura 7
dice que venir de la red interna no hace confiable a nadie.

Se aplica en las dos puntas, con lo que ya trae `packages/shared`:

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

Ningún servicio reimplementa esto. Va con `router.use` y no ruta por ruta a propósito:
así un endpoint nuevo nace protegido. **`POST /interno/eventos`, la entrada del bus, es
justamente uno de esos**: nació protegido sin tocar nada, y sin ella cualquiera con
acceso al puerto podría arrendar inmuebles ajenos inventándose un sobre.

`SERVICIO_JWT_SECRET` **no es** `JWT_SECRET`. Si fueran la misma clave, el token de
cualquier inquilino serviría para llamar a `/interno`. Ver `docs/adr/0009`.

**Y el doble de pruebas también la exige.** Cuando un servicio se extrae y el gateway
gana un doble suyo, ese doble verifica la credencial igual que el real: si no, las suites
pasarían aunque el llamante olvidara mandarla.

## Reglas que no caben en un solo servicio

Algunas reglas dependen de datos de **dos contextos** y ningún servicio puede aplicarlas
solo. «No borres un inmueble con contrato activo» es el caso tipo: la escribe Inmuebles
pero la decide Contratos.

Esas reglas van en `apps/gateway/src/routing/guardias.js`, montadas **después del RBAC y
antes de la costura** — después, porque necesitan saber quién pregunta; antes, porque su
trabajo es decidir si la petición llega a salir a la red interna.

No se resuelven metiéndolas en el servicio que escribe. `ms-inmuebles` es subdominio de
**Soporte** y Contratos es **Core**: consultar contratos desde ahí invertiría la
dirección de las dependencias. Es el mismo razonamiento que puso la reemisión de la
contraseña temporal en el gateway (`docs/adr/0010`).

**El código de estado importa.** Un guardia que rechaza por el estado del recurso
responde `409`, no `403`. El recurso es suyo y su rol es el correcto —las dos capas de
autorización ya dijeron que sí—; lo que falla es que el recurso no está en condiciones.
Un `403` le diría al propietario que no tiene derecho sobre su propio inmueble, que es
falso y además no le dice qué hacer.

## Cómo se prueba

Convención para los pasos 4 al 7, fijada al extraer el primer servicio:

**Cada servicio prueba su lógica contra dobles.** Nada de levantar el stack para una
suite. El gateway no arranca `ms-identidad`: monta un doble HTTP con usuarios en memoria
(`apps/gateway/tests/dobles/`) y apunta `MS_*_URL` a él. Las suites siguen corriendo en
segundos y en un portátil sin Docker.

Un doble, no un mock de función: la costura reenvía por red, así que para probar el
gateway hace falta algo que escuche. Además permite simular lo incómodo — que el otro
extremo no responda, que devuelva un usuario sin el rol esperado.

**Cada servicio prueba contra su propia base.** `ms-identidad` recrea sólo el esquema
`identidad`; el gateway sólo `public`. Comparten instancia sin pisarse.

**Una suite de integración corta, aparte.** `tests/integracion/` recorre los caminos
críticos —entrar, firmar un contrato, registrar un pago— contra el stack real levantado.
Es lo único que comprueba que el contrato entre servicios sea cierto: un doble que se
desvía del servicio real deja las suites en verde y el sistema roto. No duplica casos
borde y **no** forma parte de `npm test`; se lanza con `npm run test:integracion`.

Al extraer un servicio nuevo: se lleva sus pruebas, el gateway gana un doble suyo, y la
suite de integración gana un camino sólo si es crítico para la demostración.

**El paso 7 es la excepción a la primera mitad de esa frase, y conviene saber por qué.**
`ms-notificaciones` no aparece en ningún doble del gateway, porque el gateway no lo llama:
no está en la costura ni en la matriz. Quien gana un doble suyo es **ms-identidad**, que
es quien le entrega eventos. Y el servicio nuevo sólo necesita UN doble —ms-identidad—
porque sólo habla con un servicio y sólo para una cosa: resolver el correo de un
`id_usuario`.

**Y sí gana un camino de integración**, porque cumple el criterio de sobra: la
recuperación de contraseña recorre cuatro servicios, el paso 7 la partió por la mitad, y
el síntoma de que una de las fronteras nuevas esté mal es el peor posible — nadie recibe
el correo y no hay ningún error en ninguna parte.

**Y el doble consume eventos como el servicio real.** El de ms-inmuebles no sólo aplica el
efecto: descarta repetidos por `id_evento`. Si sólo hiciera lo primero, un consumidor sin
idempotencia pasaría las suites en verde y fallaría en producción a la primera reentrega —
que con entrega al-menos-una-vez no es una posibilidad remota, es una certeza.

**Nada de temporizadores en las suites.** El publicador no se arranca: las pruebas llaman
a `ciclo()` a mano (`entregarEventos()` en `tests/utiles/entorno.js`). Es lo que hace que
«todavía no se ha entregado» sea una afirmación comprobable y no una carrera. El publicador
de las pruebas usa el almacén y la entrega reales; sólo quita la espera entre reintentos.

## Comandos

```bash
docker compose -f infra/docker-compose.yml up --build     # levantar todo
docker compose -f infra/docker-compose.yml down -v        # reinicio limpio
npm test --workspace=services/ms-identidad                # pruebas de un servicio
npm test --workspace=services/ms-inmuebles                # idem
npm test --workspace=services/ms-contratos                # idem
npm test --workspace=services/ms-financiero               # idem
npm test --workspace=services/ms-notificaciones          # idem
npm test --workspaces --if-present                        # todas, contra dobles
npm run motor --workspace=services/ms-financiero          # barrido manual del motor
npm run enviar --workspace=services/ms-notificaciones     # barrido manual de los envios
npm run test:integracion                                  # caminos criticos, stack arriba
npm run seed --workspace=services/ms-identidad            # usuarios de prueba
```

Pruebas con `NODE_ENV=test`, apuntando a `arriendos360_test`.

---

## Git Flow

- `main` solo con código funcional y desplegable.
- Una rama por historia: `feature/nombre-modulo`.
- **Todo cambio entra por Pull Request** — el PMP lo exige como control de calidad
  (principio de "cuatro ojos": quien codifica no es quien prueba).
- Nunca commit directo a `main`.
- Mensajes en español, imperativo: `Extrae ms-identidad del monolito`.

---

## Decisiones abiertas

Resuélvelas con un ADR en `docs/adr/` cuando llegue el momento, no antes.

**Todo lo que queda aquí es del paso 8**, que es el único que falta: los cinco servicios
están extraídos y ninguna de estas decisiones exige tocar el reparto de tablas ni el bus.
Las tres del final —clave por servicio, limitación de tasa y el cron del motor— son de
infraestructura; las otras son de producto.

**El cron del motor no dispara con scale-to-zero. 🔴 BLOQUEANTE PARA PRODUCCIÓN.**
`node-cron` programa el barrido diario DENTRO del proceso de ms-financiero. Funciona
mientras el proceso viva, y hoy vive porque Compose mantiene el contenedor en pie; deja
de funcionar en Azure Container Apps, que escala a cero sin tráfico. Un contenedor
dormido a las 00:01 no genera las cuentas de cobro del día ni marca las moras, **y no
hay error, ni log, ni excepción**: simplemente no pasa nada, y nadie se entera hasta que
un inquilino pregunta por su recibo.

La salida es un **trabajo programado de Container Apps** (`Job` con `triggerType:
Schedule`) que levante un contenedor, ejecute `npm run motor` y se apague. El código ya
está listo —`src/scripts/motor.ts` no depende de que la API escuche y sale con código
distinto de cero si falla, que es como un `Job` decide si fue bien—; lo que falta es el
Bicep, y eso es del paso 8.

**Esta no es una decisión abierta más.** Las otras del paso 8 —claves por servicio,
limitación de tasa— degradan la seguridad si no se hacen; ésta rompe una función del
producto. El arranque del servicio lo grita en el log. Ver `docs/adr/0018`.

**Un publicador con varias réplicas de ms-contratos.** Hoy hay una, y dos publicadores
sobre la misma tabla de salida podrían entregar el mismo evento a la vez. Eso ya está
cubierto —la entrega es al-menos-una-vez y los consumidores descartan repetidos, cosa
que desde el paso 6e importa el doble porque uno de ellos INSERTA— pero el **orden por
clave** sí se vería afectado por un bloqueo por fila (`FOR UPDATE SKIP LOCKED`).
Reconsiderar en el paso 8, cuando Container Apps pueda escalar los servicios. Ver
`docs/adr/0012`.

**Frecuencia de refresco de la caché de revocados.** Ventana entre el logout y su efecto
real. Son ya CUATRO cachés —el gateway y los tres servicios que verifican tokens— y las
cuatro con el mismo intervalo de 15 s, así que la ventana observable es la misma en
todas. **Siguen siendo CUATRO después del paso 7**: `ms-notificaciones` no verifica
tokens de usuario porque nunca le llega ninguno, así que no tiene caché ni la necesita.

Cuidado con dejar `REVOCADOS_INTERVALO_MS=` vacía en un `.env`: `Number('')` es `0` y eso
convierte el refresco en un bucle. Los servicios caen al defecto con `||`, no con `??`,
justamente por eso. **El paso 7 demostró que el aviso no era paranoia**: la misma trampa
con `EMAIL_USER=` y `??` mantuvo el correo de desarrollo roto en silencio desde que
existe. Ver «Trampas conocidas».

**Listados de un usuario con doble rol.** La visibilidad se decide con una disyunción:
eres el dueño del inmueble **o** el inquilino del contrato. El criterio es correcto —la
pertenencia manda sobre el rol declarado, y es lo que permite que quien es las dos cosas
no pierda la mitad de sus datos—, pero hasta el paso 6d se resolvía con un `Op.or` sobre
columnas alcanzadas por `include`, es decir, **JOINs que cruzaban bounded contexts**, en
tres sitios del gateway:

| Dónde estaba | Ruta de la condición | Contextos que cruzaba |
|---|---|---|
| `contrato.controller.js` | `$Inmueble.id_propietario$` | Contratos → Inmuebles |
| `pago.controller.js` (cuentas) | `$Contrato.Inmueble.id_propietario$` | Financiero → Contratos → Inmuebles |
| `pago.controller.js` (transacciones) | `$CuentaCobro.Contrato.Inmueble.id_propietario$` | Financiero → Contratos → Inmuebles |

(Los tres archivos ya no existen: se fueron con ms-contratos y ms-financiero.)

**RESUELTA EN EL PASO 6d.** El paso 4 hizo la mitad y el 6d la otra, con una vuelta de
tuerca: en vez de encadenar dos saltos —pedir los inmuebles del propietario y después
los contratos de esos inmuebles— la disyunción entera la resuelve **ms-contratos**, que
tiene la mitad barata (`id_inquilino` es columna suya) y sabe pedir la cara. Quien
pregunta hace UNA llamada, `GET /interno/contratos?parte=<sub>`, y recibe la lista de
identificadores que entra en un `IN` contra su base local.

Un salto de red donde habría habido dos, y la regla escrita una vez en vez de tres. Lo
que quedaba por decidir —si quien pregunta pagina o si Contratos acepta una lista de
IDs— se resolvió solo: la lista viaja en el cuerpo de la respuesta y se usa en un `IN`
de SQL local, así que el problema del tamaño no llegó a plantearse. El día que un
propietario tenga tantos contratos que la lista pese, la salida es paginar en
`/interno`; hoy no.

Desde el paso 6e quien pregunta es **ms-financiero**, no el gateway: la base local
contra la que se hace el `IN` es la suya. El gateway sólo conserva la mitad de
propietario, para el dashboard.

~~**`database/dominio/` es provisional.**~~ **RESUELTA EN EL PASO 6e: la carpeta ya no
existe.** `inmuebles/`, `contratos/` y `financiero/` salieron de ahí, cada una con su
servicio. La última rompió el patrón de «una migración copia, otra retira» y hace las dos
cosas en `database/financiero/002`, porque al irse esas tablas el gateway pierde su
aplicador de migraciones y no queda nadie que pueda aplicar la retirada por separado.
Resulta además más seguro: copia y retirada caen en la misma transacción. Ver
`docs/adr/0003` y `docs/adr/0018`.

**Clave por servicio para las llamadas internas.** Hoy todos comparten
`SERVICIO_JWT_SECRET`, así que comprometer un servicio permite suplantar a los demás. El
arreglo son claves asimétricas por servicio; el verificador ya resuelve la clave por
emisor, así que es cambiar configuración y no rediseñar. Reconsiderar en el paso 8, donde
la identidad administrada de Azure puede hacerlo innecesario. Ver `docs/adr/0009`.

**Limitación de tasa.** No existe en ninguna ruta. `POST /api/auth/recuperar` y
`POST /api/auth/login` son las que más la piden —nada impide mil intentos— pero el
problema es de toda la API, no de un endpoint. Decidir antes del paso 8: en Container
Apps puede resolverse en el ingreso en vez de en código.

**Autoservicio de pago del inquilino.** `docs/adr/0006` deja el registro de pagos en
manos del propietario porque el sistema no puede verificar un pago. Si el producto
quiere autoservicio, hace falta otro diseño: reporte del inquilino + confirmación del
propietario, o pasarela que dispare el asiento. Sigue abierta después del 6e: la
anulación del `docs/adr/0016` da la mitad que faltaba —poder corregir un registro
equivocado sin borrarlo— pero no resuelve quién puede registrarlo. Lo que sí cambia con
la extracción es dónde se decidiría: la regla es del ABAC de ms-financiero, no del
gateway.

**Devoluciones.** `TIPOS_TRANSACCION` está cerrado con un solo valor, `INGRESO`, porque
es lo único que el sistema produce. El día que haya que devolver dinero —un depósito que
se reintegra, un cobro de más— hace falta `EGRESO` aquí y en el `CHECK` de una migración.
No confundirlo con anular: anular corrige un registro que no debió existir; un egreso
registra dinero que de verdad salió. Ver `docs/adr/0016`.

**Comprobantes.** El frontend tiene una pantalla que no aparece entre las cinco del
documento (UI-01 a UI-05). Decidir si se documenta o se absorbe en Pagos.

**Un usuario sin correo no recibe nada, y sólo se ve en el log.** Abierta desde el paso 7.
Cuando ms-identidad devuelve un usuario sin correo, el manejador omite el envío y registra
un aviso alto, pero no hay ningún sitio en el producto donde un propietario vea «a este
inquilino no se le pudo avisar». No se resolvió en el 7 porque resolverlo bien es pantalla,
no mecanismo. Ver `docs/adr/0019`.

**Reencolar un envío apartado exige un `UPDATE` a mano.** `notificaciones.envios` deja a la
vista las filas apartadas y las que quedaron en `enviando` —y el arranque las grita— pero
devolverlas a la cola no tiene endpoint ni script. Es la misma situación que la tabla de
salida del bus tiene desde el paso 5 con `reencolar()`, y se acepta por la misma razón: lo
primero que hacía falta era que el problema se viera. `npm run enviar` sí barre las
pendientes.

**Un solo canal de notificación.** `envios.canal` es un catálogo abierto con un único
valor, `EMAIL`, y la tabla está preparada para más. El día que haya SMS o aviso en la app,
lo que cambia es la plantilla y el transporte, no el mecanismo — ni el reparto de eventos,
que ya viaja con identificadores y no con direcciones.

---

## Trampas conocidas

~~**El correo no llega a nadie.** Con `EMAIL_USER` sin definir, el mailer apunta a un
buzón de pruebas (Ethereal)… Son **dos** mailers desde el paso 6e, y los dos
provisionales.~~ **Cambiado en el paso 7, y lo que había escrito aquí era falso a
medias.**

Hay **un** mailer, en `ms-notificaciones`, y no es provisional: es el sitio que el
Capítulo 2 le asigna al canal. Los dos anteriores se borraron.

Y lo que decía esta trampa —«el enlace se genera y se envía»— **no era cierto**. Los dos
mailers apuntaban a `smtp.ethereal.email` con `test@example.com` / `password`, que no son
credenciales de Ethereal: cada envío fallaba con «Missing credentials for PLAIN» y los dos
se tragaban el error con un `console.error`. En desarrollo **nunca salió un correo, ni
uno**, y el proyecto lo daba por funcionando.

Se descubrió en el paso 7 por la razón exacta que justificaba el cambio: el mecanismo
nuevo **propaga** el fallo en vez de tragárselo, y las filas se quedaron en la bitácora
con su `ultimo_error` a la vista. El fallo no era nuevo; lo nuevo es que se vea.

**Cómo funciona ahora.** Sin `EMAIL_USER` se usa el transporte JSON de nodemailer: el
mensaje se acepta, se registra como `enviado` y **sale entero por el log** —el único sitio
donde se puede leer el enlace de recuperación en desarrollo— pero **no sale de la
máquina**. El arranque lo avisa. Con credenciales de verdad, el transporte es SMTP.

Ojo con `??` al leer estas variables: Compose pasa `EMAIL_USER=` cuando la del host está
vacía, y eso es una **cadena vacía**, no `undefined`. Es la misma trampa que CLAUDE.md ya
anotaba para `REVOCADOS_INTERVALO_MS`, y es la que mantuvo esto oculto.

Lo que **no** cambia es la razón por la que la contraseña temporal del ADR 0007 se entrega
en mano: el sistema no puede garantizar que un correo llegue. El evento
`ContrasenaTemporalEmitida` avisa de que la cuenta existe; no la abre.

~~**`/uploads/` se sirve sin autenticación.**~~ **Resuelto en el paso 6b.** No queda
ninguna ruta que sirva archivos sin pasar por la matriz: los anexos salen sólo por
`GET /api/contratos/:id/anexos/:idAnexo`, con RBAC y ABAC delante. Y **no** se hizo
con URL firmada, que era lo que este archivo anticipaba: una URL firmada es un
permiso que viaja solo y no se puede revocar antes de que caduque, que es el mismo
agujero con mejor presentación. Ver `docs/adr/0014`.

~~**`backend/uploads/` en disco local.**~~ **Resuelto en el paso 6b.** El disco sigue
siendo la implementación de desarrollo, pero detrás de una interfaz: en despliegue se
usa Azure Blob, y la elección la decide una sola variable de entorno.

**Los anexos subidos ANTES del paso 6d viven en el volumen del gateway, no en el de
ms-contratos.** La migración `database/contratos/002` movió las FILAS, no los archivos:
con la implementación de disco quedaron en `apps/gateway/almacenamiento/` y hay que
copiarlos a `services/ms-contratos/almacenamiento/` a mano. Con Azure Blob no hace falta —el
contenedor es el mismo y la referencia guardada sigue valiendo—, y en la base de
desarrollo no había ninguno cuando se hizo la mudanza. Está anotado en la cabecera de
esa migración.

~~**Un contrato de 16 líneas de mora no existe: `verificar-mora` y el motor no aplican la
misma regla.**~~ **Resuelto en el paso 6e**, que es cuando el motor se mudó a Financiero
y las dos reglas quedaron en el mismo servicio. Ahora las dos usan `DIAS_PARA_MORA`, una
constante exportada de `services/motor.ts`, y `PARCIAL` queda fuera en los dos caminos.
Lo que NO se unificó es el alcance —el motor barre el sistema entero y el endpoint sólo
los contratos de quien llama—, y esa diferencia sí tiene que seguir: es la que hay entre
un proceso y una petición.

**Create React App** ya no recibe mantenimiento. Migrar a Vite es barato y acelera el
build en CI, pero no es urgente.

**Tailwind está declarado en el PMP pero no instalado.** Si rehaces estilos, instálalo;
si no, registra el cambio en control de configuración.

---

## Qué no hacer

- No reescribas módulos que funcionan solo para modernizarlos.
- No agregues dependencias sin necesidad clara: cada una pesa en la imagen Docker y en
  los límites de Container Apps.
- No introduzcas service mesh, Kubernetes ni service discovery. El bus de eventos sí
  está en el diseño; lo demás no.
- No guardes el token en `localStorage`, `sessionStorage` ni cookies.
- No aceptes el token por query string.
- No crees tablas fuera de las canónicas sin actualizar el documento primero.
- **No le devuelvas una tabla al gateway.** Se quedó sin base en el paso 6e y eso es lo
  que el Capítulo 2 dice que tiene que ser. Si algo parece necesitar estado ahí, es que
  pertenece a un servicio o que es una agregación que se compone por HTTP.
- No cambies el SRS ni el PMP por tu cuenta. Son línea base; los cambios pasan por el
  proceso formal de la sección 13.3.2 del PMP.
- No borres pruebas para que el build pase.

---

## Documentos de referencia

Viven fuera del repositorio (OneDrive): Documento Principal — Protocolo de desarrollo,
Anteproyecto, PMP, SRS, Anexo de Diseño y Especificación de Microservicios, Matriz de
Evaluación Tecnológica, Mockups UI/UX.

Cuando una decisión técnica se aparte de lo que dicen, escribe un ADR explicando por
qué. Eso es lo que después sustenta la defensa.
