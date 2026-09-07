# database/

Migraciones SQL versionadas, **una carpeta por esquema** (un esquema por servicio sobre
una unica instancia de PostgreSQL). Reemplazan a `sequelize.sync()`; ver
`docs/adr/0003`.

| Carpeta | Esquema | Quien la aplica |
|---|---|---|
| `identidad/` | `identidad` | `services/ms-identidad`, al arrancar |
| `inmuebles/` | `inmuebles` | `services/ms-inmuebles`, al arrancar |
| `dominio/` | `public` | `apps/gateway`, al arrancar |

Cada servicio aplica **solo las suyas**, y la tabla de control
(`<esquema>.migraciones_aplicadas`) vive en su propio esquema: nadie comparte ni
siquiera el registro de que migraciones corrio.

Las carpetas entran en la imagen del servicio por `COPY`, no se montan como volumen.
Tocar un `.sql` exige reconstruir.

## `dominio/` es provisional

Agrupa lo que todavia no tiene servicio propio: contratos, anexos, pagos y abonos. Se
parte en `contratos/` y `financiero/` en el paso 6, y cada carpeta se va con su
servicio.

**Hoy `inmuebles` esta declarada dos veces**: en `dominio/` para el gateway y en
`inmuebles/` para el servicio. Es deliberado y temporal — el servicio ya existe pero el
gateway todavia lee su propia copia. La duplicacion termina cuando el gateway se
desconecte (paso 4b); hasta entonces, la tabla de `inmuebles.inmuebles` esta vacia.

## Escribir una migracion

- Numeradas y en orden: `001_...sql`, `002_...sql`. El orden alfabetico es el de
  ejecucion.
- **Nunca se edita una ya aplicada.** Se agrega otra: la tabla de control las da por
  hechas por nombre y no vuelve a mirarlas.
- Cada una corre en su propia transaccion junto con su registro de control: o se aplica
  entera y queda anotada, o no pasa nada.
- Sin claves foraneas que crucen esquemas (regla dura 1).
