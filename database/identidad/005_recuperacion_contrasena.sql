-- Recuperacion de contrasena.
--
-- Dos piezas independientes que resuelven el mismo problema por vias distintas:
-- el usuario que olvido su clave, y el propietario que tiene que reemitir la
-- temporal de un inquilino porque se perdio antes de entregarla.

-- ── Tokens de recuperacion ──────────────────────────────────────────────────
--
-- Se guarda el HASH del token, nunca el token. La razon es la misma por la que
-- no se guardan contrasenas en claro: quien consiga leer esta tabla —una copia
-- de seguridad mal guardada, un volcado en una incidencia— no debe poder
-- restablecer la contrasena de nadie. El token en claro existe una sola vez, en
-- el correo que se envia.
--
-- `usado_en` lo convierte en un solo uso: un enlace ya usado no vuelve a servir
-- aunque no haya vencido. Sin eso, quien tuviera acceso al buzon podria
-- restablecer la contrasena tantas veces como quisiera durante media hora.
CREATE TABLE IF NOT EXISTS identidad.tokens_recuperacion (
    id_token    UUID        PRIMARY KEY,
    -- SHA-256 del token en hexadecimal. Se indexa porque la busqueda al
    -- restablecer es exactamente por aqui.
    hash_token  CHAR(64)    NOT NULL UNIQUE,
    id_usuario  UUID        NOT NULL REFERENCES identidad.usuarios (id_usuario) ON DELETE CASCADE,
    expira_en   TIMESTAMPTZ NOT NULL,
    usado_en    TIMESTAMPTZ,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_recuperacion_usuario
    ON identidad.tokens_recuperacion (id_usuario);

-- ── Invalidacion de sesiones en bloque ──────────────────────────────────────
--
-- Marca de cuando el usuario cambio su contrasena por ultima vez. Todo token
-- emitido ANTES de esta marca deja de valer.
--
-- Es la alternativa barata a revocar `jti` uno por uno: al restablecer una
-- contrasena no se sabe cuantas sesiones hay abiertas ni cuales —justo el
-- escenario que motiva restablecerla, alguien mas dentro de la cuenta— asi que
-- revocar las conocidas no serviria de nada. Una comparacion de fechas las tira
-- todas, incluidas las que nadie sabia que existian.
--
-- DESVIACION DE LA LINEA BASE. El modelo canonico no lista esta columna en
-- `Usuarios`. Ver docs/adr/0010.
ALTER TABLE identidad.usuarios
    ADD COLUMN IF NOT EXISTS contrasena_cambiada_en TIMESTAMPTZ;
