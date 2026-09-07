# Arriendos360

Plataforma web de gestion de arrendamientos para propietarios pequenos y medianos en
Bogota D.C. Proyecto de grado en Ingenieria de Sistemas (UDFJDC).

El repositorio esta en migracion de monolito modular a microservicios. Hoy toda la
logica vive en `apps/gateway` (el antiguo `backend/`); los microservicios se iran
extrayendo a `services/` uno por uno. Ver `CLAUDE.md` para el plan completo.

Pasos completados: 1 (monorepo), 2 (costura de enrutamiento y paquetes) y 3a
(modelo de identidad y capa de autenticacion).

## Estructura

```
Arriendos360/
├─ apps/
│  ├─ web/          React SPA (antes frontend/). Puerto 3000.
│  └─ gateway/      Monolito Express + Sequelize (antes backend/). Puerto 3001.
├─ services/        Microservicios extraidos del monolito (todavia vacio).
├─ packages/
│  ├─ contracts/    DTOs compartidos en TypeScript.
│  └─ shared/       Verificacion de JWT, errores, cliente HTTP.
├─ database/        Migraciones SQL versionadas, una carpeta por esquema.
│  ├─ identidad/    Usuarios, Roles, RolesUsuario, TokensRevocados.
│  └─ dominio/      Inmuebles, Contratos, Pagos, Abonos.
├─ infra/           docker-compose.yml y, mas adelante, Dockerfiles y Bicep de Azure.
├─ docs/            ADRs, coleccion de Postman, notas de verificacion.
└─ package.json     Raiz del monorepo (npm workspaces: apps/*, services/*, packages/*).
```

## Requisitos

- Node.js 18+ y npm 8+ (para workspaces).
- Docker Desktop (para el entorno local completo).

## Desarrollo local

```bash
# Instalar dependencias de todos los workspaces (una vez)
npm install

# Levantar Postgres + gateway + web, igual que antes
docker compose -f infra/docker-compose.yml up --build

# Reinicio limpio, borrando volumenes
docker compose -f infra/docker-compose.yml down -v
```

Necesitas dos archivos `.env` locales (ninguno se versiona; ver `docs/adr/0001`):

- `infra/.env` — lo lee `docker compose` para resolver `${DB_PASSWORD}` y `${JWT_SECRET}`.
  Copialo de `infra/.env.example`.
- `apps/gateway/.env` — lo lee el gateway al correr con `node`/`npm` fuera de Docker.
  Copialo de `apps/gateway/.env.example`.

`DB_PASSWORD` y `JWT_SECRET` deben ser identicos en los dos.

- Web: http://localhost:3000
- API (gateway): http://localhost:3001

## Pruebas

```bash
# Pruebas de un workspace
npm test --workspace=apps/gateway

# Todas las pruebas
npm test --workspaces --if-present
```

Las pruebas del gateway corren con `NODE_ENV=test` contra la base
`arriendos360_test`, que se recrea al inicio de cada suite aplicando las mismas
migraciones que produccion.

## Esquema de la base

El esquema NO lo crea `sequelize.sync()`: son migraciones SQL versionadas en
`database/`, que el gateway aplica al arrancar. Ver `docs/adr/0003`.

```bash
# Aplicar las migraciones pendientes a mano
npm run migrate --workspace=apps/gateway
```

Dentro de Docker las migraciones llegan por volumen (`../database:/database:ro`)
y la ruta se indica con `RUTA_MIGRACIONES=/database`, porque el build del gateway
usa contexto `apps/gateway` y no alcanza la raiz del monorepo.

## Datos de prueba

```bash
npm run seed --workspace=apps/gateway
# o, con el stack levantado:
docker exec arriendos360_api npm run seed
```

Crea tres usuarios, todos con contrasena `Prueba123`:

| Email | Documento | Roles |
|---|---|---|
| `propietario@arriendos360.test` | 10000001 | PROPIETARIO |
| `inquilino@arriendos360.test` | 10000002 | INQUILINO |
| `ambos@arriendos360.test` | 10000003 | PROPIETARIO + INQUILINO |

El tercero existe para ejercitar el caso que el modelo anterior no podia
representar: una misma persona que arrienda un inmueble propio y vive en otro.

## Nota sobre la sesion

El token vive **en memoria** en la SPA, no en `localStorage`. Recargar la pagina
cierra la sesion y devuelve al login: es deliberado (Capitulo 2, Capa 1 del
modulo de seguridad).
