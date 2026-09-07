-- Indicador de cambio de contrasena obligatorio.
--
-- Marca a los usuarios que entraron con una contrasena que NO eligieron ellos:
-- hoy, los inquilinos que da de alta su propietario. Mientras este en `true`,
-- el gateway les deniega todo salvo cambiarla.
--
-- DESVIACION DE LA LINEA BASE. El modelo canonico del Capitulo 2 define
-- `Usuarios` con nombres, apellidos, email, contrasena, telefono y documento.
-- Esta columna no esta ahi. Ver docs/adr/0007: debe incorporarse al documento en
-- su proxima revision, por el proceso de la seccion 13.3.2 del PMP.
--
-- Por defecto `false`: quien se autorregistra elige su propia clave y no tiene
-- nada que cambiar.

ALTER TABLE identidad.usuarios
    ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT false;
