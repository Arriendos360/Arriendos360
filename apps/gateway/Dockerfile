# Gateway — se construye desde la RAIZ del monorepo, no desde apps/gateway.
#
#   docker build -f apps/gateway/Dockerfile .
#
# El contexto es la raiz porque el gateway depende de `packages/shared` como
# workspace. Con el contexto acotado a `apps/gateway`, `packages/` quedaba fuera
# del build y la dependencia no se podia declarar sin romper la imagen; de ahi
# venia la implementacion duplicada de la verificacion del JWT. Tambien es lo que
# permite que `database/` entre por COPY en vez de por volumen.

FROM node:18-alpine

WORKDIR /repo

# ---------------------------------------------------------------- dependencias
# Manifiestos y paquetes primero, en su propia capa: mientras no cambien, Docker
# reutiliza el `npm ci` aunque cambie el codigo del gateway. Se copian los
# package.json de TODOS los workspaces porque npm resuelve el grafo completo
# contra el lockfile de la raiz, aunque despues solo instalemos una parte.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json  apps/gateway/
COPY apps/web/package.json      apps/web/
COPY services/ms-identidad/package.json services/ms-identidad/
COPY services/ms-inmuebles/package.json services/ms-inmuebles/
COPY services/ms-contratos/package.json services/ms-contratos/

# `packages/` entra ENTERO, con fuentes y tsconfig, y tiene que entrar ANTES del
# `npm ci`. La razon: los dos paquetes tienen un script `prepare` que compila
# TypeScript, y npm lo ejecuta al instalar un workspace. Si solo estuvieran sus
# package.json, `tsc` no encontraria el tsconfig y la imagen fallaria. Y no vale
# `--ignore-scripts`: en npm 10 esa bandera no alcanza al `prepare` de un
# workspace, comprobado.
COPY packages/ packages/

# `npm ci` (no `npm install`): instala exactamente lo que fija el lockfile y
# falla si estan desincronizados, que es lo que se quiere en una imagen.
# `--include-workspace-root` trae las devDependencies de la raiz, entre ellas
# TypeScript, sin el cual `prepare` no podria compilar.
# Se omite `apps/web` a proposito: react-scripts no pinta nada en esta imagen.
#
# Al terminar, `packages/*/dist` ya existe: lo dejo `prepare`. Por eso no hay un
# paso de compilacion aparte.
RUN npm ci --include-workspace-root \
    --workspace=apps/gateway \
    --workspace=packages/contracts \
    --workspace=packages/shared

# -------------------------------------------------------------------- codigo
# `database/` va DENTRO de la imagen. Antes llegaba por volumen con la variable
# RUTA_MIGRACIONES apuntando a /database, que era un parche: la imagen por si
# sola no podia migrar. Ahora el runner la encuentra en la ruta relativa de
# siempre (../../../../database desde src/database/) y la variable sobra.
COPY database/ database/
COPY apps/gateway/ apps/gateway/

WORKDIR /repo/apps/gateway

EXPOSE 3001

CMD ["npx", "nodemon", "src/app.js"]
