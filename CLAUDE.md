# Arriendos360

Plataforma web de gestión de arrendamientos para propietarios pequeños y medianos en
Bogotá D.C. Proyecto de grado en Ingeniería de Sistemas (UDFJDC). Equipo de 2 personas
con dedicación parcial, timebox de 16 semanas, presupuesto en efectivo de $0.

Ese contexto no es adorno: define el criterio de decisión. Cuando haya que elegir entre
la solución elegante y la que cabe en el cronograma y en los créditos de Azure for
Students, gana la segunda. Prefiere siempre el cambio incremental que deja el sistema
funcionando sobre la refactorización grande que lo deja roto una semana.

---

## Estado actual

El repositorio contiene hoy un **monolito modular funcionando**, no microservicios:

- `backend/` — Express + Sequelize + PostgreSQL, en JavaScript (CommonJS, `require`).
  Controllers, routes, models, middlewares. Incluye `services/financialEngine.js`
  (motor de mora con node-cron) y `services/pdfService.js` (recibos con pdfkit).
- `frontend/` — React 18 con Create React App. Páginas: Login, Dashboard, Inmuebles,
  Contratos, Pagos, Comprobantes. Chart.js para gráficas. **Sin Tailwind**, aunque el
  PMP lo declara.
- `backend/tests/` — Jest + supertest, 6 archivos.
- `Arriendos360.postman_collection.json` en la raíz.

Aproximadamente 4.100 líneas entre backend y frontend. Funciona. **No lo rompas.**

## Estado objetivo

Cinco microservicios más un gateway, desplegados en Azure Container Apps con
scale-to-zero, sobre una única instancia de PostgreSQL con un esquema por servicio.

```
Arriendos360/
├─ apps/
│  ├─ web/                     React SPA
│  └─ gateway/                 BFF: entrada única + agregación del dashboard
├─ services/
│  ├─ ms-identidad/            Usuarios, roles, JWT
│  ├─ ms-inmuebles/            Catálogo de inmuebles
│  ├─ ms-contratos/            Núcleo legal: contratos y anexos
│  ├─ ms-financiero/           Cuentas de cobro, pagos, abonos, mora, recibos
│  └─ ms-notificaciones/       Correo y recordatorios
├─ packages/
│  ├─ contracts/               DTOs compartidos en TypeScript
│  └─ shared/                  JWT, errores, logger, cliente HTTP
├─ database/                   Migraciones y seeds, una carpeta por esquema
├─ infra/                      Dockerfiles, docker-compose, Bicep de Azure
├─ docs/                       ADRs, ERD, colección Postman
└─ .github/workflows/
```

Monorepo con **npm workspaces**. Cada servicio tiene su propio `package.json`,
`Dockerfile`, `tsconfig.json` y `tests/`.

---

## Reglas duras

Estas reglas vienen del *Anexo de Diseño y Especificación de Microservicios*, que es
línea base del proyecto. Violarlas invalida la justificación arquitectónica de la tesis,
así que no son negociables sin una solicitud de cambio formal.

**1. Cero claves foráneas entre esquemas.**
Un servicio nunca declara una FK física hacia una tabla de otro servicio. Las
referencias cruzadas se guardan como identificadores lógicos sin constraint. El servicio
asume que el ID existe; la validación ocurre en el gateway o en una llamada síncrona
previa.

Concretamente, estas tres FK del `schema.sql` original deben desaparecer:
`inmuebles.id_propietario → propietarios`, `contratos.id_inmueble → inmuebles`,
`contratos.id_inquilino → inquilinos`.

**2. Cero JOIN entre servicios.**
Ningún `include` de Sequelize ni `JOIN` de SQL puede cruzar la frontera de un bounded
context. Las agregaciones se resuelven en el gateway componiendo respuestas HTTP.

**3. Cada servicio es dueño exclusivo de su esquema.**
Nadie lee ni escribe tablas ajenas, ni siquiera para una consulta rápida. Si necesitas
un dato de otro contexto, se pide por su API REST.

**4. El `id_propietario` se toma del token JWT, nunca del payload.**
Aceptarlo en el body es un agujero de autorización directo: cualquiera podría registrar
inmuebles a nombre de otro.

**5. El dashboard no es un microservicio.**
Vive en el gateway. No tiene tablas propias porque no posee datos propios; solo agrega
los de Contratos y Financiero.

**6. Ningún secreto entra al repositorio.**
Ni `.env`, ni credenciales en `docker-compose.yml`, ni claves en el código. Solo
`.env.example` con valores vacíos.

---

## Catálogo de servicios

| Servicio | Subdominio | Tablas propias | Puerto local |
|---|---|---|---|
| `ms-identidad` | Soporte | usuarios, roles, roles_usuario, propietarios, inquilinos | 3011 |
| `ms-inmuebles` | Soporte | inmuebles, tipos_inmueble | 3012 |
| `ms-contratos` | Core | contratos, anexos, estados_contrato | 3013 |
| `ms-financiero` | Core | cuentas_cobro, pagos, abonos, estados_pago | 3014 |
| `ms-notificaciones` | Genérico | ninguna | 3015 |
| `gateway` | — | ninguna | 3001 |
| `web` | — | — | 3000 |

El gateway mantiene el puerto 3001 a propósito: así el frontend y la colección de
Postman siguen funcionando sin cambios durante toda la migración.

---

## Migración: en qué orden

El monolito y los microservicios conviven durante la transición. El gateway enruta hacia
el monolito lo que todavía no se ha extraído, y hacia el servicio nuevo lo que ya sí. En
todo momento el sistema debe poder levantarse y demostrarse.

1. **Estructura.** Mover carpetas, montar npm workspaces, `docker-compose` levantando
   todo igual que hoy. Un solo backend todavía.
2. **Gateway.** Proxy transparente al monolito. El frontend no se entera.
3. **`ms-identidad`.** El corte más limpio. Aquí se resuelve de una vez cómo validan el
   token los demás servicios (verificación local del JWT con secreto compartido, sin
   llamar a Identidad en cada petición).
4. **`ms-inmuebles`.** Primer servicio que depende de referencias lógicas.
5. **`ms-contratos`** y **`ms-financiero`.** Los dos núcleos. Aquí está el trabajo duro:
   `financialEngine.js` hoy hace `include` a través de Contrato, Inmueble, Propietario,
   Usuario e Inquilino. Ese motor debe quedar en Financiero y obtener los datos de
   contrato por API.
6. **`ms-notificaciones`.** Se lleva el mailer y los cron de recordatorios.
7. **Container Apps.** Bicep y pipeline, al final. No depures infraestructura mientras
   estás partiendo el dominio.

---

## TypeScript incremental

El SRS especifica TypeScript. No migramos las 4.100 líneas existentes de golpe.

- `tsconfig.json` con `"allowJs": true` y `"checkJs": false`. Los `.js` actuales siguen
  compilando sin tocarse.
- **Todo código nuevo se escribe en `.ts`**, con `import`/`export`, no `require`.
- `packages/contracts` es 100% TypeScript desde el primer día. Ahí viven los DTOs de
  cada endpoint, que son la traducción literal de los contratos JSON del anexo.
- Un archivo `.js` se convierte a `.ts` solo cuando ya lo estás modificando por otra
  razón. Nunca como tarea aparte.
- `strict: true` en los paquetes y servicios nuevos.

---

## Convenciones

- **Dominio en español, plataforma en inglés.** Los nombres del negocio (`contrato`,
  `inmueble`, `canon`, `mora`, `abono`, `propietario`, `inquilino`) van en español,
  igual que en el SRS y en la base de datos. Las palabras técnicas (`middleware`,
  `router`, `handler`, `repository`) en inglés. No traduzcas identificadores existentes.
- **Rutas REST:** `/api/{recurso}` en plural. Ya establecido: `/api/auth`,
  `/api/inmuebles`, `/api/contratos`, `/api/pagos`, `/api/dashboard`.
- **Errores:** siempre `{ mensaje: "..." }` en el body, como ya lo hace el código.
  Códigos: 401 sin token, 403 token inválido o rol insuficiente, 400 validación,
  404 no encontrado.
- **Dinero:** los montos son pesos colombianos enteros. Nunca uses `float`. En
  PostgreSQL, `NUMERIC`. En TypeScript, `number` entero, y valida que lo sea.
- **Fechas:** guardar en UTC, presentar en `America/Bogota`. El cálculo de mora depende
  de esto y hoy usa `new Date()` local, lo cual es una fuente latente de errores.

---

## Comandos

```bash
# Desarrollo local (levanta Postgres + todos los servicios)
docker compose -f infra/docker-compose.yml up --build

# Reinicio limpio, borrando volúmenes
docker compose -f infra/docker-compose.yml down -v

# Pruebas de un servicio
npm test --workspace=services/ms-financiero

# Todas las pruebas
npm test --workspaces --if-present

# Datos de prueba
npm run seed --workspace=services/ms-identidad
```

Las pruebas corren con `NODE_ENV=test`, que apunta a la base `arriendos360_test`.

---

## Git Flow

Adaptado, según el PMP:

- `main` contiene únicamente código funcional y desplegable.
- Una rama por historia de usuario: `feature/nombre-modulo`.
- **Todo cambio entra por Pull Request.** El PMP lo exige como control de calidad
  ("principio de cuatro ojos": quien codifica un módulo no es quien lo prueba).
- Nunca hagas commit directo a `main`, ni siquiera para un arreglo trivial.
- Mensajes de commit en español, imperativo: `Extrae ms-identidad del monolito`.

---

## Trampas conocidas

**Credenciales del historial anterior sin rotar.** El `JWT_SECRET` y la contraseña de la
base estuvieron versionados en `backend/.env` y en `docker-compose.yml` antes de la
limpieza de historial del 2026-09-06. Ya no están en el repo (`.env` salió del control de
versiones, `docker-compose.yml` usa `${VAR}` — ver `docs/adr/0001`), pero hay que
**rotar ambas**: siguen en clones, forks y en las ramas `jdiaz2`/`jdiaz3` de GitHub.
Pendiente aparte: `backend/src/config/database.js` todavía trae una contraseña por
defecto embebida como *fallback*.

**`sequelize.sync()` en `app.js`.** Crea las tablas al arrancar. Es cómodo en desarrollo
y peligroso en producción. Reemplazar por migraciones versionadas en `database/` antes
de desplegar en Azure.

**El token viaja por query string.** `auth.middleware.js` acepta `?token=` además del
header, para que funcionen las descargas de PDF con `window.open`. Queda registrado en
los logs del servidor y en el historial del navegador. Al pasar a HTTPS en Azure,
reemplazar por URLs firmadas de un solo uso.

**Trazabilidad rota en `financialEngine.js`.** Los comentarios citan RF-14, RF-15 y
RF-16, pero según el SRS esos son requisitos del Dashboard. La generación de recibos es
RF-11 y las alertas de mora son RF-12. Corregir las referencias al tocar el archivo.

**`schema.sql` y los modelos de Sequelize no coinciden del todo.** El schema define
`propietarios` e `inquilinos` como tablas separadas con `id` tipo `VARCHAR(20)`, mientras
el anexo de microservicios habla de `Usuarios` + `RolesUsuario`. Antes de extraer
`ms-identidad` hay que decidir cuál de los dos modelos gana y documentarlo en un ADR.

**El frontend usa Create React App**, que ya no recibe mantenimiento. Migrar a Vite es
barato y acelera el build en CI, pero no es urgente. Hazlo solo si ya estás tocando el
tooling del frontend.

**Tailwind está declarado en el PMP pero no instalado.** Si vas a rehacer estilos,
instálalo; si no, hay que registrar el cambio en el control de configuración.

---

## Qué no hacer

- No reescribas módulos que ya funcionan solo para modernizarlos.
- No agregues dependencias sin necesidad clara: cada una pesa en la imagen Docker y en
  los límites de memoria de Container Apps.
- No introduzcas colas de mensajes, service mesh, Kubernetes ni service discovery. Cinco
  servicios que se hablan por HTTP directo son suficientes y son lo que el anexo
  describe.
- No cambies el SRS ni el PMP por tu cuenta. Son línea base; los cambios pasan por el
  proceso formal de control descrito en la sección 13.3.2 del PMP.
- No borres pruebas para que el build pase.

---

## Documentos de referencia

Viven fuera del repositorio (OneDrive) y son la fuente de verdad sobre requisitos:
Anteproyecto, PMP, SRS, Anexo de Diseño y Especificación de Microservicios, Anexo de
Matriz de Evaluación Tecnológica, Anexo de Mockups UI/UX.

Cuando una decisión técnica se aparte de lo que dice alguno de esos documentos, escribe
un ADR en `docs/adr/` explicando por qué. Eso es lo que después sustenta la defensa.
