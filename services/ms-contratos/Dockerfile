# MS-Contratos — se construye desde la RAIZ del monorepo, en dos sabores:
#
#   docker build -f services/ms-contratos/Dockerfile --target desarrollo .   # Compose
#   docker build -f services/ms-contratos/Dockerfile --target produccion .   # Azure
#
# Mismo patron que ms-identidad; las etapas y por que son estas estan en
# `docs/adr/0022`.

# ═══════════════════════════════════════════════════════════════ dependencias
FROM node:18-alpine AS dependencias

WORKDIR /repo

# Manifiestos y paquetes primero, en su propia capa. Se copian los package.json de
# TODOS los workspaces porque npm resuelve el grafo completo contra el lockfile.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json                apps/gateway/
COPY apps/web/package.json                    apps/web/
COPY services/ms-identidad/package.json       services/ms-identidad/
COPY services/ms-inmuebles/package.json       services/ms-inmuebles/
COPY services/ms-contratos/package.json       services/ms-contratos/
COPY services/ms-financiero/package.json      services/ms-financiero/
COPY services/ms-notificaciones/package.json  services/ms-notificaciones/

# `packages/` entra entero y ANTES del `npm ci`: sus `prepare` compilan TypeScript.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=services/ms-contratos \
    --workspace=packages/contracts \
    --workspace=packages/shared

# `database/contratos` son SUS migraciones: el esquema es suyo y nadie mas lo prepara.
COPY database/contratos/ database/contratos/
COPY services/ms-contratos/ services/ms-contratos/

# ═════════════════════════════════════════════════════════════════ desarrollo
FROM dependencias AS desarrollo

WORKDIR /repo/services/ms-contratos
EXPOSE 3013
CMD ["npm", "run", "dev"]

# ════════════════════════════════════════════════════════════════ compilacion
FROM dependencias AS compilacion

WORKDIR /repo
# Dependencias de produccion con una instalacion limpia, no con `npm prune`: ver
# `infra/docker/solo-produccion.js`.
COPY infra/docker/solo-produccion.js infra/docker/
RUN npm run build --workspace=services/ms-contratos \
    && rm -rf node_modules apps/*/node_modules services/*/node_modules packages/*/node_modules \
    && node infra/docker/solo-produccion.js services/ms-contratos packages/shared packages/contracts \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p services/ms-contratos/node_modules packages/shared/node_modules packages/contracts/node_modules

# ═════════════════════════════════════════════════════════════════ produccion
# Solo JavaScript compilado y dependencias de produccion. Las migraciones las aplica
# un Job con `node dist/database/aplicar.js`.
FROM node:18-alpine AS produccion

ENV NODE_ENV=production
WORKDIR /repo

COPY --from=compilacion /repo/package.json ./
COPY --from=compilacion /repo/node_modules/ node_modules/
COPY --from=compilacion /repo/packages/shared/package.json      packages/shared/
COPY --from=compilacion /repo/packages/shared/dist/             packages/shared/dist/
COPY --from=compilacion /repo/packages/shared/node_modules/     packages/shared/node_modules/
COPY --from=compilacion /repo/packages/contracts/package.json   packages/contracts/
COPY --from=compilacion /repo/packages/contracts/dist/          packages/contracts/dist/
COPY --from=compilacion /repo/packages/contracts/node_modules/  packages/contracts/node_modules/
COPY --from=compilacion /repo/database/contratos/               database/contratos/
COPY --from=compilacion /repo/services/ms-contratos/package.json services/ms-contratos/
COPY --from=compilacion /repo/services/ms-contratos/dist/       services/ms-contratos/dist/
COPY --from=compilacion /repo/services/ms-contratos/node_modules/ services/ms-contratos/node_modules/

WORKDIR /repo/services/ms-contratos

# En Azure los anexos van a Blob. La carpeta existe para que la implementacion de disco
# —si faltara la cadena de conexion— falle por configuracion y no por permisos.
RUN mkdir -p almacenamiento && chown node:node almacenamiento

USER node
EXPOSE 3013
CMD ["node", "dist/server.js"]
