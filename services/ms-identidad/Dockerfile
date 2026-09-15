# MS-Identidad — se construye desde la RAIZ del monorepo, en dos sabores:
#
#   docker build -f services/ms-identidad/Dockerfile --target desarrollo .   # Compose
#   docker build -f services/ms-identidad/Dockerfile --target produccion .   # Azure
#
# Contexto raiz porque el servicio depende de `packages/shared` y `packages/contracts`
# como workspaces. Las etapas y por que son estas estan en `docs/adr/0022`.

# ═══════════════════════════════════════════════════════════════ dependencias
FROM node:18-alpine AS dependencias

WORKDIR /repo

# Manifiestos y paquetes primero, en su propia capa: mientras no cambien, Docker
# reutiliza el `npm ci` aunque cambie el codigo del servicio. Se copian los
# package.json de TODOS los workspaces porque npm resuelve el grafo completo contra el
# lockfile de la raiz.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json                apps/gateway/
COPY apps/web/package.json                    apps/web/
COPY services/ms-identidad/package.json       services/ms-identidad/
COPY services/ms-inmuebles/package.json       services/ms-inmuebles/
COPY services/ms-contratos/package.json       services/ms-contratos/
COPY services/ms-financiero/package.json      services/ms-financiero/
COPY services/ms-notificaciones/package.json  services/ms-notificaciones/

# `packages/` entra entero y ANTES del `npm ci`: sus scripts `prepare` compilan
# TypeScript y necesitan las fuentes. `--ignore-scripts` no sirve de atajo: en npm 10
# no cubre el `prepare` de un workspace.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=services/ms-identidad \
    --workspace=packages/contracts \
    --workspace=packages/shared

# `database/identidad` son SUS migraciones: el esquema es suyo y nadie mas lo prepara.
COPY database/identidad/ database/identidad/
COPY services/ms-identidad/ services/ms-identidad/

# ═════════════════════════════════════════════════════════════════ desarrollo
# Lo de siempre: ts-node-dev con recarga. Compose monta el codigo encima.
FROM dependencias AS desarrollo

WORKDIR /repo/services/ms-identidad
EXPOSE 3011
CMD ["npm", "run", "dev"]

# ════════════════════════════════════════════════════════════════ compilacion
# Compila a `dist/` y quita las dependencias de desarrollo. Los `mkdir` garantizan que
# existan los `node_modules` locales que copia la etapa siguiente, haya o no alguno.
FROM dependencias AS compilacion

WORKDIR /repo
# Dependencias de produccion con una instalacion limpia, no con `npm prune`: ver
# `infra/docker/solo-produccion.js`.
COPY infra/docker/solo-produccion.js infra/docker/
RUN npm run build --workspace=services/ms-identidad \
    && rm -rf node_modules apps/*/node_modules services/*/node_modules packages/*/node_modules \
    && node infra/docker/solo-produccion.js services/ms-identidad packages/shared packages/contracts \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p services/ms-identidad/node_modules packages/shared/node_modules packages/contracts/node_modules

# ═════════════════════════════════════════════════════════════════ produccion
# Solo JavaScript compilado y dependencias de produccion: arranca con `node`, sin
# compilar nada, que es lo que pesa en un arranque en frio. Las migraciones NO corren
# aqui (`MIGRACIONES_AL_ARRANCAR=no`): las aplica un Job con
# `node dist/database/aplicar.js`, y los datos de demostracion otro con
# `node dist/database/seed.js`.
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
COPY --from=compilacion /repo/database/identidad/               database/identidad/
COPY --from=compilacion /repo/services/ms-identidad/package.json services/ms-identidad/
COPY --from=compilacion /repo/services/ms-identidad/dist/       services/ms-identidad/dist/
COPY --from=compilacion /repo/services/ms-identidad/node_modules/ services/ms-identidad/node_modules/

WORKDIR /repo/services/ms-identidad
USER node
EXPOSE 3011
CMD ["node", "dist/server.js"]
