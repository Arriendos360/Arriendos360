# Arriendos360

Plataforma web de gestion de arrendamientos para propietarios pequenos y medianos en
Bogota D.C. Proyecto de grado en Ingenieria de Sistemas (UDFJDC).

El repositorio esta en migracion de monolito modular a microservicios. Hoy toda la
logica vive en `apps/gateway` (el antiguo `backend/`); los microservicios se iran
extrayendo a `services/` uno por uno. Ver `CLAUDE.md` para el plan completo.

## Estructura

```
Arriendos360/
├─ apps/
│  ├─ web/          React SPA (antes frontend/). Puerto 3000.
│  └─ gateway/      Monolito Express + Sequelize (antes backend/). Puerto 3001.
├─ services/        Microservicios extraidos del monolito (todavia vacio).
├─ packages/
│  ├─ contracts/    DTOs compartidos en TypeScript (por implementar).
│  └─ shared/       JWT, errores, logger, cliente HTTP (por implementar).
├─ database/        Migraciones y seeds, una carpeta por esquema (todavia vacio).
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

Las pruebas del gateway corren con `NODE_ENV=test` contra la base `arriendos360_test`.

## Datos de prueba

El gateway trae un script de carga en `apps/gateway/seed.js`:

```bash
node apps/gateway/seed.js
```
