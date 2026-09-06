# ADR 0001 — Parametrizar secretos en docker-compose.yml

- Estado: Aceptada
- Fecha: 2026-09-06

## Contexto

`docker-compose.yml` traía en claro la contraseña de PostgreSQL y el `JWT_SECRET` real.
Esto contradice la regla dura 6 del `CLAUDE.md` ("ningún secreto entra al repositorio") y
dejaba las credenciales en el historial de Git.

Como parte de la limpieza de secretos y del reemplazo del historial por un commit base,
había que quitar esos valores del archivo.

## Decisión

`docker-compose.yml` deja de contener valores de secretos. Ahora referencia variables de
entorno con la sintaxis de interpolación de Compose:

- `POSTGRES_PASSWORD: ${DB_PASSWORD}`
- `DB_PASSWORD=${DB_PASSWORD}`
- `JWT_SECRET=${JWT_SECRET}`

Los valores se resuelven desde el entorno del shell o desde un archivo `.env` en el
directorio de proyecto de Compose (no versionado, cubierto por la regla `.env` del
`.gitignore`). Las llaves esperadas están documentadas en `.env.example`.

**Actualización 2026-09-06 (paso 1 de la migración a monorepo):** al mover el compose a
`infra/docker-compose.yml`, el directorio de proyecto de Compose pasa a ser `infra/`, así
que el archivo de interpolación es `infra/.env` (plantilla en `infra/.env.example`). El
gateway, al correr fuera de Docker, usa `apps/gateway/.env` (plantilla en
`apps/gateway/.env.example`). `DB_PASSWORD` y `JWT_SECRET` deben coincidir en ambos.

## Consecuencias

- `docker compose -f infra/docker-compose.yml up` ya no funciona "out of the box":
  requiere `infra/.env` con `DB_PASSWORD` y `JWT_SECRET` (o esas variables en el
  entorno). Es el comportamiento deseado.
- Compose emite un warning si las variables no están definidas y las sustituye por
  cadena vacía; con `POSTGRES_PASSWORD` vacío el contenedor de Postgres ni siquiera
  arranca.
- Las credenciales que estuvieron versionadas (la contraseña de la base y el
  `JWT_SECRET` anterior) deben rotarse: siguen en clones, forks y en las ramas
  `jdiaz2`/`jdiaz3` de GitHub.
