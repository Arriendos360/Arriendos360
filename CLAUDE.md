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

Pasos 1, 2 y 3a de la migración completados. El sistema sigue siendo un **monolito
modular funcionando**, ahora dentro de una estructura de monorepo y con el modelo de
identidad del Capítulo 2 ya implementado:

- `apps/gateway/` — el antiguo `backend/`. Express + Sequelize + PostgreSQL en
  JavaScript (CommonJS). Incluye la costura de enrutamiento: cada prefijo se resuelve
  local o remoto según haya o no valor en su variable `MS_*_URL`. Hoy todos locales.
- `apps/web/` — el antiguo `frontend/`. React 18 con CRA. **Sin Tailwind**, aunque el
  PMP lo declara.
- `packages/contracts/` — DTOs en TypeScript de los endpoints documentados.
- `packages/shared/` — verificación local del JWT y de revocados, error estándar,
  cliente HTTP. Todavía sin consumir: el build del gateway usa contexto
  `apps/gateway` y `packages/` no entra en la imagen. Se conecta en el paso 3b.
- `database/` — migraciones SQL versionadas, una carpeta por esquema
  (`identidad/`, `dominio/`). Reemplazan a `sequelize.sync()`; ver `docs/adr/0003`.
- `docs/erd/schema-legacy.sql` — modelo viejo, histórico. **No usar como referencia.**

Lo que el paso 3a ya dejó hecho: `Usuarios` + `Roles` + `RolesUsuario` (adiós a
`propietarios` e `inquilinos`), UUID en todas las claves, columnas de auditoría,
claims nuevos (`sub`/`email`/`roles`/`jti`), `logout` con `TokensRevocados`, token en
memoria en la SPA y descargas por blob. Falta el 3b: extraer `ms-identidad` y montar
la matriz RBAC.

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
| — (no existe) | `Anexos` |
| `Pago` | `Cuentas_cobro` |
| `Abono` | `Transacciones` |

`Cuentas_cobro` y `Transacciones` **no son sinónimos** de `Pago` y `Abono`. Una cuenta de
cobro es la factura mensual que el sistema genera solo; una transacción es el movimiento
de dinero contra esa factura. El modelo actual mezcla ambos conceptos y
`financialEngine.js` está escrito sobre esa confusión. Separarlos es el trabajo más
delicado de la migración.

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
│  └─ shared/                  JWT, errores, logger, cliente HTTP, tipos de eventos
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

**Generación recurrente:** las cuentas de cobro de meses siguientes las genera
`MS-Financiero` con un proceso programado que barre fechas de corte. Ese código existe
parcialmente en `financialEngine.js`.

Los tipos de evento viven en `packages/shared`. Tecnología del bus: pendiente,
recomendación **Dapr pub/sub** por venir integrado en Container Apps. ADR antes del
paso 5.

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
3. **Identidad y seguridad.** Se parte en dos PRs:
   - ~~**3a.** Rehacer el modelo de identidad dentro del gateway.~~ **Hecho.**
   - **3b.** Extraer físicamente `ms-identidad` y montar la matriz RBAC en el gateway.
     Arrastra dos cosas del 3a: hacer el build de Docker consciente del monorepo (para
     que el gateway pueda consumir `packages/shared`) y llevarse `database/identidad/`.
4. **`ms-inmuebles`.** Primer servicio con referencias lógicas reales. Aquí entra la
   validación ABAC de pertenencia.
5. **Bus de eventos.** Infraestructura de mensajería y tipos en `packages/shared`.
6. **`ms-contratos`** y **`ms-financiero`.** El trabajo duro: separar `Pago`/`Abono` en
   `Cuentas_cobro`/`Transacciones`, mover el motor de mora a Financiero, obtener datos
   del contrato por API en vez de por `include`, y almacenamiento en la nube para anexos.
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
- **Dinero:** pesos colombianos. `NUMERIC` en PostgreSQL, nunca `float`.
- **Fechas:** guardar en UTC, presentar en `America/Bogota`. El cálculo de mora depende
  de esto y hoy usa `new Date()` local, que es una fuente latente de errores.

---

## Comandos

```bash
docker compose -f infra/docker-compose.yml up --build     # levantar todo
docker compose -f infra/docker-compose.yml down -v        # reinicio limpio
npm test --workspace=services/ms-financiero               # pruebas de un servicio
npm test --workspaces --if-present                        # todas
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

**Tecnología del bus de eventos.** Ver arriba.

**Almacenamiento en la nube para anexos.** Azure Blob Storage es lo natural dado el
hosting. Hoy los archivos van a disco local, que no sobrevive a scale-to-zero.

**Frecuencia de refresco de la caché de revocados en el gateway.** Ventana entre el
logout y su efecto real en las demás réplicas.

**Lockfiles anidados.** `apps/gateway` y `apps/web` conservan `package-lock.json`, pero
npm en modo workspaces los ignora: manda el de la raíz. Los Dockerfiles deben construir
desde el contexto raíz con `npm ci --workspace=...` y esos lockfiles deben borrarse.
Trabajo del paso 8.

**Comprobantes.** El frontend tiene una pantalla que no aparece entre las cinco del
documento (UI-01 a UI-05). Decidir si se documenta o se absorbe en Pagos.

**`admin.routes.js`.** Dispara el motor financiero a mano. Importa `esPropietario` pero
no lo aplica: cualquier usuario autenticado puede ejecutarlo. Pertenece a
`ms-financiero`, no al gateway. Corregir al llegar al paso 6.

---

## Trampas conocidas

**`/uploads/` se sirve sin autenticación.** `express.static('uploads')` va antes de
cualquier middleware de token, así que los PDF de contrato son públicos para quien
conozca la URL. El `?token=` que el frontend les pegaba nunca protegió nada. Se
resuelve en el paso 6, al mover los anexos a almacenamiento en la nube con URL firmada.

**`backend/uploads/` en disco local.** No sobrevive a un contenedor efímero.

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
