# Gateway — se construye desde la RAIZ del monorepo, no desde apps/gateway, en dos sabores:
#
#   docker build -f apps/gateway/Dockerfile --target desarrollo .   # Compose
#   docker build -f apps/gateway/Dockerfile --target produccion .   # Azure
#
# El contexto es la raiz porque el gateway depende de `packages/shared` como workspace.
# Es JavaScript (`docs/adr/0002`), asi que no hay compilacion propia: la etapa de
# produccion se diferencia en que no lleva dependencias de desarrollo ni nodemon, y
# arranca con `node`. Ver `docs/adr/0022`.

# ═══════════════════════════════════════════════════════════════ dependencias
FROM node:18-alpine AS dependencias

WORKDIR /repo

# Manifiestos y paquetes primero, en su propia capa: mientras no cambien, Docker
# reutiliza el `npm ci` aunque cambie el codigo del gateway. Se copian los
# package.json de TODOS los workspaces porque npm resuelve el grafo completo contra el
# lockfile de la raiz, aunque despues solo instalemos una parte.
COPY package.json package-lock.json ./
COPY apps/gateway/package.json                apps/gateway/
COPY apps/web/package.json                    apps/web/
COPY services/ms-identidad/package.json       services/ms-identidad/
COPY services/ms-inmuebles/package.json       services/ms-inmuebles/
COPY services/ms-contratos/package.json       services/ms-contratos/
COPY services/ms-financiero/package.json      services/ms-financiero/
COPY services/ms-notificaciones/package.json  services/ms-notificaciones/

# `packages/` entra ENTERO y ANTES del `npm ci`: los dos paquetes tienen un `prepare`
# que compila TypeScript, y npm lo ejecuta al instalar un workspace. `--ignore-scripts`
# no sirve: en npm 10 no alcanza al `prepare` de un workspace, comprobado.
# `--include-workspace-root` trae TypeScript, sin el cual `prepare` no compilaria. Se
# omite `apps/web`: react-scripts no pinta nada en esta imagen.
COPY packages/ packages/

RUN npm ci --include-workspace-root \
    --workspace=apps/gateway \
    --workspace=packages/contracts \
    --workspace=packages/shared

# El gateway NO TIENE TABLAS ni conexion a PostgreSQL desde el paso 6e: no copia
# `database/`. Es un proxy con politicas.
COPY apps/gateway/ apps/gateway/

# ═════════════════════════════════════════════════════════════════ desarrollo
FROM dependencias AS desarrollo

WORKDIR /repo/apps/gateway
EXPOSE 3001
CMD ["npx", "nodemon", "src/app.js"]

# ════════════════════════════════════════════════════════════════ compilacion
# Nada que compilar: solo se quitan las dependencias de desarrollo.
FROM dependencias AS compilacion

WORKDIR /repo
# Dependencias de produccion con una instalacion limpia, no con `npm prune`: ver
# `infra/docker/solo-produccion.js`.
COPY infra/docker/solo-produccion.js infra/docker/
RUN rm -rf node_modules apps/*/node_modules services/*/node_modules packages/*/node_modules \
    && node infra/docker/solo-produccion.js apps/gateway packages/shared packages/contracts \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p apps/gateway/node_modules packages/shared/node_modules packages/contracts/node_modules

# ═════════════════════════════════════════════════════════════════ produccion
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
COPY --from=compilacion /repo/apps/gateway/package.json         apps/gateway/
COPY --from=compilacion /repo/apps/gateway/src/                 apps/gateway/src/
COPY --from=compilacion /repo/apps/gateway/node_modules/        apps/gateway/node_modules/

WORKDIR /repo/apps/gateway
USER node
EXPOSE 3001
CMD ["node", "src/app.js"]
