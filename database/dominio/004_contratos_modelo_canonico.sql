-- Contratos: realineación con el modelo canónico — Arriendos360, paso 6a
--
-- TRANSFORMA, NO RECREA. Hay datos de prueba en la base y esto es el ensayo de
-- una migración que en producción no tendría vuelta atrás: `DROP TABLE` +
-- `CREATE TABLE` habría sido más corto de escribir y habría enseñado justamente
-- lo contrario de lo que este paso tiene que demostrar. Cada columna se renombra
-- o se rellena; ninguna fila se pierde.
--
-- Es la última migración de contratos que vive en `database/dominio/`. En el
-- paso 6b la tabla se muda a `database/contratos/` por el mismo camino que
-- siguió Inmuebles: una migración que copia y otra que retira, en ese orden.

-- ── 1. Renombres ─────────────────────────────────────────────────────────────
-- `RENAME COLUMN` conserva los datos, el tipo, los índices y la posición. No es
-- lo mismo que añadir la nueva, copiar y borrar la vieja: eso reescribiría la
-- tabla entera y dejaría una ventana en la que las dos existen.

ALTER TABLE contratos RENAME COLUMN fecha_inicio  TO inicio;
ALTER TABLE contratos RENAME COLUMN fecha_fin     TO fin;
ALTER TABLE contratos RENAME COLUMN valor_mensual TO canon;

-- ── 2. `estado`: de entero sin significado a catálogo cerrado ────────────────
-- La columna guardaba 1, 2 y 3 sin nada en la base que dijera qué eran. El mapa
-- vivía repartido en cuatro sitios del código, uno de ellos un ternario del
-- frontend. Los valores son los de la vieja tabla `estados_contrato` del modelo
-- legado —Activo, Finalizado, Cancelado— en minúsculas, que es la convención del
-- proyecto para catálogos de negocio y lo que ya se hizo con `tipos_inmueble`.
--
-- Se añade una columna aparte y se sustituye, en vez de un `USING` sobre la
-- existente, para que la traducción quede escrita fila a fila y se pueda leer.

ALTER TABLE contratos ADD COLUMN estado_catalogo VARCHAR(20);

UPDATE contratos SET estado_catalogo = CASE estado
    WHEN 1 THEN 'activo'
    WHEN 2 THEN 'finalizado'
    WHEN 3 THEN 'cancelado'
END;

-- SIN `ELSE`. Un estado fuera de {1,2,3} deja la celda en NULL y el `SET NOT
-- NULL` de tres líneas más abajo aborta la migración entera —cada una corre en
-- su propia transacción— con el error de PostgreSQL señalando la columna.
-- Inventar un estado por defecto para que la migración «pase» sería falsificar
-- un dato de negocio en silencio, que es exactamente lo que no se puede hacer
-- cuando esto se ejecute contra datos reales.
ALTER TABLE contratos DROP COLUMN estado;
ALTER TABLE contratos RENAME COLUMN estado_catalogo TO estado;

ALTER TABLE contratos ALTER COLUMN estado SET DEFAULT 'activo';
ALTER TABLE contratos ALTER COLUMN estado SET NOT NULL;

-- Catálogo cerrado en la base. Si agregas un valor aquí, agrégalo también en
-- packages/contracts/src/contratos.ts: el modelo valida contra esa lista y
-- rechazaría antes de llegar al CHECK. Nada los sincroniza solo.
ALTER TABLE contratos ADD CONSTRAINT contratos_estado_valido
    CHECK (estado IN ('activo', 'finalizado', 'cancelado'));

-- ── 3. Columnas nuevas del modelo canónico ───────────────────────────────────

ALTER TABLE contratos
    ADD COLUMN fecha_inicio_corte         DATE,
    ADD COLUMN fecha_limite_pago          INTEGER,
    ADD COLUMN info_contrato              TEXT,
    ADD COLUMN nombre_deudor_solidario    VARCHAR(150),
    ADD COLUMN documento_deudor_solidario VARCHAR(20);

-- Relleno de las filas que ya existen, con la misma regla que aplica el modelo a
-- las nuevas: las dos se derivan del inicio del contrato.
--
-- `AT TIME ZONE 'UTC'` NO es decorativo. `inicio` es TIMESTAMPTZ y el formulario
-- manda "2026-03-31", que se guarda como medianoche UTC. Un `inicio::date` a
-- secas usa la zona de la sesión: en Bogotá (UTC-5) devolvería el 30, y el
-- contrato quedaría con día límite 30 en vez de 31. Así coincide con lo que
-- deriva `fechasContrato.js`, que trabaja en UTC por la misma razón.
UPDATE contratos SET
    fecha_inicio_corte = (inicio AT TIME ZONE 'UTC')::date,
    fecha_limite_pago  = EXTRACT(DAY FROM (inicio AT TIME ZONE 'UTC'))::int;

ALTER TABLE contratos ALTER COLUMN fecha_inicio_corte SET NOT NULL;
ALTER TABLE contratos ALTER COLUMN fecha_limite_pago  SET NOT NULL;

-- Es un día del mes, no una fecha. El CHECK es lo que impide que se cuele un 0,
-- un 32 o el mes en vez del día.
ALTER TABLE contratos ADD CONSTRAINT contratos_fecha_limite_pago_valida
    CHECK (fecha_limite_pago BETWEEN 1 AND 31);

-- Los del deudor solidario se quedan NULL: no todo arriendo tiene codeudor, y
-- los contratos que ya existen desde luego no lo tienen registrado.

-- ── 4. Columnas muertas ──────────────────────────────────────────────────────
-- Se van después de comprobar, en el código y en los datos, que nadie las usa:
--
--   * `deposito`  — no existe en el modelo canónico. Ningún controlador, PDF ni
--     pantalla la escribe o la lee; sólo estaba declarada en el modelo. 0 de 16
--     filas tenían valor. OJO: `inmuebles.deposito` es OTRA columna, cuenta
--     cuartos útiles, está viva y no se toca.
--   * `inventario_fotografico` — tampoco está en el modelo canónico. Lo único
--     que la mencionaba era un bloque de `crear` que parseaba el campo si el
--     cliente lo mandaba; el formulario nunca lo manda. 0 de 16 filas con
--     contenido.
--
-- `url_pdf` SE QUEDA aunque también esté vacía en las 16 filas: el formulario sí
-- la manda y `crear` la escribe cuando adjuntas un PDF. Es el antecesor de
-- `Anexos`, y se va en el paso 6 cuando esa tabla exista de verdad.

ALTER TABLE contratos DROP COLUMN deposito;
ALTER TABLE contratos DROP COLUMN inventario_fotografico;
