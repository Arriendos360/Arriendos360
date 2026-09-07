-- Roles del catalogo. No son datos de prueba: el servicio no funciona sin ellos,
-- asi que entran como migracion y no como seed.
--
-- Los UUID son fijos y estan replicados como constantes en
-- `src/models/constantes.ts`. Fijarlos evita una consulta por nombre en cada
-- registro y hace reproducible el estado de la base entre entornos. Son los
-- mismos que usaba el monolito, para que los datos existentes sigan casando.

INSERT INTO identidad.roles (id_rol, nombre, descripcion, creado_por, actualizado_por)
VALUES
    ('c84027dc-3334-4e4c-a4a8-73b88a7eaa23', 'PROPIETARIO',
     'Registra inmuebles, firma contratos y cobra canones.',
     '6facbaff-9fcd-4300-9426-e464f45be52d', '6facbaff-9fcd-4300-9426-e464f45be52d'),
    ('29032002-315b-4bcf-8c1c-221616e9eb58', 'INQUILINO',
     'Habita un inmueble bajo contrato y paga el canon.',
     '6facbaff-9fcd-4300-9426-e464f45be52d', '6facbaff-9fcd-4300-9426-e464f45be52d')
ON CONFLICT (id_rol) DO NOTHING;
