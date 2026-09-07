-- Roles del catálogo. No son datos de prueba: la aplicación no funciona sin
-- ellos, así que entran como migración y no como seed.
--
-- Los UUID son fijos y están replicados como constantes en
-- `apps/gateway/src/models/constantes.js`. Fijarlos evita una consulta por
-- nombre en cada registro de usuario y hace reproducible el estado de la base
-- entre entornos.
--
-- `creado_por` apunta al UUID del usuario de sistema, el mismo que el motor
-- financiero usa cuando actúa sin usuario autenticado.

INSERT INTO roles (id_rol, nombre, descripcion, creado_por, actualizado_por)
VALUES
    ('c84027dc-3334-4e4c-a4a8-73b88a7eaa23', 'PROPIETARIO',
     'Registra inmuebles, firma contratos y cobra cánones.',
     '6facbaff-9fcd-4300-9426-e464f45be52d', '6facbaff-9fcd-4300-9426-e464f45be52d'),
    ('29032002-315b-4bcf-8c1c-221616e9eb58', 'INQUILINO',
     'Habita un inmueble bajo contrato y paga el canon.',
     '6facbaff-9fcd-4300-9426-e464f45be52d', '6facbaff-9fcd-4300-9426-e464f45be52d')
ON CONFLICT (id_rol) DO NOTHING;
