-- Esquema de MS-Identidad.
--
-- Vive en un esquema PostgreSQL propio, `identidad`, dentro de la misma
-- instancia (y por ahora la misma base) que el resto. La frontera no es
-- decorativa: al usuario de este servicio se le puede conceder `identidad` y
-- revocarle `public`, con lo que el aislamiento de la regla dura 3 deja de ser
-- una convencion y pasa a ser algo que la base impone.
--
-- Claves foraneas: SOLO dentro de este esquema. `roles_usuario` referencia a
-- `usuarios` y `roles` porque las tres tablas son de este servicio. Las
-- referencias desde fuera (inmuebles.id_propietario, contratos.id_inquilino)
-- son UUID sin constraint y viven en el otro esquema.

CREATE SCHEMA IF NOT EXISTS identidad;

CREATE TABLE IF NOT EXISTS identidad.usuarios (
    id_usuario           UUID         PRIMARY KEY,
    nombres              VARCHAR(100) NOT NULL,
    apellidos            VARCHAR(100) NOT NULL,
    email                VARCHAR(150) NOT NULL UNIQUE,
    -- Guarda el hash bcrypt, no la contrasena. El nombre de la columna es el
    -- del modelo canonico del Capitulo 2.
    contrasena           VARCHAR(255) NOT NULL,
    telefono             VARCHAR(15),
    documento            VARCHAR(20)  NOT NULL UNIQUE,
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identidad.roles (
    id_rol               UUID         PRIMARY KEY,
    nombre               VARCHAR(30)  NOT NULL UNIQUE,
    descripcion          VARCHAR(255),
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Muchos a muchos: un usuario puede ser propietario e inquilino a la vez. Es la
-- razon por la que `roles` es un arreglo en los claims del token.
CREATE TABLE IF NOT EXISTS identidad.roles_usuario (
    id_rol               UUID         NOT NULL REFERENCES identidad.roles (id_rol)        ON DELETE CASCADE,
    id_usuario           UUID         NOT NULL REFERENCES identidad.usuarios (id_usuario) ON DELETE CASCADE,
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id_rol, id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_roles_usuario_usuario ON identidad.roles_usuario (id_usuario);

-- Tabla operativa de seguridad, no de dominio: por eso no lleva columnas de
-- auditoria. Un `jti` deja de tener efecto cuando `expira_en` queda en el
-- pasado, asi que no hace falta barrido programado.
CREATE TABLE IF NOT EXISTS identidad.tokens_revocados (
    jti       UUID        PRIMARY KEY,
    expira_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_revocados_expira ON identidad.tokens_revocados (expira_en);
