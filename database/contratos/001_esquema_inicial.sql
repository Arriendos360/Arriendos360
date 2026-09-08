-- Esquema de MS-Contratos — Arriendos360, paso 6d
--
-- Las dos tablas del servicio, `contratos` y `anexos`, más su tabla de salida.
-- Es la definición de destino: los nombres son ya los del modelo canónico,
-- porque el paso 6a los realineó y el 6b añadió `Anexos` mientras las dos
-- vivían todavía en el esquema del gateway.
--
-- La ADOPCIÓN de las filas que están en `public` la hace `002`. Esta migración
-- solo crea la estructura, y por eso puede correr contra una base nueva sin
-- que exista nada de lo anterior.
--
-- ── QUÉ CLAVES FORÁNEAS HAY, Y POR QUÉ SOLO UNA ─────────────────────────────
--
-- `anexos.id_contrato` la lleva: las dos tablas son de este servicio y viven en
-- este esquema, así que la integridad referencial es del dominio y no una
-- atadura heredada. `contratos.id_inmueble` y `contratos.id_inquilino` NO la
-- llevan: cruzan a ms-inmuebles y a ms-identidad, y la regla dura 1 lo prohíbe.
--
-- ── NO HAY `id_propietario` EN `contratos`, Y ES DELIBERADO ──────────────────
--
-- La cabecera de `anexo.controller.js` recomendaba denormalizarlo aquí para que
-- el ABAC de los anexos quedara local. Se decidió que no: el dueño de un
-- inmueble puede cambiar, y una copia obsoleta de ese dato daría acceso al
-- propietario anterior y se lo negaría al nuevo. La pertenencia se resuelve
-- preguntando a ms-inmuebles, que es quien la sabe. Ver `docs/adr/0017`.

CREATE SCHEMA IF NOT EXISTS contratos;

-- ── Contratos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos.contratos (
    id_contrato            UUID          PRIMARY KEY,

    inicio                 TIMESTAMPTZ   NOT NULL,
    fin                    TIMESTAMPTZ   NOT NULL,
    canon                  NUMERIC(12,2) NOT NULL,

    -- Primera fecha de corte del ciclo de facturación. `DATE` y no
    -- `TIMESTAMPTZ`: es una fecha de calendario, y con hora el día se movería
    -- al leerla en Bogotá. Ver `packages/shared/src/fechas.ts`.
    fecha_inicio_corte     DATE          NOT NULL,

    -- Un DÍA DEL MES, no una fecha. El CHECK es lo que impide que se cuele un
    -- 0, un 32 o el mes en vez del día.
    fecha_limite_pago      INTEGER       NOT NULL
        CONSTRAINT contratos_fecha_limite_pago_valida
        CHECK (fecha_limite_pago BETWEEN 1 AND 31),

    info_contrato          TEXT,

    -- Catálogo CERRADO, compartido con packages/contracts y con el frontend.
    -- Si agregas un valor aquí, agrégalo también allí: nada los sincroniza.
    estado                 VARCHAR(20)   NOT NULL DEFAULT 'activo'
        CONSTRAINT contratos_estado_valido
        CHECK (estado IN ('activo', 'finalizado', 'cancelado')),

    -- Deudor solidario. Opcionales: no todo arriendo tiene codeudor.
    nombre_deudor_solidario    VARCHAR(150),
    documento_deudor_solidario VARCHAR(20),

    -- Referencias lógicas. Sin FK: cruzan a ms-inmuebles y a ms-identidad.
    id_inmueble            UUID          NOT NULL,
    id_inquilino           UUID          NOT NULL,

    creado_por             UUID          NOT NULL,
    fecha_creacion         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por        UUID          NOT NULL,
    ultima_actualizacion   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Los dos filtros que resuelve `/interno/contratos`: «los de estos inmuebles»
-- —la mitad de propietario de la disyunción de pertenencia— y «los de este
-- inquilino», que es la otra mitad.
CREATE INDEX IF NOT EXISTS idx_contratos_inmueble  ON contratos.contratos (id_inmueble);
CREATE INDEX IF NOT EXISTS idx_contratos_inquilino ON contratos.contratos (id_inquilino);

-- El motor financiero barre los activos en cada ciclo, y el guardia de borrado
-- pregunta por los activos de UN inmueble. Parcial porque los finalizados no se
-- consultan por estado y son los que se acumulan.
CREATE INDEX IF NOT EXISTS idx_contratos_activos
    ON contratos.contratos (id_inmueble)
    WHERE estado = 'activo';

-- ── Anexos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos.anexos (
    id_anexo      UUID          PRIMARY KEY,

    -- La referencia que devuelve el almacenamiento, NO una ruta de disco. Con
    -- disco es una ruta relativa a su raíz; con Azure Blob, el nombre del blob.
    archivo_anexo VARCHAR(500)  NOT NULL,

    -- ENUM ABIERTO: el Capítulo 2 enumera CONTRATO_FIRMADO y OTROSI seguidos de
    -- «etc.», así que no lleva CHECK.
    tipo          VARCHAR(50)   NOT NULL,

    -- La única clave foránea del servicio. No cruza esquema.
    id_contrato   UUID          NOT NULL
        REFERENCES contratos.contratos (id_contrato) ON DELETE CASCADE,

    creado_por           UUID        NOT NULL,
    fecha_creacion       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por      UUID        NOT NULL,
    ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anexos_contrato ON contratos.anexos (id_contrato);

-- ── Tabla de salida (outbox) ────────────────────────────────────────────────
--
-- EL PRODUCTOR SE MUDA CON LO QUE PRODUCE. Esta tabla es la misma que el paso 5
-- creó en `public` con `database/dominio/003`, recreada aquí. La de allí se
-- retira en `database/dominio/007`, después de que `002` traiga lo pendiente.
--
-- POR QUÉ NO ES UNA TABLA COMPARTIDA. Cada productor tiene la suya, en su propio
-- esquema. Una tabla común sería un punto de acoplamiento que la regla dura 3
-- prohíbe, y rompería lo único que hace que el patrón funcione: que el evento y
-- el cambio de dominio quepan en la MISMA transacción. Contra una tabla de otro
-- esquema —y mañana de otra base— esa transacción no existe.
--
-- Ver `packages/shared/src/salida.ts` y `docs/adr/0012`.
CREATE TABLE IF NOT EXISTS contratos.eventos_salida (
    id_evento          UUID          PRIMARY KEY,
    tipo               VARCHAR(80)   NOT NULL,
    version            INTEGER       NOT NULL,
    ocurrido_en        TIMESTAMPTZ   NOT NULL,
    payload            JSONB         NOT NULL,

    -- Clave de ordenación. Aquí guarda el `id_inmueble`: ContratoFormalizado y
    -- ContratoFinalizado sobre el mismo inmueble son órdenes contrarias, y
    -- entregarlas al revés lo deja ocupado para siempre. NULL = sin restricción.
    clave_orden        VARCHAR(64),

    estado             VARCHAR(20)   NOT NULL DEFAULT 'pendiente'
        CONSTRAINT eventos_salida_estado_valido
        CHECK (estado IN ('pendiente', 'entregado', 'apartado')),
    intentos           INTEGER       NOT NULL DEFAULT 0,
    proximo_intento_en TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ultimo_error       TEXT,
    entregado_en       TIMESTAMPTZ,
    registrado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_salida_pendientes
    ON contratos.eventos_salida (registrado_en, id_evento)
    WHERE estado = 'pendiente';
