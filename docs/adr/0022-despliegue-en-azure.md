# ADR 0022 — Despliegue en Azure

- **Estado:** borrador. Se cierra en el corte 7 del plan con las mediciones reales.
- **Fecha:** 2026-09-14
- **Paso:** 8 (despliegue). El plan por cortes está en CLAUDE.md, «Despliegue en Azure».
- **Se aparta del Capítulo 2:** no. Resuelve cómo se despliega lo que el documento
  especifica.

## Contexto

Los cinco servicios y el gateway corrían sólo en Compose, con imágenes de desarrollo
—ts-node-dev y nodemon, de 354 a 437 MB con dependencias de desarrollo— que además
aplicaban sus migraciones al arrancar. En Azure Container Apps eso no sirve: con escala
a cero la imagen se descarga y arranca en frío, y con varias réplicas varias migrarían a
la vez.

## Decisiones

### Topología

| Tema | Decisión |
|---|---|
| Región | `mexicocentral` si Container Apps y sus Jobs están disponibles; si no, `brazilsouth` (~60 % más cara en cómputo). |
| Cómputo | Un entorno de Container Apps en plan de consumo. `gateway` con ingreso externo y sólo HTTPS; los cinco servicios con ingreso interno. Escala a cero en todos. |
| TLS | Lo termina el ingreso del gateway, con certificado administrado: es la terminación que pide el módulo de seguridad, sin gestionar certificados. `PROXY_SALTOS_CONFIANZA=1`. |
| SPA | Azure Static Web Apps Free, nuevo, con región de metadatos `eastus2` (no se ofrece en `mexicocentral`). Sólo estáticos; la API entra únicamente por el gateway. |
| Base | PostgreSQL Flexible Server B1ms, TLS obligatorio, acceso público restringido a servicios de Azure. **Riesgo aceptado**: la red privada es más coherente con confianza cero y queda como decisión abierta. |
| Secretos | Key Vault, con referencias resueltas por identidad administrada. Ningún valor en el Bicep ni en el repo. |
| Imágenes | GHCR privado. |
| Correo | **Temporal:** Gmail personal por SMTP 587 con contraseña de aplicación en Key Vault. Azure bloquea el 25 pero no el 587 autenticado. |

### Imágenes: una etapa de desarrollo y otra de producción

Cada Dockerfile tiene `dependencias` → `desarrollo` (lo que usa Compose, igual que antes)
→ `compilacion` (compila TypeScript y quita las dependencias de desarrollo con
`npm prune --omit=dev`) → `produccion` (sólo `dist/`, dependencias de producción, usuario
`node`, arranque con `node`). Compose fija `target: desarrollo`.

Los procesos auxiliares salen compilados de la misma imagen: `node dist/database/aplicar.js`,
`node dist/database/seed.js`, `node dist/scripts/motor.js` y `node dist/scripts/enviar.js`.

Las dependencias de producción salen de una **instalación limpia**, no de `npm prune`. En
npm 10, `npm prune --omit=dev --workspace=…` conserva lo que el lockfile trae de los demás
workspaces —typescript, ts-node, jest, babel—: la imagen de ms-identidad llevaba 96 MB de
`node_modules` en vez de 30. `infra/docker/solo-produccion.js` reduce la raíz a los
workspaces de la imagen y quita los `prepare` (compilan con TypeScript, que ya no está)
antes de `npm install --omit=dev`. De paso, `nodemon` pasó a dependencia de desarrollo del
gateway.

### Migraciones: fuera del arranque

- `MIGRACIONES_AL_ARRANCAR`, obligatoria: `si` en Compose y local, `no` en Azure. Con `no`
  el servicio comprueba `migracionesPendientes()` —sin escribir— y **no arranca** si queda
  alguna.
- En Azure las aplica un Job manual por servicio, lanzado por el pipeline **antes** de
  publicar la revisión nueva. Cada Job migra sólo su esquema (regla dura 3).
- El runner toma un bloqueo consultivo de PostgreSQL por esquema dentro de la transacción
  de cada migración, y comprueba ahí si ya está anotada. Dos procesos migrando a la vez —un
  reintento, dos despliegues— se serializan: el segundo espera y la salta.
- Una migración tiene que ser compatible con la revisión que sigue corriendo mientras se
  publica la nueva.

### Conexión a PostgreSQL

- `DB_SSL=si` activa TLS verificando el certificado.
- `DB_POOL_MAX` fija el pool por réplica: B1ms admite 35 conexiones de usuario para los
  cinco servicios y sus Jobs, así que en Azure son 3.

### Gateway y SPA ante el arranque en frío

- `PROXY_TIMEOUT_MS` sube el límite del proxy —10 s por defecto— para no devolver 502 a
  una petición que espera a un servicio que está despertando. En Azure, 60 s.
- `CORS_ORIGENES` limita los orígenes al de la SPA. Sin ella, cualquiera, como en desarrollo.
- El login de la SPA reintenta ante un 502, 503 o 504, o si no hay respuesta, y avisa de
  que el servicio está despertando.

## Mediciones del corte 1 (local, Docker Desktop)

| Imagen | Compose hoy | `produccion` en disco | `produccion` a descargar |
|---|---|---|---|
| gateway | 354 MB | 188 MB | 45 MB |
| ms-identidad | 386 MB | 217 MB | 48 MB |
| ms-inmuebles | 386 MB | 216 MB | 48 MB |
| ms-contratos | 437 MB | 261 MB | 53 MB |
| ms-financiero | 426 MB | 248 MB | 54 MB |
| ms-notificaciones | 388 MB | 217 MB | 48 MB |

«A descargar» es el contenido comprimido, lo que baja una réplica nueva; la etapa
`desarrollo` equivalente baja ~80 MB. ms-contratos y ms-financiero pesan más por el SDK de
Blob y la generación de PDF.

- **Arranque hasta escuchar**, de `docker run` al log, tres veces cada uno: ms-identidad
  ~590 ms en producción frente a ~1,2–1,4 s con ts-node-dev; gateway ~580 ms frente a
  ~1,0 s con nodemon.
- **Primer login con gateway e identidad arrancando a la vez**: 200 a los 1,8 s de crear los
  dos contenedores. En local no hay descarga de imagen ni base remota: el número de Azure
  se mide en el corte 4.
- **Migraciones**: con `MIGRACIONES_AL_ARRANCAR=no` y la base vacía, la imagen sale con 1 y
  lista las siete pendientes. Dos `aplicar.js` lanzados a la vez aplican cada migración una
  sola vez —el segundo termina «sin migraciones pendientes»— y un tercero no hace nada.

## Pendiente de medir (corte 4)

- Tiempo del primer login en Azure con todo escalado a cero.
- Costo real de las primeras semanas, y si PostgreSQL entra en la oferta gratuita.

## Consecuencias

- Quien arranque un servicio en local con `npm run dev` añade `MIGRACIONES_AL_ARRANCAR=si`
  a su `.env`.
- Una base atrasada ya no se arregla sola al desplegar: el servicio se niega a arrancar y
  dice qué migraciones faltan. Es a propósito.
