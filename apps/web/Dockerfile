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
COPY apps/gateway/package.json        apps/gateway/
COPY apps/web/package.json            apps/web/
COPY packages/contracts/package.json  packages/contracts/
COPY packages/shared/package.json     packages/shared/

# Solo el workspace de la SPA: no necesita el gateway ni, por ahora, los
# paquetes compartidos. Cuando la SPA consuma `packages/contracts` para tipar
# sus llamadas, se añade aqui junto con su compilacion.
RUN npm ci --include-workspace-root --workspace=apps/web

# -------------------------------------------------------------------- codigo
COPY apps/web/ apps/web/

WORKDIR /repo/apps/web

# Puerto por defecto de React
EXPOSE 3000

CMD ["npm", "start"]
