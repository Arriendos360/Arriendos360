-- Alias, ciudad y descripción del inmueble.
--
-- `municipio` pasa a llamarse `ciudad`. `alias` es obligatorio: los inmuebles que
-- ya existen reciben su dirección como alias inicial. `descripcion` es opcional.

ALTER TABLE inmuebles.inmuebles RENAME COLUMN municipio TO ciudad;

ALTER TABLE inmuebles.inmuebles ADD COLUMN alias VARCHAR(100);
UPDATE inmuebles.inmuebles SET alias = LEFT(direccion, 100) WHERE alias IS NULL;
ALTER TABLE inmuebles.inmuebles ALTER COLUMN alias SET NOT NULL;

ALTER TABLE inmuebles.inmuebles ADD COLUMN descripcion TEXT;
