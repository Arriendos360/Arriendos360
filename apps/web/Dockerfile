# SPA — se construye desde la RAIZ del monorepo, no desde apps/web.
#
#   docker build -f apps/web/Dockerfile .
#
# El contexto es la raiz por coherencia con el gateway y porque el lockfile que
# manda es el de la raiz: npm en modo workspaces ignora los anidados, que este
# mismo PR elimina.

FROM node:18-alpine

WORKDIR /repo

# ---------------------------------------------------------------- dependencias
# Manifiestos primero, en su propia capa. Se copian los de todos los workspaces
# porque npm resuelve el grafo completo contra el lockfile de la raiz.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json          apps/gateway/
COPY apps/web/package.json              apps/web/
COPY services/ms-identidad/package.json services/ms-identidad/
COPY services/ms-inmuebles/package.json services/ms-inmuebles/

# `packages/` entra entero y ANTES del `npm ci`: la SPA ya consume
# `arriendos360-contracts` —el catalogo cerrado de tipos de inmueble— y su
# script `prepare` compila TypeScript, que necesita las fuentes.
COPY packages/ packages/

RUN npm ci --include-workspace-root     --workspace=apps/web     --workspace=packages/contracts

# -------------------------------------------------------------------- codigo
COPY apps/web/ apps/web/

WORKDIR /repo/apps/web

# Puerto por defecto de React
EXPOSE 3000

CMD ["npm", "start"]
