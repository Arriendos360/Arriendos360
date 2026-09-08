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

Pasos 1 a 5 completados, y los 6a, 6b y 6c. El sistema sigue siendo un **monolito
modular funcionando**, ahora dentro de una estructura de monorepo, con el modelo de
identidad del Capítulo 2 implementado, dos microservicios extraídos, el bus de eventos en
pie y **las ocho tablas de dominio del Capítulo 2 completas**: Contratos con sus `Anexos`,
y Financiero ya partido en `Cuentas_cobro` y `Transacciones`.

- `apps/gateway/` — el antiguo `backend/`. Express + Sequelize + PostgreSQL en
  JavaScript (CommonJS). Incluye la costura de enrutamiento (cada prefijo se resuelve
  local o remoto según haya o no valor en su variable `MS_*_URL`; hoy todos locales) y
  la **matriz RBAC**, que se evalúa antes de la costura para que una petición denegada
  no llegue a la red interna.
- `apps/web/` — el antiguo `frontend/`. React 18 con CRA. **Sin Tailwind**, aunque el
  PMP lo declara.
- `packages/contracts/` — DTOs en TypeScript de los endpoints documentados. Casi
  todo son tipos, salvo los **catálogos cerrados** de `inmuebles.ts` (`tipo`,
  `estado`), que emiten JavaScript porque los comparten el servicio, el frontend
  y el `CHECK` de la migración.
- `packages/shared/` — verificación local del JWT y de revocados, autenticación
  entre servicios, caché de invalidación, error estándar, cliente HTTP y **el bus
  de eventos completo**: tipos de evento (`eventos.ts`), tabla de salida y
  publicador (`salida.ts`), transporte (`entrega.ts`) y consumidor idempotente
  (`entrada.ts`). **El gateway ya lo consume**: su middleware de autenticación es
  un adaptador de Express sobre este paquete, no una segunda implementación, y su
  productor de eventos son treinta líneas de cableado sobre `salida.ts`.
- `database/` — migraciones SQL versionadas, una carpeta por esquema
  (`identidad/`, `inmuebles/`, `dominio/`). Reemplazan a `sequelize.sync()`; ver
  `docs/adr/0003`. `dominio/` ya solo guarda contratos, anexos, cuentas de cobro,
  transacciones y la tabla de salida del bus.
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
- `docs/erd/schema-legacy.sql` — modelo viejo, histórico. **No usar como referencia.**

El gateway ya no tiene tablas ni modelos de identidad ni de inmuebles. Lo que
necesita de ellos lo pide por HTTP y lo compone (`apps/gateway/src/clientes/`). La
revocación la resuelve una copia en memoria que refresca cada 15 s; ver
`docs/adr/0008`.

Y es, además, el **productor** del bus mientras `contratos` siga siendo suya: su tabla
de salida es `public.eventos_salida` y su publicador vive en el mismo proceso
(`apps/gateway/src/eventos/`). En el paso 6 los dos se mudan con `ms-contratos`.

**La política de fallo no es la misma en los dos casos, y la distinción importa.**
Componer datos para *decorar* una respuesta degrada: si el servicio no contesta, la
propiedad queda en `null` y el listado sale sin el nombre del inquilino o sin la
dirección. Pedir datos para *autorizar* propaga el fallo y responde `502`: una lista
vacía de «inmuebles de este propietario» haría que su dueño viera «no tienes
contratos» —una respuesta creíble y falsa— y reduciría la disyunción de visibilidad a
«eres el inquilino». Ver la cabecera de `clientes/inmuebles.js`.

Lo que el paso 3a ya dejó hecho: `Usuarios` + `Roles` + `RolesUsuario` (adiós a
`propietarios` e `inquilinos`), UUID en todas las claves, columnas de auditoría,
claims nuevos (`sub`/`email`/`roles`/`jti`), `logout` con `TokensRevocados`, token en
memoria en la SPA y descargas por blob. Después llegaron el build en contexto raíz, la
matriz RBAC, la extracción de los dos servicios y el bus. Falta el paso 6: separar
`Pago`/`Abono` en `Cuentas_cobro`/`Transacciones` y extraer Contratos y Financiero.

**Contratos ya habla el idioma del Capítulo 2** desde el paso 6a, aunque siga
viviendo en el gateway: `inicio`, `fin`, `canon`, y `estado` como catálogo cerrado
—`activo`, `finalizado`, `cancelado`— en vez del entero sin significado que había.
Tiene además `fecha_inicio_corte`, `fecha_limite_pago`, `info_contrato` y los dos
campos del deudor solidario, que son opcionales. Se fueron `deposito` e
`inventario_fotografico`, que no están en el modelo canónico y nadie escribía.
Y desde el paso 6b tiene sus **`Anexos`**, la octava tabla: un archivo por fila, con
tipo y auditoría, en vez del `url_pdf` suelto que había. Los archivos ya no viven en
el disco del contenedor sino detrás de una interfaz de almacenamiento —disco en
desarrollo, Azure Blob en despliegue— y **sólo salen por la API autenticada**. Con eso
el modelo canónico de Contratos queda completo. Ver `docs/adr/0014`.

**Y Financiero habla el idioma del Capítulo 2 desde el paso 6c**, aunque también siga
viviendo en el gateway. `Pago` y `Abono` no se renombraron: se **partieron** en los dos
conceptos que mezclaban. `Cuentas_cobro` es la factura —`valor`, el periodo explícito
`inicio`/`fin`, `detalle`, y `estado` como catálogo cerrado (`PENDIENTE`, `PAGADA`,
`PARCIAL`, `EN_MORA`) en vez de los enteros 1, 2, 4 y 3—; `Transacciones` es el
movimiento de dinero contra ella, con `tipo`, `medio_pago` y un `estado` que permite
anular sin borrar. Tres cosas de ahí conviene tenerlas presentes antes de tocar nada:

- **`saldo_pendiente` ya no es una columna.** Se deriva de `valor` menos la suma de las
  transacciones CONFIRMADAS (`apps/gateway/src/services/saldos.js`) y se adjunta a la
  respuesta con ese mismo nombre, así que el frontend recibe lo de siempre. La
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
| `0010` | Recuperación de contraseña: endpoints, tabla de tokens, columna `contrasena_cambiada_en` y envío de correo desde `ms-identidad`. Esto último **debe desaparecer** en el paso 7, no documentarse. |
| `0011` | ~~El estado del inmueble deja de moverse dentro de la transacción del contrato.~~ **Reemplazada por `0012` en el paso 5.** La garantía que registraba como perdida está saldada; no hay nada que tramitar. |
| `0012` | Bus de eventos sobre PostgreSQL con patrón outbox, en vez de Dapr. Resuelve una decisión abierta y **no se aparta del documento**, que ordena el mecanismo pero no la tecnología. Lo que sí conviene incorporar es la **garantía de entrega**: al-menos-una-vez con descarte de repetidos. |
| `0013` | El evento `ContratoFinalizado`, que el documento no contempla. **Esta sí es desviación**: añade una pieza al diseño de comunicación entre servicios. |
| `0014` | Almacenamiento de anexos detrás de una interfaz, con Azure Blob en despliegue, y servidos por la API en vez de con URL firmada. Resuelve una decisión abierta; **no se aparta del documento**, que no fija proveedor ni forma de servir el archivo. |
| `0015` | `Transacciones` conserva `observaciones`, que el modelo canónico no lista. **Es desviación por adición**: la imprime el comprobante en «Referencia trans.». |
| `0016` | Anulación de transacciones: endpoint, estado `ANULADA` y 409 al repetir. **Es desviación**: el documento no contempla ni el endpoint ni el estado. |

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
`apps/gateway/src/services/saldos.js` y se expone como `saldo_pendiente`.

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
de dinero contra esa factura. **Hecho en el paso 6c**, con una migración que transforma
los datos existentes (`database/dominio/006`) y que antes de borrar `saldo_pendiente`
comprueba fila a fila que lo guardado cuadre con lo derivado.

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
| `ms-notificaciones` | Genérico | ninguna | 3015 |
| `gateway` | — | ninguna | 3001 |
| `web` | — | — | 3000 |

El gateway conserva el puerto 3001 a propósito: el frontend y la colección de Postman
siguen funcionando durante toda la migración.

---

## Estructura del repositorio

```
Arriendos360/
├─ apps/
│  ├─ web/                     React SPA
│  └─ gateway/                 PEP: SSL, validación JWT, matriz RBAC, enrutamiento,
│  │                           agregación del dashboard
├─ services/
│  ├─ ms-identidad/  ms-inmuebles/  ms-contratos/
│  ├─ ms-financiero/  ms-notificaciones/
├─ packages/
│  ├─ contracts/               DTOs compartidos en TypeScript
│  └─ shared/                  JWT, errores, cliente HTTP y el bus de eventos:
│                              tipos, tabla de salida, publicador y consumidor
├─ database/                   Migraciones y seeds, una carpeta por esquema
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

### El bus, en concreto

**PostgreSQL con patrón outbox. Sin broker.** Ver `docs/adr/0012`. El mecanismo entero
vive en `packages/shared` y ningún servicio lo reimplementa:

- **El productor escribe el evento en la misma transacción que el cambio de dominio**,
  en SU tabla de salida, en SU esquema. Nunca una tabla compartida: sería un punto de
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
| `ContratoFormalizado` | quien escribe el contrato (hoy el gateway) | `id_contrato`, `id_inmueble`, `canon`, `fecha_inicio_corte` | `ms-inmuebles` → `arrendado`. En el paso 6 también `ms-financiero`. |
| `ContratoFinalizado` | ídem | `id_contrato`, `id_inmueble` | `ms-inmuebles` → `disponible`. Ver `docs/adr/0013`. |

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
`MS-Financiero` con un proceso programado que barre fechas de corte. Ese código existe
parcialmente en `financialEngine.js`.

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

El monolito y los microservicios conviven. El gateway resuelve local lo no extraído y
remoto lo ya extraído.

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
   - **6d.** Extraer `ms-contratos` con `Contratos` + `Anexos` y `ms-financiero` con
     `Cuentas_cobro` + `Transacciones`, y llevarse la tabla de salida del bus con
     Contratos: el productor se muda con lo que produce. Ahí hay que resolver el ABAC
     de los anexos, que hoy consulta a ms-inmuebles — ver la cabecera de
     `controllers/anexo.controller.js`, que propone denormalizar `id_propietario` en
     `Contratos`— y encadenar el salto Financiero → Contratos, que hoy sigue siendo
     un `include`. `ContratoFormalizado` gana entonces su segundo consumidor:
     ms-financiero, que inserta la primera cuenta de cobro.
   - Y en algún punto de los tres: obtener datos del contrato por API en vez de por
     `include`.
7. **`ms-notificaciones`.** Mailer y recordatorios.
8. **Azure Container Apps.** Bicep, pipeline y terminación SSL. Al final.

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
  (`models/fechasContrato.js`) y la migración las rellenó con `AT TIME ZONE 'UTC'`. El
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
  `models/fechasContrato.js`, y no se calcula en ningún otro sitio.
- **Días del mes que no existen:** un contrato que vence el 31 no tiene ese día en
  febrero. La regla es **recortar al último día del mes**, y el día pactado se guarda
  sin tocar: el recorte se aplica al resolverlo contra cada mes, no al guardarlo. Ver
  la cabecera de `models/fechasContrato.js`.

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
npm test --workspaces --if-present                        # todas, contra dobles
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

Resuélvelas con un ADR en `docs/adr/` cuando llegue el momento, no antes:

**Un publicador con varias réplicas del gateway.** Hoy hay una, y dos publicadores sobre
la misma tabla de salida podrían entregar el mismo evento a la vez. Eso ya está cubierto
—la entrega es al-menos-una-vez y el consumidor descarta repetidos— pero el **orden por
clave** sí se vería afectado por un bloqueo por fila (`FOR UPDATE SKIP LOCKED`).
Reconsiderar en el paso 8, cuando Container Apps pueda escalar el gateway. Ver
`docs/adr/0012`.

**Frecuencia de refresco de la caché de revocados en el gateway.** Ventana entre el
logout y su efecto real en las demás réplicas.

**Listados de un usuario con doble rol.** `contrato.controller.js` y
`pago.controller.js` deciden la visibilidad con una disyunción: eres el dueño del
inmueble **o** el inquilino del contrato. El criterio es correcto —la pertenencia manda
sobre el rol declarado, y es lo que permite que quien es las dos cosas no pierda la
mitad de sus datos—, pero hoy se resuelve con un `Op.or` sobre columnas alcanzadas por
`include`, es decir, **JOINs que cruzan bounded contexts**:

| Controlador | Ruta de la condición | Contextos que cruza |
|---|---|---|
| `contrato.controller.js` | `$Inmueble.id_propietario$` | Contratos → Inmuebles |
| `pago.controller.js` (cuentas) | `$Contrato.Inmueble.id_propietario$` | Financiero → Contratos → Inmuebles |
| `pago.controller.js` (transacciones) | `$CuentaCobro.Contrato.Inmueble.id_propietario$` | Financiero → Contratos → Inmuebles |

**La mitad de esto ya está hecha.** El paso 4 tuvo que adelantarlo: al irse Inmuebles,
los tres `include` dejaron de existir y la disyunción se resolvió como manda el plan
—pedir a Inmuebles los IDs del propietario y filtrar por esa lista— en
`clientes/inmuebles.js`. La lista viaja en el cuerpo de la respuesta, no en una query
string, así que el problema del tamaño no llegó a plantearse.

Lo que queda es el salto **Financiero → Contratos**, que hoy sigue siendo un `include`
porque las dos tablas viven todavía en el gateway. El paso 6c no lo cambió: partir
`pagos` en dos no mueve la frontera, sólo renombra los tramos de la condición. En el
6d, al extraerse los dos servicios, hay que encadenar un salto más: pedir a Contratos
los contratos de esos inmuebles y filtrar las cuentas de cobro por esa segunda lista.
Ahí sí habrá que decidir si el gateway pagina o si Contratos acepta una lista de IDs.

**`database/dominio/` es provisional.** Agrupaba inmuebles, contratos, pagos y abonos
en una sola carpeta porque todavía no había servicios que las separaran.
`database/inmuebles/` ya salió de ahí —con una migración que copia y otra que retira,
en ese orden— y quedan `database/contratos/` y `database/financiero/`, que se van en el
paso 6d por el mismo camino. Ver `docs/adr/0003`.

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
propietario, o pasarela que dispare el asiento. Sigue abierta después del 6c: la
anulación del `docs/adr/0016` da la mitad que faltaba —poder corregir un registro
equivocado sin borrarlo— pero no resuelve quién puede registrarlo.

**Devoluciones.** `TIPOS_TRANSACCION` está cerrado con un solo valor, `INGRESO`, porque
es lo único que el sistema produce. El día que haya que devolver dinero —un depósito que
se reintegra, un cobro de más— hace falta `EGRESO` aquí y en el `CHECK` de una migración.
No confundirlo con anular: anular corrige un registro que no debió existir; un egreso
registra dinero que de verdad salió. Ver `docs/adr/0016`.

**Comprobantes.** El frontend tiene una pantalla que no aparece entre las cinco del
documento (UI-01 a UI-05). Decidir si se documenta o se absorbe en Pagos.

---

## Trampas conocidas

**El correo no llega a nadie.** Con `EMAIL_USER` sin definir, el mailer apunta a un
buzón de pruebas (Ethereal). El enlace de recuperación se genera y se envía, pero para
verlo en desarrollo hay que leerlo del log o de `identidad.tokens_recuperacion`. Es la
misma razón por la que la contraseña temporal del ADR 0007 se entrega en mano.

~~**`/uploads/` se sirve sin autenticación.**~~ **Resuelto en el paso 6b.** No queda
ninguna ruta que sirva archivos sin pasar por la matriz: los anexos salen sólo por
`GET /api/contratos/:id/anexos/:idAnexo`, con RBAC y ABAC delante. Y **no** se hizo
con URL firmada, que era lo que este archivo anticipaba: una URL firmada es un
permiso que viaja solo y no se puede revocar antes de que caduque, que es el mismo
agujero con mejor presentación. Ver `docs/adr/0014`.

~~**`backend/uploads/` en disco local.**~~ **Resuelto en el paso 6b.** El disco sigue
siendo la implementación de desarrollo, pero detrás de una interfaz: en despliegue se
usa Azure Blob, y la elección la decide una sola variable de entorno.

**Un contrato de 16 líneas de mora no existe: `verificar-mora` y el motor no aplican la
misma regla.** `POST /api/pagos/verificar-mora` marca EN_MORA toda cuenta PENDIENTE o
PARCIAL cuyo corte ya pasó —un solo día basta— mientras que `procesarPagos()` espera al
sexto. Venía de antes del paso 6c y sigue igual: es un endpoint manual que el frontend no
llama, pero si alguien lo dispara desde Postman deja cuentas en mora que el motor no
habría marcado. Unificarlo es trabajo del 6d, cuando el motor se mude a Financiero.

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
