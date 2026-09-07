# MS-Identidad — se construye desde la RAIZ del monorepo.
#
#   docker build -f services/ms-identidad/Dockerfile .
#
# Mismo patron que el gateway: contexto raiz porque el servicio depende de
# `packages/shared` y `packages/contracts` como workspaces.

FROM node:18-alpine

WORKDIR /repo

# ---------------------------------------------------------------- dependencias
# Manifiestos y paquetes primero, en su propia capa: mientras no cambien, Docker
# reutiliza el `npm ci` aunque cambie el codigo del servicio. Se copian los
# package.json de TODOS los workspaces porque npm resuelve el grafo completo
# contra el lockfile de la raiz.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json            apps/gateway/
COPY apps/web/package.json                apps/web/
COPY services/ms-identidad/package.json   services/ms-identidad/

# `packages/` entra entero y ANTES del `npm ci`: sus scripts `prepare` compilan
# TypeScript y necesitan las fuentes. Ver el Dockerfile del gateway.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=services/ms-identidad \
    --workspace=packages/contracts \
    --workspace=packages/shared

# -------------------------------------------------------------------- codigo
# Las migraciones del servicio viajan con el: el esquema `identidad` es suyo y
# nadie mas lo prepara.
COPY services/ms-identidad/ services/ms-identidad/

WORKDIR /repo/services/ms-identidad

EXPOSE 3011

# ts-node-dev en desarrollo, igual que nodemon en el gateway. Para produccion
# seria `npm run build && npm start`, que el paso 8 resolvera junto con el resto
# del pipeline.
CMD ["npm", "run", "dev"]
