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
├─ services/
│  └─ ms-identidad/ Usuarios, roles, autenticacion y revocacion. Puerto 3011.
│                   TypeScript strict, esquema PostgreSQL propio (`identidad`).
├─ packages/
│  ├─ contracts/    DTOs compartidos en TypeScript.
│  └─ shared/       Verificacion de JWT, errores, cliente HTTP.
├─ database/        Migraciones SQL versionadas, una carpeta por esquema.
│  ├─ identidad/    Usuarios, Roles, RolesUsuario, TokensRevocados.
│  └─ dominio/      Inmuebles, Contratos, Pagos, Abonos.
├─ infra/           docker-compose.yml y, mas adelante, Bicep de Azure.
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
- ms-identidad: http://localhost:3011 (el gateway le reenvia /api/auth y /api/usuarios)

`services/ms-identidad/.env` es un tercer archivo local, copiado de
`services/ms-identidad/.env.example`. `DB_PASSWORD` y `JWT_SECRET` deben coincidir
con los del gateway: los dos servicios verifican la misma firma.

## Pruebas

```bash
# Pruebas de un workspace
npm test --workspace=apps/gateway

# Todas: cada servicio contra dobles, sin levantar el stack
npm test --workspaces --if-present

# Caminos criticos contra el stack real (exige `up` previo)
npm run test:integracion
```

Cada servicio prueba su logica contra dobles y contra su propio esquema, asi que
`npm test` corre en segundos y sin Docker. La suite de integracion es corta a
proposito: solo comprueba que el contrato ENTRE servicios sea cierto, que es lo
unico que un doble no puede garantizar. La convencion completa esta en CLAUDE.md.

Las pruebas del gateway corren con `NODE_ENV=test` contra la base
`arriendos360_test`, que se recrea al inicio de cada suite aplicando las mismas
migraciones que produccion.

Ojo: `down -v` borra el volumen y con el la base de pruebas, que Compose no crea
porque solo declara `arriendos360_db`. Despues de un reinicio limpio hay que
recrearla una vez:

```bash
docker exec arriendos360_db psql -U postgres -c "CREATE DATABASE arriendos360_test"
```

## Esquema de la base

El esquema NO lo crea `sequelize.sync()`: son migraciones SQL versionadas en
`database/`, que el gateway aplica al arrancar. Ver `docs/adr/0003`.

```bash
# Aplicar las migraciones pendientes a mano
npm run migrate --workspace=apps/gateway
```

Las migraciones viajan dentro de la imagen: los Dockerfiles construyen desde el
contexto raiz del monorepo y `database/` entra por `COPY`. La ruta se resuelve
relativa al codigo, asi que es la misma dentro y fuera del contenedor.

## Datos de prueba

Los usuarios los siembra ms-identidad, que es su dueno:

```bash
npm run seed --workspace=services/ms-identidad
# o, con el stack levantado:
docker exec arriendos360_identidad npm run seed
```

Crea tres usuarios, todos con contrasena `Prueba123`:

| Email | Documento | Roles |
|---|---|---|
| `propietario@arriendos360.test` | 10000001 | PROPIETARIO |
| `inquilino@arriendos360.test` | 10000002 | INQUILINO |
| `ambos@arriendos360.test` | 10000003 | PROPIETARIO + INQUILINO |

El tercero existe para ejercitar el caso que el modelo anterior no podia
representar: una misma persona que arrienda un inmueble propio y vive en otro.

## Motor financiero

Genera las cuentas de cobro del mes y marca la mora. Corre solo a las 00:01 por
`node-cron`; para una demostracion se puede disparar a mano:

```bash
npm run motor --workspace=apps/gateway
# o, con el stack levantado:
docker exec arriendos360_api npm run motor
```

Antes existia `POST /api/admin/ejecutar-motor`, que se elimino: el motor
pertenece a ms-financiero y no al gateway, y aquel endpoint importaba
`esPropietario` sin aplicarlo, asi que cualquier autenticado podia lanzarlo.

## Control de acceso

El gateway declara una matriz RBAC junto a la costura de enrutamiento
(`apps/gateway/src/routing/matriz.js`) que cruza metodo, ruta y rol. **Deniega por
defecto**: una ruta bajo `/api` que no este declarada responde 403. La matriz se
imprime al arrancar, junto al mapa de prefijos locales y remotos.

## Nota sobre la sesion

El token vive **en memoria** en la SPA, no en `localStorage`. Recargar la pagina
cierra la sesion y devuelve al login: es deliberado (Capitulo 2, Capa 1 del
modulo de seguridad).
