-- Esquema de MS-Inmuebles — Arriendos360
--
-- La tabla sale de `database/dominio/001_esquema_inicial.sql`, donde esperaba a
-- que existiera un servicio que la reclamara. Se copia y NO se mueve: el gateway
-- sigue leyendo su propia copia en `public` hasta el PR que lo desconecta. Los
-- dos esquemas conviven un PR entero, con la de aqui vacia, para que ninguno de
-- los dos quede roto en el intermedio.
--
-- Tres cambios respecto de la version de `dominio`:
--
--   1. `estado_ocupacion` pasa a llamarse `estado`, como en el modelo canonico.
--   2. `tipo_inmueble` pasa a llamarse `tipo` y deja de ser texto libre: el
--      catalogo se cierra con un CHECK. Los valores son los de
--      `packages/contracts/src/inmuebles.ts` y tienen que coincidir; no hay nada
--      que los sincronice solo.
--   3. Todo vive en el esquema `inmuebles`, que es de este servicio y de nadie
--      mas (regla dura 3).
--
-- Claves foraneas: ninguna. `id_propietario` apunta a `identidad.usuarios`, que
-- es de otro servicio, y la regla dura 1 prohibe la FK fisica.

CREATE SCHEMA IF NOT EXISTS inmuebles;

CREATE TABLE IF NOT EXISTS inmuebles.inmuebles (
    id_inmueble          UUID          PRIMARY KEY,
    departamento         VARCHAR(100),
    municipio            VARCHAR(100),
    barrio               VARCHAR(100),
    direccion            VARCHAR(255)  NOT NULL,
    -- Catalogo cerrado. Si agregas un valor aqui, agregalo tambien en
    -- packages/contracts/src/inmuebles.ts: el servicio valida contra esa lista y
    -- rechazaria antes de llegar al CHECK.
    tipo                 VARCHAR(20)   NOT NULL
        CONSTRAINT inmuebles_tipo_valido
        CHECK (tipo IN ('apartamento', 'casa', 'local', 'oficina', 'bodega', 'apartaestudio')),
    area_m2              NUMERIC(10,2),
    habitaciones         INTEGER,
    banos                INTEGER,
    deposito             INTEGER,
    parqueaderos         INTEGER       DEFAULT 0,
    estrato              INTEGER,
    -- Se llamaba `estado_ocupacion`. No lo escribe una persona: lo mueve el
    -- ciclo de vida del contrato, por `/interno`. Ver docs/adr/0011.
    estado               VARCHAR(20)   NOT NULL DEFAULT 'disponible'
        CONSTRAINT inmuebles_estado_valido
        CHECK (estado IN ('disponible', 'arrendado')),
    -- Referencia logica a identidad.usuarios.id_usuario. Sin FK: cruza servicio.
    id_propietario       UUID          NOT NULL,
    creado_por           UUID          NOT NULL,
    fecha_creacion       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_por      UUID          NOT NULL,
    ultima_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- El filtro de pertenencia se aplica en TODAS las consultas del servicio
-- (docs/adr/0005), y el gateway ademas pide la lista de inmuebles de un
-- propietario para resolver sus contratos. Es el indice mas caliente que hay.
CREATE INDEX IF NOT EXISTS idx_inmuebles_propietario
    ON inmuebles.inmuebles (id_propietario);
