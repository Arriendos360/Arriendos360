-- Inicio del último periodo de corte que el propietario ya recibió, al registrar un contrato
-- que lleva tiempo corriendo. NULL en un contrato nuevo: se factura desde su primer corte.
--
-- DESVIACION DE LA LINEA BASE: la columna no está en el modelo canónico del Capítulo 2
-- (docs/adr/0029). Se incorpora por el proceso de la sección 13.3.2 del PMP.

ALTER TABLE contratos.contratos
    ADD COLUMN IF NOT EXISTS ultimo_periodo_pagado DATE;
