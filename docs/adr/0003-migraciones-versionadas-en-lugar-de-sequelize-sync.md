# ADR 0003 — Migraciones versionadas en lugar de `sequelize.sync()`

- **Fecha:** 2026-09-06
- **Estado:** Aceptada
- **Contexto del paso:** 3a — modelo de identidad y capa de autenticación

## Contexto

Hasta este paso el esquema de la base lo creaba `sequelize.sync()` al arrancar
`app.js`, infiriendo las tablas de los modelos. Las seis suites de prueba hacían
lo mismo con `sequelize.sync({ force: true })`.

Eso funcionaba mientras los identificadores eran `INTEGER AUTOINCREMENT` y no
había columnas que la aplicación tuviera que rellenar. El paso 3a rompe las dos
premisas:

1. **Los identificadores pasan a UUID generados en la aplicación**
   (`crypto.randomUUID()`), no con un `DEFAULT` de la base. La razón está en el
   Capítulo 2: un servicio necesita conocer el ID *antes* de que la fila exista
   para poder publicarlo en el evento que dispara la creación en cadena.
   `sync()` no tiene forma de expresar eso.
2. **Aparecen las cuatro columnas de auditoría** y las referencias lógicas sin
   clave foránea. `sync()` genera las FK a partir de las asociaciones de
   Sequelize, que es justo lo contrario de lo que exige la regla dura 1.

A esto se suma lo que ya era cierto antes: `sync()` en producción es peligroso.
Nunca borra ni altera columnas de forma predecible, así que el esquema real y el
esperado divergen en silencio.

## Decisión

Reemplazar `sequelize.sync()` por migraciones SQL versionadas.

**Reparto entre datos y código:**

- Los `.sql` viven en `database/<esquema>/`, en la raíz del monorepo. Es donde
  CLAUDE.md los ubica y donde el paso 3b podrá llevárselos junto con
  ms-identidad.
- El runner (`apps/gateway/src/database/migraciones.js`) es código y viaja con el
  gateway.

**Dos carpetas de esquema, no una.** CLAUDE.md pedía `database/identidad/`, pero
el paso a UUID toca también inmuebles, contratos, pagos y abonos. Meterlas en la
carpeta de identidad haría que el paso 3b se llevara a ms-identidad tablas que no
le pertenecen. Se abre `database/dominio/` para lo que los pasos 4 y 6 repartirán
entre ms-inmuebles, ms-contratos y ms-financiero.

**Claves foráneas sólo dentro de la futura frontera de servicio.**
`roles_usuario` y `abonos.id_pago` las llevan; el resto son UUID sin constraint.
Declararlo así desde ahora evita un `DROP CONSTRAINT` en cada extracción.

**Control de estado.** Una tabla `migraciones_aplicadas (nombre, aplicada_en)`.
Cada migración corre en su propia transacción junto con su registro: o se aplica
entera y queda anotada, o no pasa nada.

**Pruebas.** `recrearEsquema()` sustituye a `sync({ force: true })`: hace
`DROP SCHEMA public CASCADE` y vuelve a migrar. Sólo funciona con
`NODE_ENV=test`; la guarda es deliberada, porque ese `DROP` contra la base de
desarrollo se lleva por delante una demo entera.

## Consecuencias

**A favor**

- El esquema es explícito, revisable en el PR y reproducible entre entornos.
- Las pruebas ejercitan exactamente el mismo SQL que producción, no una
  aproximación derivada de los modelos.
- Extraer un servicio pasa a ser mover una carpeta de `.sql`.

**En contra**

- Cada cambio de modelo exige escribir la migración a mano. Es el precio, y con
  UUID y auditoría ya no era opcional.
- Los modelos de Sequelize y el SQL pueden divergir: nada los sincroniza
  automáticamente. Las pruebas de integración lo detectan porque corren contra
  el esquema real.

**Deuda conocida**

`database/` no entra en la imagen Docker: el build del gateway usa contexto
`apps/gateway`. Los `.sql` llegan por volumen (`../database:/database:ro`) y la
ruta se configura con `RUTA_MIGRACIONES`. Funciona en desarrollo, donde el código
también entra por volumen, pero **la imagen por sí sola no puede migrar**.

> **Resuelto (2026-09-06).** Esta deuda ya no existe. El **PR de contexto de build**
> movió el build al contexto raíz del monorepo, así que `database/` entra por `COPY` y
> la imagen migra por sí sola. La variable `RUTA_MIGRACIONES`, que era el parche para
> apuntar al volumen, se eliminó: la ruta se resuelve relativa al código y es la misma
> dentro y fuera del contenedor. Se adelantó respecto del paso 8 porque el 3b necesita
> que `ms-identidad` y el gateway compartan la verificación del JWT de
> `packages/shared`, y eso exigía el mismo cambio.

## Alternativas descartadas

- **`sequelize.sync({ alter: true })`.** Sigue sin resolver los UUID generados en
  la aplicación y añade el riesgo de que altere columnas de forma no prevista.
- **`umzug` o `sequelize-cli`.** Una dependencia más y un formato de migración
  propio, a cambio de poco: el runner completo son ~40 líneas de lógica real y
  no hace falta el `down`, porque no hay datos que preservar. CLAUDE.md pide no
  agregar dependencias sin necesidad clara.
- **Migraciones con `down`.** Se descartó por ahora. Revertir el esquema en un
  proyecto sin datos de producción es ceremonia sin beneficio; cuando haya
  despliegue real en Azure, valdrá la pena reconsiderarlo.
