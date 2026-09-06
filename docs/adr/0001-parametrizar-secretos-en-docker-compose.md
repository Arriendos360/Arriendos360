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

Los valores se resuelven desde el entorno del shell o desde un archivo `.env` en la raíz
del repositorio (no versionado, cubierto por la regla `.env` del `.gitignore`). Las
llaves esperadas están documentadas en `backend/.env.example`.

## Consecuencias

- `docker compose up` ya no funciona "out of the box": requiere que `DB_PASSWORD` y
  `JWT_SECRET` estén definidas en el entorno o en un `.env` de la raíz. Es el
  comportamiento deseado.
- Compose emite un warning si las variables no están definidas y las sustituye por
  cadena vacía; conviene definir un `.env` local a partir de las llaves de
  `backend/.env.example`.
- Las credenciales que estuvieron versionadas (la contraseña de la base y el
  `JWT_SECRET` anterior) deben rotarse: siguen en clones, forks y en las ramas
  `jdiaz2`/`jdiaz3` de GitHub.
