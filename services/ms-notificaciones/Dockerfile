# MS-Notificaciones — se construye desde la RAIZ del monorepo.
#
#   docker build -f services/ms-notificaciones/Dockerfile .
#
# Mismo patron que los otros cuatro servicios y el gateway: contexto raiz porque
# el servicio depende de `packages/shared` como workspace.
#
# A diferencia de los demas, NO depende de `packages/contracts`: no tiene
# endpoints publicos, asi que no comparte ningun DTO con el frontend. Lo unico que
# habla con el exterior es el sobre del evento, y eso vive en `shared`.

FROM node:18-alpine

WORKDIR /repo

# ---------------------------------------------------------------- dependencias
# Manifiestos y paquetes primero, en su propia capa: mientras no cambien, Docker
# reutiliza el `npm ci` aunque cambie el codigo del servicio. Se copian los
# package.json de TODOS los workspaces porque npm resuelve el grafo completo
# contra el lockfile de la raiz.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json                apps/gateway/
COPY apps/web/package.json                    apps/web/
COPY services/ms-identidad/package.json       services/ms-identidad/
COPY services/ms-inmuebles/package.json       services/ms-inmuebles/
COPY services/ms-contratos/package.json       services/ms-contratos/
COPY services/ms-financiero/package.json      services/ms-financiero/
COPY services/ms-notificaciones/package.json  services/ms-notificaciones/

# `packages/` entra entero y ANTES del `npm ci`: sus scripts `prepare` compilan
# TypeScript y necesitan las fuentes. `--ignore-scripts` no sirve de atajo, en
# npm 10 no cubre el `prepare` de un workspace y `tsc` corre sin fuentes.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=services/ms-notificaciones \
    --workspace=packages/contracts \
    --workspace=packages/shared

# -------------------------------------------------------------------- codigo
# `database/notificaciones` son SUS migraciones: el esquema es suyo y nadie mas lo
# prepara. Son dos tablas y ninguna de dominio — la bitacora de eventos
# procesados y la de envios.
COPY database/notificaciones/ database/notificaciones/
COPY services/ms-notificaciones/ services/ms-notificaciones/

WORKDIR /repo/services/ms-notificaciones

EXPOSE 3015

CMD ["npm", "run", "dev"]
