# services/

Aqui viven los microservicios a medida que se van extrayendo del monolito
(`apps/gateway`). Todavia no hay ninguno: el paso 1 de la migracion solo reorganiza
la estructura.

Orden de extraccion previsto (ver `CLAUDE.md`):

1. `ms-identidad` — puerto 3011
2. `ms-inmuebles` — puerto 3012
3. `ms-contratos` — puerto 3013
4. `ms-financiero` — puerto 3014
5. `ms-notificaciones` — puerto 3015

Cada servicio sera su propio workspace (`services/*` en el `package.json` raiz) con su
`package.json`, `Dockerfile`, `tsconfig.json` y `tests/`.
