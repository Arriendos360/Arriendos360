-- Cuenta de cobro sin periodo: la indemnización de un contrato terminado no pertenece a
-- ningún periodo de facturación, así que `inicio` y `fin` van los dos en NULL. Una cuenta con
-- periodo sigue siendo única por `(id_contrato, inicio)`; las nulas no chocan en ese índice.
--
-- DESVIACION DE LA LINEA BASE: `inicio` y `fin` admiten NULL (docs/adr/0028). Se incorpora por
-- el proceso de la sección 13.3.2 del PMP.

ALTER TABLE financiero.cuentas_cobro
    ALTER COLUMN inicio DROP NOT NULL,
    ALTER COLUMN fin DROP NOT NULL,
    ADD CONSTRAINT cuentas_cobro_periodo_completo CHECK ((inicio IS NULL) = (fin IS NULL));
