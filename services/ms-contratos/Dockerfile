# MS-Contratos — se construye desde la RAIZ del monorepo.
#
#   docker build -f services/ms-contratos/Dockerfile .
#
# Mismo patron que el gateway, ms-identidad y ms-inmuebles: contexto raiz porque
# el servicio depende de `packages/shared` y `packages/contracts` como
# workspaces.

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
COPY services/ms-inmuebles/package.json   services/ms-inmuebles/
COPY services/ms-contratos/package.json   services/ms-contratos/
COPY services/ms-financiero/package.json  services/ms-financiero/
COPY services/ms-notificaciones/package.json services/ms-notificaciones/

# `packages/` entra entero y ANTES del `npm ci`: sus scripts `prepare` compilan
# TypeScript y necesitan las fuentes. `--ignore-scripts` no sirve de atajo, en
# npm 10 no cubre el `prepare` de un workspace y `tsc` corre sin fuentes.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=services/ms-contratos \
    --workspace=packages/contracts \
    --workspace=packages/shared

# -------------------------------------------------------------------- codigo
# `database/contratos` son SUS migraciones: el esquema es suyo y nadie mas lo
# prepara.
COPY database/contratos/ database/contratos/
COPY services/ms-contratos/ services/ms-contratos/

WORKDIR /repo/services/ms-contratos

EXPOSE 3013

CMD ["npm", "run", "dev"]
