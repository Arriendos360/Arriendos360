# Gateway — se construye desde la RAIZ del monorepo, no desde apps/gateway.
#
#   docker build -f apps/gateway/Dockerfile .
#
# El contexto es la raiz porque el gateway depende de `packages/shared` como
# workspace. Con el contexto acotado a `apps/gateway`, `packages/` quedaba fuera
# del build y la dependencia no se podia declarar sin romper la imagen; de ahi
# venia la implementacion duplicada de la verificacion del JWT.

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
COPY services/ms-financiero/package.json services/ms-financiero/
COPY services/ms-notificaciones/package.json services/ms-notificaciones/

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
# AQUI SE COPIABA `database/`. Ya no: desde el paso 6e el gateway NO TIENE
# TABLAS ni conexion a PostgreSQL, asi que no tiene migraciones que aplicar.
# `database/dominio/` —la carpeta que este COPY servia— desaparecio con las dos
# ultimas, que se fueron a `database/financiero/` con ms-financiero.
#
# La imagen del gateway ya no necesita ni el cliente de base de datos: es un
# proxy con politicas.
COPY apps/gateway/ apps/gateway/

WORKDIR /repo/apps/gateway

EXPOSE 3001

CMD ["npx", "nodemon", "src/app.js"]
