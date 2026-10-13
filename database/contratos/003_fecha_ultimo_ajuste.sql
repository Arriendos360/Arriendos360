-- Fecha del último ajuste del canon por IPC: desde ahí corren los 12 meses del siguiente.
-- NULL si nunca se ha ajustado: entonces se cuenta desde `inicio`.
--
-- DESVIACION DE LA LINEA BASE: la columna no está en el modelo canónico del Capítulo 2
-- (docs/adr/0025). Se incorpora por el proceso de la sección 13.3.2 del PMP.

ALTER TABLE contratos.contratos
    ADD COLUMN IF NOT EXISTS fecha_ultimo_ajuste DATE;
