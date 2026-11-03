-- Un correo por cuenta, sin distinguir mayúsculas. Ver `docs/adr/0030`.
--
-- Sólo añade: no reescribe filas, y el correo se sigue guardando como se escribió.
-- Falla si ya hay dos cuentas que sólo difieren en mayúsculas: hay que resolverlas antes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_sin_mayusculas
    ON identidad.usuarios (lower(email));
