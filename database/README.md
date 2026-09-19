# database/

Migraciones SQL versionadas, **una carpeta por esquema** (un esquema por servicio sobre
una unica instancia de PostgreSQL). Reemplazan a `sequelize.sync()`; ver
`docs/adr/0003`.

| Carpeta | Esquema | Quien la aplica |
|---|---|---|
| `identidad/` | `identidad` | `services/ms-identidad` |
| `inmuebles/` | `inmuebles` | `services/ms-inmuebles` |
| `contratos/` | `contratos` | `services/ms-contratos` |
| `financiero/` | `financiero` | `services/ms-financiero` |
| `notificaciones/` | `notificaciones` | `services/ms-notificaciones` |

**Cuándo:** en Compose, cada servicio al arrancar (`MIGRACIONES_AL_ARRANCAR=si`). En
Azure, un Job `migrar-*` por servicio antes de publicar revisiones; el servicio arranca
con `MIGRACIONES_AL_ARRANCAR=no` y no levanta si queda alguna pendiente. Ver
`docs/despliegue.md`.

Cada servicio aplica **solo las suyas**, y la tabla de control
(`<esquema>.migraciones_aplicadas`) vive en su propio esquema: nadie comparte ni
siquiera el registro de que migraciones corrio.

Las carpetas entran en la imagen del servicio por `COPY`, no se montan como volumen.
Tocar un `.sql` exige reconstruir.

## `dominio/` ya no existe

Agrupaba lo que todavia no tenia servicio propio —inmuebles, contratos, anexos, pagos y
abonos— y la aplicaba el gateway contra `public`. Se fue vaciando carpeta a carpeta y
**desaparecio en el paso 6e**, con las dos ultimas tablas.

Con ella se fue tambien el aplicador de migraciones del gateway: **el gateway no tiene
tablas ni conexion a PostgreSQL**. La unica tabla que queda en `public` es su vieja
`migraciones_aplicadas`, inerte, que ningun proceso vuelve a mirar.

## Las mudanzas: copiar y retirar

Cada extraccion tuvo que mover filas de `public` al esquema del servicio nuevo. El
patron fue **una migracion que copia y otra que retira**, en ese orden, con Compose
garantizandolo: el gateway esperaba al healthcheck del servicio, que solo responde
despues de migrar.

| Paso | Copia | Retira |
|---|---|---|
| 4b | `inmuebles/002` | `dominio/002` |
| 6d | `contratos/002` | `dominio/007` |
| 6e | `financiero/002` — **las dos cosas** | — |

La ultima rompe el patron a proposito, y no por comodidad: al irse estas tablas el
gateway pierde su aplicador de migraciones, asi que no queda ningun proceso capaz de
aplicar la retirada por separado. Juntarlas resulta ademas mas seguro —el runner
envuelve cada migracion en una transaccion, asi que copia y retirada son atomicas— sin
renunciar a la comprobacion fila a fila antes de borrar. Ver `docs/adr/0018`.

## Escribir una migracion

- Numeradas y en orden: `001_...sql`, `002_...sql`. El orden alfabetico es el de
  ejecucion.
- **Nunca se edita una ya aplicada.** Se agrega otra: la tabla de control las da por
  hechas por nombre y no vuelve a mirarlas.
- Cada una corre en su propia transaccion junto con su registro de control: o se aplica
  entera y queda anotada, o no pasa nada.
- Sin claves foraneas que crucen esquemas (regla dura 1). Las dos unicas FK fisicas del
  proyecto —`anexos` -> `contratos` y `transacciones` -> `cuentas_cobro`— son internas a
  su servicio.
- Los catalogos cerrados llevan `CHECK`, y **si agregas un valor hay que tocarlo tambien
  en `packages/contracts`**: el modelo valida contra esa lista y rechazaria antes de
  llegar al `CHECK`. Nada los sincroniza solo.
