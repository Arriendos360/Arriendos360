-- Financiero: separación de Cuentas_cobro y Transacciones — Arriendos360, paso 6c
--
-- La migración más delicada del proyecto, y la razón está escrita en CLAUDE.md:
-- «`Cuentas_cobro` y `Transacciones` NO son sinónimos de `Pago` y `Abono`». Una
-- cuenta de cobro es la factura mensual que el sistema genera solo; una
-- transacción es el movimiento de dinero contra esa factura. `pagos` mezclaba
-- las dos cosas —guardaba a la vez el importe facturado y el medio por el que se
-- cobró— y esa mezcla es lo que se deshace aquí.
--
-- TRANSFORMA, NO RECREA, igual que la 004. Cada tabla se renombra, cada columna
-- se renombra o se rellena, y ninguna fila se pierde.
--
-- ── LA TRAMPA DEL MAPEO ──────────────────────────────────────────────────────
--
-- `abonos.tipo_transaccion` NO se convierte en `transacciones.tipo`. El parecido
-- del nombre es una coincidencia: la columna guarda "Transferencia Bancaria",
-- "Efectivo" y "Consignación", que son MEDIOS de pago, no tipos de movimiento.
-- Su destino es `medio_pago`. `tipo` es un campo nuevo, y hoy vale `INGRESO` en
-- todas las filas porque todo lo que el sistema registra es dinero que entra.
--
-- Mapearlo por el nombre habría puesto "Efectivo" en la columna `tipo` y
-- "INGRESO" en ninguna parte, y no lo habría delatado ninguna prueba: sólo se
-- habría visto al imprimir un comprobante y leer «Forma de pago: INGRESO».
--
-- ── EL SALDO DEJA DE GUARDARSE ───────────────────────────────────────────────
--
-- `saldo_pendiente` desaparece sin sustituta. No está en el modelo canónico y no
-- puede estarlo: es la resta entre el valor de la cuenta y lo que se ha cobrado
-- contra ella, y un dato derivado que se guarda es un dato que puede mentir. Se
-- calcula en la respuesta (`services/saldos.js`) y el frontend sigue recibiendo
-- un campo `saldo_pendiente` con el mismo nombre y el mismo significado.
--
-- Antes de borrarlo, el bloque 0 COMPRUEBA que lo guardado y lo derivado
-- coinciden fila a fila. Si no coinciden, la migración aborta y nombra las
-- cuentas descuadradas: sería deriva ya existente en los datos, y borrar la
-- columna la haría desaparecer junto con la prueba de que existió.
--
-- Para verlo antes de migrar, sin escribir nada:
--
--   SELECT p.id_pago, p.monto_total, p.saldo_pendiente,
--          p.monto_total - COALESCE(SUM(a.monto), 0) AS saldo_derivado
--     FROM pagos p LEFT JOIN abonos a ON a.id_pago = p.id_pago
--    GROUP BY p.id_pago, p.monto_total, p.saldo_pendiente
--   HAVING p.saldo_pendiente <> p.monto_total - COALESCE(SUM(a.monto), 0);

-- ── 0. Conciliación previa ───────────────────────────────────────────────────
-- Va PRIMERO y aborta la migración entera si algo no cuadra. Es el equivalente
-- del `SET NOT NULL` sin `ELSE` de la 004: preferimos que reviente con el dato
-- señalado a que se aplique sobre una base que ya estaba mal.
--
-- Todos los abonos que existen hoy pasan a `CONFIRMADA`, así que el saldo
-- derivado de después es exactamente esta misma resta.
DO $$
DECLARE
    descuadradas TEXT;
BEGIN
    SELECT string_agg(
               format('%s (guardado %s, derivado %s)', d.id_pago, d.guardado, d.derivado),
               E'\n  '
           )
      INTO descuadradas
      FROM (
          SELECT p.id_pago,
                 p.saldo_pendiente                            AS guardado,
                 p.monto_total - COALESCE(SUM(a.monto), 0)    AS derivado
            FROM pagos p
            LEFT JOIN abonos a ON a.id_pago = p.id_pago
           GROUP BY p.id_pago, p.monto_total, p.saldo_pendiente
          HAVING p.saldo_pendiente <> p.monto_total - COALESCE(SUM(a.monto), 0)
      ) d;

    IF descuadradas IS NOT NULL THEN
        RAISE EXCEPTION
            'El saldo guardado no cuadra con el derivado de los abonos. Es deriva anterior a esta migracion: hay que decidir cual de los dos manda antes de borrar la columna.%s  %s',
            E'\n', descuadradas;
    END IF;
END $$;

-- ── 1. Las dos tablas cambian de nombre ──────────────────────────────────────
-- `ALTER TABLE ... RENAME` conserva datos, tipos, índices y claves foráneas. La
-- FK de `abonos` hacia `pagos` sobrevive al renombre de las dos: es la única del
-- proyecto junto a la de `anexos`, y sigue sin cruzar frontera de servicio
-- porque `Cuentas_cobro` y `Transacciones` son las dos tablas de ms-financiero.

ALTER TABLE pagos  RENAME TO cuentas_cobro;
ALTER TABLE abonos RENAME TO transacciones;

ALTER TABLE cuentas_cobro RENAME COLUMN id_pago  TO id_cuenta_cobro;
ALTER TABLE transacciones RENAME COLUMN id_abono TO id_transaccion;
ALTER TABLE transacciones RENAME COLUMN id_pago  TO id_cuenta_cobro;

-- Los índices y la restricción de clave primaria conservan el nombre viejo tras
-- un `RENAME TO`. Se renombran también: un `pagos_pkey` sobre una tabla que ya
-- no se llama así es una pista falsa para quien lea el esquema dentro de un año.
ALTER INDEX pagos_pkey         RENAME TO cuentas_cobro_pkey;
ALTER INDEX abonos_pkey        RENAME TO transacciones_pkey;
ALTER INDEX idx_pagos_contrato RENAME TO idx_cuentas_cobro_contrato;
ALTER INDEX idx_abonos_pago    RENAME TO idx_transacciones_cuenta_cobro;

-- La clave foránea también conserva el nombre viejo. Va dentro de un `DO` que
-- comprueba antes: el nombre `abonos_id_pago_fkey` lo puso PostgreSQL al crear
-- la tabla en la 001, y una base que hubiera nacido de otro camino podría
-- tenerla con otro. Un renombre cosmético no puede ser el motivo de que falle
-- una migración de datos.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abonos_id_pago_fkey') THEN
        ALTER TABLE transacciones
            RENAME CONSTRAINT abonos_id_pago_fkey TO transacciones_id_cuenta_cobro_fkey;
    END IF;
END $$;

-- ── 2. Cuentas de cobro: renombres del modelo canónico ───────────────────────
-- `fecha_pago` se queda con su nombre y su significado: el momento en que la
-- cuenta quedó cubierta.

ALTER TABLE cuentas_cobro RENAME COLUMN monto_total TO valor;

-- ── 3. `estado` de la cuenta: de entero sin significado a catálogo cerrado ────
-- El mapa 1/2/3/4 estaba repartido en cuatro sitios del código y en ninguno de
-- la base. OJO al orden, que no es el numérico: 4 es PARCIAL y 3 es EN_MORA.
--
-- Columna aparte y sustitución, como en la 004, para que la traducción quede
-- escrita fila a fila y se pueda leer.

ALTER TABLE cuentas_cobro ADD COLUMN estado_catalogo VARCHAR(20);

UPDATE cuentas_cobro SET estado_catalogo = CASE estado
    WHEN 1 THEN 'PENDIENTE'
    WHEN 2 THEN 'PAGADA'
    WHEN 3 THEN 'EN_MORA'
    WHEN 4 THEN 'PARCIAL'
END;

-- SIN `ELSE`, por lo mismo que en la 004: un estado fuera de {1,2,3,4} deja la
-- celda en NULL y el `SET NOT NULL` de abajo aborta la migración señalando la
-- columna, en vez de inventar un estado por defecto en silencio.
ALTER TABLE cuentas_cobro DROP COLUMN estado;
ALTER TABLE cuentas_cobro RENAME COLUMN estado_catalogo TO estado;

ALTER TABLE cuentas_cobro ALTER COLUMN estado SET DEFAULT 'PENDIENTE';
ALTER TABLE cuentas_cobro ALTER COLUMN estado SET NOT NULL;

-- Si agregas un valor aquí, agrégalo también en packages/contracts/src/
-- financiero.ts: el modelo valida contra esa lista y rechazaría antes de llegar
-- al CHECK. Nada los sincroniza solo.
ALTER TABLE cuentas_cobro ADD CONSTRAINT cuentas_cobro_estado_valido
    CHECK (estado IN ('PENDIENTE', 'PAGADA', 'PARCIAL', 'EN_MORA'));

-- ── 4. El periodo explícito sustituye a `mes_correspondiente` ────────────────
--
-- LA REGLA DEL PERIODO, que a partir de aquí es la del sistema entero y está
-- escrita también en `models/fechasContrato.js`:
--
--   inicio = la fecha de corte del mes que se factura
--   fin    = el día ANTERIOR a la siguiente fecha de corte
--
-- Los periodos así definidos TESELAN el calendario: cada día pertenece a un
-- periodo y sólo a uno, sin huecos ni solapes. Es la propiedad que hace que
-- «¿a qué cuenta de cobro corresponde este día?» tenga siempre una respuesta.
-- Definir `fin` como «un mes menos un día desde el inicio» la rompería en
-- cuanto un mes tuviera 28 días y el siguiente 31.
--
-- `mes_correspondiente` era TIMESTAMPTZ y guardaba justamente la fecha de corte
-- —el motor le metía `fechaObjetivo`— así que `inicio` sale de ella tal cual.
-- `AT TIME ZONE 'UTC'` no es decorativo: sin él, `::date` usaría la zona de la
-- sesión y en Bogotá (UTC-5) devolvería el día anterior. Es la misma corrección
-- que hizo la 004 con `fecha_inicio_corte`.
--
-- `fin` se deriva del propio `inicio` con `+ 1 month - 1 day`, que en PostgreSQL
-- ya recorta al último día del mes (2023-01-31 + 1 month = 2023-02-28). NO se va
-- a buscar el día pactado a `contratos.fecha_limite_pago`, y conviene saber por
-- qué: la fila no guarda el día que se pactó, sólo el que se aplicó, así que
-- para una cuenta cuyo inicio YA venía recortado (un corte el 31 facturado en
-- febrero) el fin derivado se queda corto respecto de lo que calcularía el
-- motor. Afecta sólo a filas históricas y sólo en ese caso; las nuevas las
-- calcula `periodoDeCorte()` con el día pactado del contrato.

ALTER TABLE cuentas_cobro ADD COLUMN inicio DATE;
ALTER TABLE cuentas_cobro ADD COLUMN fin    DATE;

UPDATE cuentas_cobro SET
    inicio = (mes_correspondiente AT TIME ZONE 'UTC')::date,
    fin    = ((mes_correspondiente AT TIME ZONE 'UTC')::date
              + INTERVAL '1 month' - INTERVAL '1 day')::date;

ALTER TABLE cuentas_cobro ALTER COLUMN inicio SET NOT NULL;
ALTER TABLE cuentas_cobro ALTER COLUMN fin    SET NOT NULL;

-- Un periodo que termina antes de empezar es un dato imposible, no un caso raro.
ALTER TABLE cuentas_cobro ADD CONSTRAINT cuentas_cobro_periodo_valido
    CHECK (fin > inicio);

ALTER TABLE cuentas_cobro DROP COLUMN mes_correspondiente;

-- Se busca la cuenta de un contrato por su periodo cada vez que el motor decide
-- si ya la generó. Antes ese `WHERE` era un `date_part` sobre la columna, que no
-- podía usar índice; ahora es una igualdad. ÚNICO, además: dos cuentas de cobro
-- del mismo contrato para el mismo periodo son un cobro duplicado, y la
-- comprobación del motor —leer y después insertar— no basta para impedirlo si
-- alguna vez corren dos barridos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_cobro_contrato_periodo
    ON cuentas_cobro (id_contrato, inicio);

-- ── 5. `detalle`: el concepto de la cuenta ───────────────────────────────────
-- Columna nueva del modelo canónico. Se rellena con el periodo porque es lo que
-- describe a una cuenta de arriendo, y en formato ISO porque un nombre de mes en
-- español dependería de la configuración regional del servidor.
--
-- NO hereda `pagos.observaciones`. Esa columna guardaba una copia de las
-- observaciones del último abono —una referencia de transferencia, no una
-- descripción del cobro— y su sitio es `transacciones.observaciones`, donde ya
-- está y donde se queda. Ver la nota del punto 6.

ALTER TABLE cuentas_cobro ADD COLUMN detalle TEXT;

UPDATE cuentas_cobro
   SET detalle = 'Canon de arrendamiento del ' || inicio || ' al ' || fin;

ALTER TABLE cuentas_cobro ALTER COLUMN detalle SET NOT NULL;

-- ── 6. Lo que se va de la cuenta de cobro ────────────────────────────────────
--
--   * `saldo_pendiente`     — derivado. Ver la cabecera; el bloque 0 acaba de
--     comprobar que lo guardado coincide con lo que se calculará.
--   * `tipo_transaccion`    — se va a `transacciones.medio_pago`, donde el dato
--     ya está: el controlador lo copiaba del abono a la cuenta en cada registro,
--     así que aquí no hay nada que preservar, sólo una duplicación que retirar.
--   * `observaciones`       — misma duplicación, mismo origen. Lo que se lee en
--     el comprobante sale del abono, nunca de aquí.

ALTER TABLE cuentas_cobro DROP COLUMN saldo_pendiente;
ALTER TABLE cuentas_cobro DROP COLUMN tipo_transaccion;
ALTER TABLE cuentas_cobro DROP COLUMN observaciones;

-- ── 7. Transacciones ─────────────────────────────────────────────────────────
--
-- `fecha_abono` → `fecha_pago`: el mismo nombre que en la cuenta de cobro y el
-- que fija el Capítulo 2 para el cuerpo de `POST /api/pagos`.
--
-- `tipo_transaccion` → `medio_pago`: ver la trampa del mapeo, arriba.
--
-- `observaciones` SE QUEDA aunque el modelo canónico no la liste. Es la
-- referencia que imprime el comprobante en «Referencia trans.», y quitarla
-- dejaría ese renglón con un número de transacción autogenerado en lugar del
-- número de la consignación que el arrendatario tiene en su extracto. Ver
-- `docs/adr/0015`.
--
-- `saldo_restante_momento` SE QUEDA y NO se deriva. Es una foto: lo que quedaba
-- por pagar en el instante en que se emitió ese comprobante. Recalcularla
-- cambiaría documentos que alguien ya recibió impresos, que es exactamente lo
-- contrario de lo que sirve un comprobante.

ALTER TABLE transacciones RENAME COLUMN fecha_abono      TO fecha_pago;
ALTER TABLE transacciones RENAME COLUMN tipo_transaccion TO medio_pago;

ALTER TABLE transacciones ADD COLUMN tipo   VARCHAR(20);
ALTER TABLE transacciones ADD COLUMN estado VARCHAR(20);

-- Todo lo registrado hasta hoy es dinero que entró y que sigue en pie: no había
-- forma de anular nada, porque no existía el concepto.
UPDATE transacciones SET tipo = 'INGRESO', estado = 'CONFIRMADA';

ALTER TABLE transacciones ALTER COLUMN tipo   SET DEFAULT 'INGRESO';
ALTER TABLE transacciones ALTER COLUMN estado SET DEFAULT 'CONFIRMADA';
ALTER TABLE transacciones ALTER COLUMN tipo   SET NOT NULL;
ALTER TABLE transacciones ALTER COLUMN estado SET NOT NULL;

ALTER TABLE transacciones ADD CONSTRAINT transacciones_tipo_valido
    CHECK (tipo IN ('INGRESO'));

ALTER TABLE transacciones ADD CONSTRAINT transacciones_estado_valido
    CHECK (estado IN ('CONFIRMADA', 'ANULADA'));

-- `medio_pago` NO lleva CHECK. Es el único catálogo abierto de los cuatro: la
-- columna ya guarda "Transferencia Bancaria", "Efectivo" y "Consignación",
-- puestos por el desplegable de la SPA, y cerrarla contra la lista del documento
-- —que dice `TRANSFERENCIA`— habría hecho fallar esta misma migración.

-- El saldo derivado suma sólo las confirmadas, y siempre las de una cuenta.
CREATE INDEX IF NOT EXISTS idx_transacciones_cuenta_estado
    ON transacciones (id_cuenta_cobro, estado);
