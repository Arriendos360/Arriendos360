-- Tabla de salida (outbox) de MS-Financiero — Arriendos360, paso 7
--
-- Con esta, ms-financiero es a la vez CONSUMIDOR y PRODUCTOR del bus, y es el
-- primer servicio del sistema que hace las dos cosas. No es una rareza: recibe
-- `ContratoFormalizado` y crea con él la primera cuenta de cobro, y esa creación
-- es a su vez un hecho de su dominio que otro servicio quiere conocer.
--
-- ── LOS DOS ESCRITOS CAEN EN LA MISMA TRANSACCIÓN, Y ESO NO ES CASUALIDAD ────
--
-- El consumidor de `packages/shared/src/entrada.ts` abre una transacción, anota
-- el `id_evento` en `financiero.eventos_procesados` y ejecuta el manejador
-- dentro. El manejador inserta la cuenta de cobro y registra
-- `CuentaCobroGenerada` en ESTA tabla, en esa misma transacción. Las tres
-- escrituras van al mismo esquema de la misma base, así que o quedan las tres o
-- no queda ninguna.
--
-- La consecuencia práctica es que no puede haber una cuenta de cobro sin su
-- aviso ni un aviso sin su cuenta, ni siquiera si el proceso muere en medio. Lo
-- mismo vale para el cambio a `EN_MORA`: el `UPDATE` del estado y el registro de
-- `CuentaCobroEnMora` van juntos.
--
-- ── POR QUÉ MS-FINANCIERO SE CONVIERTE EN PRODUCTOR ─────────────────────────
--
-- Porque el motor deja de mandar correos. Hasta el paso 7, `procesarContratos` y
-- `procesarPagos` abrían una conexión SMTP y, para conseguir las direcciones,
-- componían contra ms-identidad dentro del barrido. Su propio `config/mailer.ts`
-- lo declaraba provisional y `docs/adr/0018` lo anotaba como deuda del paso 7:
-- «el motor pasará a publicar eventos y será Notificaciones quien decida a quién
-- avisar».
--
-- Esto es ese paso, y de paso le quita al barrido una dependencia HTTP: el motor
-- ya no llama a ms-identidad para nada.
--
-- ── SIN SECRETOS EN EL SOBRE ────────────────────────────────────────────────
--
-- A diferencia de `identidad.eventos_salida`, ninguno de los tres tipos que
-- salen de aquí lleva nada que no pueda quedarse escrito: identificadores,
-- importes, fechas y la dirección del inmueble. Así que el almacén de este
-- servicio NO declara `tiposRedactados` y las filas entregadas conservan su
-- payload, que es lo que permite mirar un aviso cuando alguien discute un cobro.
--
-- Ver `packages/shared/src/salida.ts` y `docs/adr/0019`.

CREATE TABLE IF NOT EXISTS financiero.eventos_salida (
    id_evento          UUID          PRIMARY KEY,
    tipo               VARCHAR(80)   NOT NULL,
    version            INTEGER       NOT NULL,
    ocurrido_en        TIMESTAMPTZ   NOT NULL,
    payload            JSONB         NOT NULL,

    -- Clave de ordenación. Aquí guarda el `id_cuenta_cobro`: los avisos de una
    -- misma cuenta se entregan en el orden en que ocurrieron, porque
    -- «está por vencer» seguido de «entró en mora» cuenta una historia y al revés
    -- cuenta otra. NULL = sin restricción.
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
    ON financiero.eventos_salida (registrado_en, id_evento)
    WHERE estado = 'pendiente';
