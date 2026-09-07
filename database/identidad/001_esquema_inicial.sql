-- Esquema de identidad — Arriendos360
--
-- Futuro dueño: ms-identidad (paso 3b). Mientras tanto vive en la misma base
-- que el dominio, pero se declara aparte para que extraerlo sea mover archivos
-- y no rehacer el modelo.
--
-- Claves foráneas: SOLO dentro de este esquema. `roles_usuario` referencia a
-- `usuarios` y `roles` porque las tres tablas pertenecen al mismo servicio. Las
-- referencias que cruzan servicios (inmuebles.id_propietario, por ejemplo) son
-- UUID sin constraint — regla dura 1 de CLAUDE.md.

CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario           UUID         PRIMARY KEY,
    nombres              VARCHAR(100) NOT NULL,
    apellidos            VARCHAR(100) NOT NULL,
    email                VARCHAR(150) NOT NULL UNIQUE,
    -- Guarda el hash bcrypt, no la contraseña. El nombre de la columna es el
    -- del modelo canónico del Capítulo 2.
    contrasena           VARCHAR(255) NOT NULL,
    telefono             VARCHAR(15),
    documento            VARCHAR(20)  NOT NULL UNIQUE,
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id_rol               UUID         PRIMARY KEY,
    nombre               VARCHAR(30)  NOT NULL UNIQUE,
    descripcion          VARCHAR(255),
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Muchos a muchos: un usuario puede ser propietario e inquilino a la vez. Es la
-- razón por la que `roles` es un arreglo en los claims del token.
CREATE TABLE IF NOT EXISTS roles_usuario (
    id_rol               UUID         NOT NULL REFERENCES roles (id_rol)       ON DELETE CASCADE,
    id_usuario           UUID         NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
    creado_por           UUID         NOT NULL,
    fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actualizado_por      UUID         NOT NULL,
    ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id_rol, id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_roles_usuario_usuario ON roles_usuario (id_usuario);

-- Tabla operativa de seguridad, no de dominio: por eso no lleva columnas de
-- auditoría. Un `jti` deja de tener efecto cuando `expira_en` queda en el
-- pasado, así que no hace falta barrido programado (Capítulo 2, Revocación).
CREATE TABLE IF NOT EXISTS tokens_revocados (
    jti       UUID        PRIMARY KEY,
    expira_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_revocados_expira ON tokens_revocados (expira_en);
