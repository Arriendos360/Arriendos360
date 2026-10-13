-- Constancia del preaviso de no renovar el contrato: cuándo, quién (el `sub`), para qué
-- vencimiento y con qué causal del arrendador. NULL mientras nadie lo haya enviado; la
-- causal es NULL también cuando lo envía el inquilino.
--
-- DESVIACION DE LA LINEA BASE: las columnas no están en el modelo canónico del Capítulo 2
-- (docs/adr/0026). Se incorporan por el proceso de la sección 13.3.2 del PMP.

ALTER TABLE contratos.contratos
    ADD COLUMN IF NOT EXISTS preaviso_enviado_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS preaviso_enviado_por UUID,
    ADD COLUMN IF NOT EXISTS preaviso_vencimiento DATE,
    ADD COLUMN IF NOT EXISTS preaviso_causal VARCHAR(30)
        CONSTRAINT contratos_preaviso_causal_valida
        CHECK (preaviso_causal IN
            ('ocupacion_propia', 'demolicion', 'reparaciones', 'compraventa', 'plena_voluntad'));
