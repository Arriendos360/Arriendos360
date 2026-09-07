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
   Arquitectura de microservicios, Interfaz gráfica). Es la especificación vigente.
2. SRS y PMP, para requisitos funcionales y proceso.
3. El código existente.

El código actual **no** cumple el Capítulo 2. Donde discrepen, manda el documento. Este
archivo traduce el documento a reglas operativas; si detectas una contradicción entre
este archivo y el documento, gana el documento y avísame.

---

## Estado actual

Un **monolito modular funcionando**, ~4.100 líneas:

- `backend/` — Express + Sequelize + PostgreSQL en JavaScript (CommonJS). Controllers,
  routes, models, middlewares, `services/financialEngine.js` (mora con node-cron),
  `services/pdfService.js` (recibos con pdfkit), `config/mailer.js`.
- `frontend/` — React 18 con Create React App. Login, Dashboard, Inmuebles, Contratos,
  Pagos, Comprobantes. Chart.js. **Sin Tailwind**, aunque el PMP lo declara.
- `backend/tests/` — Jest + supertest, 6 archivos.

El historial se reinició a un commit base y los secretos se purgaron. Las credenciales
viven solo en `.env` local, con `.env.example` versionado.

**Funciona. No lo rompas.** En cada paso de la migración el sistema debe poder
levantarse y demostrarse.

---

## Modelo de datos canónico

Definido en el Capítulo 2, sección Persistencia. **Ocho tablas, ni una más.**

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

**Toda tabla lleva además columnas de auditoría:** `creado_por`, `fecha_creacion`,
`ultima_actualizacion`, `actualizado_por`. No son opcionales; están en el modelo
seudomatemático del documento.

**Todos los identificadores son UUID.** Los contratos de interfaz del documento los
declaran así explícitamente (`"id_inmueble": "uuid"`). El código actual usa `INTEGER` y
`VARCHAR(20)`; eso se migra.

### Mapeo desde el código actual

Esto no es un cambio de nombres, es un cambio de modelo. Léelo antes de tocar nada:

| Hoy en el código | Destino |
|---|---|
| `Usuario`, `Propietario`, `Inquilino` (3 tablas) | `Usuarios` + `Roles` + `RolesUsuario` |
| `Inmueble` | `Inmuebles` |
| `Contrato` | `Contratos` |
| — (no existe) | `Anexos` |
| `Pago` | `Cuentas_cobro` |
| `Abono` | `Transacciones` |

Los dos últimos merecen atención. **No son sinónimos.** Una cuenta de cobro es la
factura mensual que el sistema genera automáticamente; una transacción es el movimiento
de dinero contra esa factura. El modelo actual de `Pago`/`Abono` mezcla ambos conceptos,
y `financialEngine.js` está escrito sobre esa confusión. Separarlos es el trabajo más
delicado de toda la migración.

Las tablas `propietarios` e `inquilinos` **desaparecen**. La distinción pasa a ser un rol
en `RolesUsuario`, no una tabla. Un mismo usuario puede ser ambas cosas.

---

## Catálogo de microservicios

| Servicio | Subdominio | Tablas propias | Puerto local |
|---|---|---|---|
| `ms-identidad` | Soporte | Usuarios, Roles, RolesUsuario | 3011 |
| `ms-inmuebles` | Soporte | Inmuebles | 3012 |
| `ms-contratos` | Core | Contratos, Anexos | 3013 |
| `ms-financiero` | Core | Cuentas_cobro, Transacciones | 3014 |
| `ms-notificaciones` | Genérico | ninguna | 3015 |
| `gateway` | — | ninguna | 3001 |
| `web` | — | — | 3000 |

El gateway conserva el puerto 3001 a propósito: el frontend y la colección de Postman
siguen funcionando sin cambios durante toda la migración.

---

## Estructura del repositorio

```
Arriendos360/
├─ apps/
│  ├─ web/                     React SPA
│  └─ gateway/                 BFF: entrada única + agregación del dashboard
├─ services/
│  ├─ ms-identidad/
│  ├─ ms-inmuebles/
│  ├─ ms-contratos/
│  ├─ ms-financiero/
│  └─ ms-notificaciones/
├─ packages/
│  ├─ contracts/               DTOs compartidos en TypeScript
│  └─ shared/                  JWT, errores, logger, cliente HTTP, tipos de eventos
├─ database/                   Migraciones y seeds, una carpeta por esquema
├─ infra/                      Dockerfiles, docker-compose, Bicep de Azure
├─ docs/                       ADRs, ERD, colección Postman
└─ .github/workflows/
```

Monorepo con **npm workspaces**. Cada servicio tiene su `package.json`, `Dockerfile`,
`tsconfig.json` y `tests/`. Por dentro conserva la organización que ya conoces:
`src/controllers`, `routes`, `models`, `services`, `config`.

---

## Reglas duras

Vienen del Capítulo 2 y sostienen la justificación arquitectónica del proyecto. No son
negociables sin solicitud de cambio formal.

**1. Cero claves foráneas entre esquemas.**
Ningún servicio declara FK física hacia tabla de otro servicio. Las referencias cruzadas
son UUID sin constraint. El servicio asume que el ID existe; la validación recae en el
gateway o en una llamada síncrona previa.

Específicamente: `Inmuebles.id_propietario`, `Contratos.id_inmueble` y
`Contratos.id_inquilino` son referencias lógicas.

**2. Cero JOIN entre servicios.**
Ningún `include` de Sequelize ni `JOIN` de SQL cruza la frontera de un bounded context.
Las agregaciones se resuelven en el gateway componiendo respuestas HTTP.

**3. Cada servicio es dueño exclusivo de su esquema.** Nadie lee ni escribe tablas
ajenas. Si necesitas un dato de otro contexto, se pide por su API.

**4. El `id_propietario` sale del token JWT, nunca del payload.** Aceptarlo en el body
permitiría registrar inmuebles a nombre de otro.

**5. El dashboard no es un microservicio.** Vive en el gateway y no tiene tablas propias.

**6. Ningún secreto entra al repositorio.** Solo `.env.example` con valores vacíos.

---

## Comunicación entre servicios

Dos mecanismos, y el documento define cuándo va cada uno.

**Síncrono (REST/JSON)** para consultas y comandos del usuario.

**Asíncrono (bus de eventos)** para la creación en cadena. El caso especificado:

- `MS-Contratos` guarda el contrato y emite `ContratoFormalizado` al bus.
- `MS-Financiero` consume el evento, extrae `id_contrato`, `canon` y
  `fecha_inicio_corte`, e inserta la primera `Cuenta_cobro`.

Esto es coreografía de eventos, no orquestación: Contratos no llama a Financiero ni sabe
que existe. Publica y sigue.

**Generación recurrente:** las cuentas de cobro de los meses siguientes las genera
`MS-Financiero` con un proceso programado que barre fechas de corte. Ese código ya
existe parcialmente en `financialEngine.js` y se muda ahí.

Los tipos de evento (nombre, versión, payload) viven en `packages/shared`.

La tecnología del bus está abierta. Recomendación: **Dapr pub/sub**, que viene integrado
en Azure Container Apps y evita provisionar infraestructura aparte. Decídelo con un ADR
antes de llegar al paso 5.

---

## Contratos de interfaz

Tal como los define el documento. Respeta los nombres de campo exactos.

**MS-Identidad** — `POST /api/auth/registro`
```json
{ "nombres": "string", "apellidos": "string", "email": "string",
  "contrasena": "string", "telefono": "string", "documento": "string" }
```
La asignación del rol en `RolesUsuario` se maneja internamente.

**MS-Inmuebles** — `POST /api/inmuebles`
```json
{ "alias": "string", "direccion": "string", "ciudad": "string",
  "tipo": "string", "descripcion": "string" }
```
El `id_propietario` se inyecta desde los claims del JWT.

**MS-Contratos** — `POST /api/contratos`
```json
{ "id_inmueble": "uuid", "id_inquilino": "uuid",
  "inicio": "YYYY-MM-DD", "fin": "YYYY-MM-DD",
  "fecha_inicio_corte": "YYYY-MM-DD", "fecha_limite_pago": 5,
  "canon": 1500000.00,
  "nombre_deudor_solidario": "string", "documento_deudor_solidario": "string" }
```
Ojo: `fecha_limite_pago` es un **día del mes** (entero), no una fecha.

**MS-Contratos** — `POST /api/contratos/{id_contrato}/anexos`
`multipart/form-data` con `file` (PDF) y `tipo` (`CONTRATO_FIRMADO`, `OTROSI`, etc.).
El servicio valida que sea PDF y que el contrato exista, **sube el archivo a
almacenamiento en la nube**, y guarda la URL devuelta en `archivo_anexo`.

**MS-Financiero** — `POST /api/pagos`
```json
{ "id_cuenta_cobro": "uuid", "monto": 1500000.00, "tipo": "INGRESO",
  "medio_pago": "TRANSFERENCIA", "fecha_pago": "YYYY-MM-DDTHH:mm:ssZ" }
```

---

## Migración: en qué orden

El monolito y los microservicios conviven. El gateway enruta al monolito lo que no se ha
extraído y al servicio nuevo lo que ya sí.

1. **Estructura.** Mover carpetas, montar npm workspaces, `docker-compose` levantando
   todo igual que hoy. Un solo backend todavía.
2. **Gateway.** Proxy transparente al monolito. El frontend no se entera.
3. **`ms-identidad`.** No es "mover el auth": es rehacer el modelo de identidad
   (`Usuarios` + `RolesUsuario`), migrar a UUID y agregar columnas de auditoría. Aquí se
   define también cómo validan el token los demás servicios: verificación local del JWT
   con secreto compartido, sin llamar a Identidad en cada petición.
4. **`ms-inmuebles`.** Primer servicio con referencias lógicas reales.
5. **Bus de eventos.** Infraestructura de mensajería y tipos en `packages/shared`,
   antes de partir los dos núcleos.
6. **`ms-contratos`** y **`ms-financiero`.** El trabajo duro: separar `Pago`/`Abono` en
   `Cuentas_cobro`/`Transacciones`, mover el motor de mora a Financiero, y hacer que
   obtenga los datos del contrato por API en vez de por `include`. Aquí también entra el
   almacenamiento en la nube para anexos.
7. **`ms-notificaciones`.** Se lleva el mailer y los recordatorios.
8. **Azure Container Apps.** Bicep y pipeline, al final. No depures infraestructura
   mientras partes el dominio.

---

## TypeScript incremental

El SRS especifica TypeScript. No migramos las 4.100 líneas de golpe.

- `tsconfig.json` con `"allowJs": true` y `"checkJs": false`.
- **Todo código nuevo en `.ts`**, con `import`/`export`, no `require`.
- `packages/contracts` es 100% TypeScript desde el primer día: ahí viven los DTOs de los
  contratos de arriba.
- Un `.js` se convierte a `.ts` solo cuando ya lo estás modificando por otra razón.
- `strict: true` en paquetes y servicios nuevos.

---

## Convenciones

- **Dominio en español, plataforma en inglés.** Los nombres del negocio (`contrato`,
  `inmueble`, `canon`, `mora`, `cuenta_cobro`, `transaccion`) en español, igual que en
  el documento y la base de datos. Lo técnico (`middleware`, `router`, `handler`) en
  inglés.
- **Rutas REST:** `/api/{recurso}` en plural.
- **Errores:** siempre `{ mensaje: "..." }` en el body. 401 sin token, 403 token
  inválido o rol insuficiente, 400 validación, 404 no encontrado.
- **Dinero:** pesos colombianos. `NUMERIC` en PostgreSQL, nunca `float`.
- **Fechas:** guardar en UTC, presentar en `America/Bogota`. El cálculo de mora depende
  de esto y hoy usa `new Date()` local, que es una fuente latente de errores.
- **UUID:** genera en la aplicación (`crypto.randomUUID()`), no con `DEFAULT` de la
  base. Los servicios necesitan conocer el ID antes de publicar un evento.

---

## Comandos

```bash
docker compose -f infra/docker-compose.yml up --build     # levantar todo
docker compose -f infra/docker-compose.yml down -v        # reinicio limpio
npm test --workspace=services/ms-financiero               # pruebas de un servicio
npm test --workspaces --if-present                        # todas
```

Las pruebas corren con `NODE_ENV=test`, apuntando a `arriendos360_test`.

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

**Endpoints del documento vs. implementados.** El Capítulo 2 especifica
`POST /api/auth/registro` y `POST /api/pagos` con `id_cuenta_cobro`. La sección de
Interfaz gráfica del mismo documento describe el comportamiento actual del frontend, que
usa `POST /auth/register` y `PUT /pagos/:id/pagar`. Ganan los contratos de la sección de
microservicios; el frontend se adapta. Registra el cambio.

**Tecnología del bus de eventos.** Ver arriba.

**Almacenamiento en la nube para anexos.** Azure Blob Storage es lo natural dado el
hosting. Hoy los archivos van a disco local, que no sobrevive a scale-to-zero.

**Comprobantes.** El frontend tiene una pantalla de Comprobantes que no aparece entre
las cinco del documento (UI-01 a UI-05). Decidir si se documenta o se absorbe en Pagos.

---

## Trampas conocidas

**`sequelize.sync()` en `app.js`.** Crea tablas al arrancar. Cómodo en desarrollo,
peligroso en producción. Reemplazar por migraciones versionadas en `database/` antes de
desplegar. Con el cambio a UUID esto deja de ser opcional.

**El token viaja por query string.** `auth.middleware.js` acepta `?token=` para que
funcionen las descargas de PDF con `window.open`. Queda en logs del servidor e historial
del navegador. Al pasar a HTTPS, reemplazar por URLs firmadas de un solo uso.

**Trazabilidad rota en `financialEngine.js`.** Los comentarios citan RF-14, RF-15 y
RF-16, pero según el SRS esos son requisitos del Dashboard. Recibos es RF-11 y alertas
de mora es RF-12. Corregir al tocar el archivo.

**`backend/uploads/` en disco local.** No sobrevive a un contenedor efímero. Ver
decisiones abiertas.

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
- No crees tablas fuera de las ocho canónicas sin actualizar el documento primero.
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
