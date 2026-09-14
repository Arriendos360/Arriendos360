# MS-Financiero — se construye desde la RAIZ del monorepo, en dos sabores:
#
#   docker build -f services/ms-financiero/Dockerfile --target desarrollo .   # Compose
#   docker build -f services/ms-financiero/Dockerfile --target produccion .   # Azure
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
    --workspace=services/ms-financiero \
    --workspace=packages/contracts \
    --workspace=packages/shared

# `database/financiero` son SUS migraciones: el esquema es suyo y nadie mas lo prepara.
COPY database/financiero/ database/financiero/
COPY services/ms-financiero/ services/ms-financiero/

# ═════════════════════════════════════════════════════════════════ desarrollo
FROM dependencias AS desarrollo

WORKDIR /repo/services/ms-financiero
EXPOSE 3014
CMD ["npm", "run", "dev"]

# ════════════════════════════════════════════════════════════════ compilacion
# `pdfService.js` entra en `dist/` por `allowJs` (`docs/adr/0018`).
FROM dependencias AS compilacion

WORKDIR /repo
# Dependencias de produccion con una instalacion limpia, no con `npm prune`: ver
# `infra/docker/solo-produccion.js`.
COPY infra/docker/solo-produccion.js infra/docker/
RUN npm run build --workspace=services/ms-financiero \
    && rm -rf node_modules apps/*/node_modules services/*/node_modules packages/*/node_modules \
    && node infra/docker/solo-produccion.js services/ms-financiero packages/shared packages/contracts \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p services/ms-financiero/node_modules packages/shared/node_modules packages/contracts/node_modules

# ═════════════════════════════════════════════════════════════════ produccion
# Solo JavaScript compilado y dependencias de produccion. Las migraciones las aplica
# un Job con `node dist/database/aplicar.js`, y el motor otro con
# `node dist/scripts/motor.js` (`docs/adr/0021`).
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
COPY --from=compilacion /repo/database/financiero/              database/financiero/
COPY --from=compilacion /repo/services/ms-financiero/package.json services/ms-financiero/
COPY --from=compilacion /repo/services/ms-financiero/dist/      services/ms-financiero/dist/
COPY --from=compilacion /repo/services/ms-financiero/node_modules/ services/ms-financiero/node_modules/

WORKDIR /repo/services/ms-financiero
USER node
EXPOSE 3014
CMD ["node", "dist/server.js"]
