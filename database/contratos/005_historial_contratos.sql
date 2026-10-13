-- Historial de cambios de un contrato (RF-09): una fila por campo editable o estado que cambia,
-- con el valor anterior, el nuevo, cuándo y quién. Una cancelación guarda además el motivo y la
-- indemnización. Sólo se agrega: las filas no se modifican ni se borran, así que no lleva
-- `ultima_actualizacion` ni `actualizado_por`; `cambiado_en` y `cambiado_por` son su auditoría.
--
-- DESVIACION DE LA LINEA BASE: tabla de dominio fuera de las ocho canónicas del Capítulo 2
-- (docs/adr/0027). Se incorpora por el proceso de la sección 13.3.2 del PMP.

CREATE TABLE IF NOT EXISTS contratos.historial_contratos (
    id_historial UUID PRIMARY KEY,

    -- Dentro del mismo esquema. Sin borrado en cascada: la historia no se pierde con el contrato.
    id_contrato UUID NOT NULL
        REFERENCES contratos.contratos (id_contrato),

    campo VARCHAR(40) NOT NULL,

    -- En texto, como se muestran: fechas `YYYY-MM-DD` y el canon como el decimal de su columna.
    valor_anterior TEXT,
    valor_nuevo    TEXT,

    -- Espejo de `MOTIVOS_CANCELACION` en packages/contracts.
    motivo VARCHAR(40)
        CONSTRAINT historial_contratos_motivo_valido
        CHECK (motivo IN ('mutuo_acuerdo', 'incumplimiento_inquilino', 'incumplimiento_propietario',
                          'unilateral_inquilino', 'unilateral_propietario')),
    indemnizacion NUMERIC(12, 2),
    indemnizacion_a_cargo_de VARCHAR(12)
        CONSTRAINT historial_contratos_a_cargo_de_valido
        CHECK (indemnizacion_a_cargo_de IN ('INQUILINO', 'PROPIETARIO')),

    cambiado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cambiado_por UUID        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_historial_contratos_contrato
    ON contratos.historial_contratos (id_contrato, cambiado_en DESC);
