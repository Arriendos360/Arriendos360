-- Esquema de dominio — Arriendos360
--
-- Reúne las tablas que hoy siguen en el monolito y que los pasos 4 y 6 repartirán
-- entre ms-inmuebles, ms-contratos y ms-financiero. Los nombres de columna de
-- negocio se conservan tal cual están hoy: renombrar `valor_mensual` a `canon` o
-- partir `pagos` en `cuentas_cobro` + `transacciones` es trabajo de esos pasos,
-- no de este. Aquí solo cambian tres cosas:
--
--   1. Todos los identificadores pasan a UUID, generados en la aplicación.
--   2. `id_propietario` e `id_inquilino` dejan de guardar cédulas y guardan el
--      UUID del usuario.
--   3. Cada tabla lleva las cuatro columnas de auditoría.
--
-- Claves foráneas: solo donde el origen y el destino acabarán en el MISMO
-- servicio. `abonos.id_pago` la lleva (ambas van a ms-financiero); las demás no,
-- porque cruzan frontera de servicio y la regla dura 1 las prohíbe. Se declaran
-- así desde ya para que extraer un servicio no exija un DROP CONSTRAINT.

-- ── ms-inmuebles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inmuebles (
    id_inmueble          UUID          PRIMARY KEY,
    departamento         VARCHAR(100),
    municipio            VARCHAR(100),
    barrio               VARCHAR(100),
    direccion            VARCHAR(255)  NOT NULL,
    tipo_inmueble        VARCHAR(50),
    area_m2              NUMERIC(10,2),
    habitaciones         INTEGER,
    banos                INTEGER,
    deposito             INTEGER,
    parqueaderos         INTEGER       DEFAULT 0,
    estrato              INTEGER,
    estado_ocupacion     VARCHAR(20)   DEFAULT 'disponible',
    -- Referencia lógica a usuarios.id_usuario. Sin FK: cruza a ms-identidad.
    id_propietario       UUID          NOT NULL,
    creado_por           UUID          NOT NULL,
    fecha_creacion       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por      UUID          NOT NULL,
    ultima_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inmuebles_propietario ON inmuebles (id_propietario);

-- ── ms-contratos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos (
    id_contrato            UUID          PRIMARY KEY,
    fecha_inicio           TIMESTAMPTZ   NOT NULL,
    fecha_fin              TIMESTAMPTZ   NOT NULL,
    valor_mensual          NUMERIC(12,2) NOT NULL,
    deposito               NUMERIC(12,2),
    estado                 INTEGER       DEFAULT 1,
    url_pdf                VARCHAR(500),
    inventario_fotografico JSON          DEFAULT '[]',
    -- Referencias lógicas. Sin FK: cruzan a ms-inmuebles y a ms-identidad.
    id_inmueble            UUID          NOT NULL,
    id_inquilino           UUID          NOT NULL,
    creado_por             UUID          NOT NULL,
    fecha_creacion         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por        UUID          NOT NULL,
    ultima_actualizacion   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contratos_inmueble  ON contratos (id_inmueble);
CREATE INDEX IF NOT EXISTS idx_contratos_inquilino ON contratos (id_inquilino);

-- ── ms-financiero ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos (
    id_pago              UUID          PRIMARY KEY,
    fecha_pago           TIMESTAMPTZ,
    monto_total          NUMERIC(12,2) NOT NULL,
    saldo_pendiente      NUMERIC(12,2) DEFAULT 0,
    mes_correspondiente  TIMESTAMPTZ   NOT NULL,
    estado               INTEGER       DEFAULT 1,
    tipo_transaccion     VARCHAR(50),
    observaciones        TEXT,
    -- Referencia lógica. Sin FK: cruza a ms-contratos.
    id_contrato          UUID          NOT NULL,
    creado_por           UUID          NOT NULL,
    fecha_creacion       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por      UUID          NOT NULL,
    ultima_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_contrato ON pagos (id_contrato);

CREATE TABLE IF NOT EXISTS abonos (
    id_abono                UUID          PRIMARY KEY,
    monto                   NUMERIC(12,2) NOT NULL,
    fecha_abono             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    tipo_transaccion        VARCHAR(50),
    observaciones           TEXT,
    saldo_restante_momento  NUMERIC(12,2) NOT NULL,
    -- Sí lleva FK: `abonos` y `pagos` acaban las dos en ms-financiero.
    id_pago                 UUID          NOT NULL REFERENCES pagos (id_pago) ON DELETE CASCADE,
    creado_por              UUID          NOT NULL,
    fecha_creacion          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por         UUID          NOT NULL,
    ultima_actualizacion    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abonos_pago ON abonos (id_pago);
