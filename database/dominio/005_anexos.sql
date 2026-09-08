-- Anexos — Arriendos360, paso 6b
--
-- La octava tabla del modelo canónico, y la última que le faltaba a Contratos.
-- Sustituye a `contratos.url_pdf`, que era un solo archivo por contrato y una
-- ruta de disco escrita a mano.
--
-- Ver `docs/adr/0014` para dónde acaban los archivos.

CREATE TABLE IF NOT EXISTS anexos (
    id_anexo     UUID          PRIMARY KEY,

    -- La referencia que devuelve el almacenamiento, NO una ruta de disco.
    -- Con la implementación de disco es una ruta relativa a su raíz; con Azure
    -- Blob es el nombre del blob dentro del contenedor. Quien la lee no tiene
    -- que saber cuál de las dos es: se la pasa al almacenamiento y punto.
    --
    -- 500 porque un nombre de blob en Azure puede llegar a 1024 bytes, pero los
    -- que genera este sistema son `contratos/<uuid>/<uuid>.pdf`, unos 60.
    archivo_anexo VARCHAR(500) NOT NULL,

    -- ENUM ABIERTO, a diferencia de `inmuebles.tipo`. El Capítulo 2 enumera
    -- CONTRATO_FIRMADO y OTROSI "etc.", así que la lista no está cerrada y NO
    -- lleva CHECK: un otrosí de una modalidad que nadie previó no puede quedar
    -- bloqueado por una migración. Los valores conocidos viven en
    -- packages/contracts como sugerencia, no como catálogo.
    tipo         VARCHAR(50)   NOT NULL,

    -- CLAVE FORÁNEA DE VERDAD, y es la única del proyecto junto a la de abonos.
    -- La regla dura 1 prohíbe las FK entre esquemas; ésta no cruza ninguno:
    -- `Anexos` y `Contratos` son las dos tablas de ms-contratos y se mudan
    -- juntas en el paso 6d. Un anexo sin contrato no significa nada, así que
    -- aquí la integridad referencial es del dominio y no una atadura heredada.
    --
    -- CASCADE porque un anexo no sobrevive a su contrato. Hoy no hay ningún
    -- camino que borre contratos, así que no llega a ejecutarse; el día que lo
    -- haya tendrá que borrar también los archivos del almacenamiento, que esto
    -- no puede hacer.
    id_contrato  UUID          NOT NULL
        REFERENCES contratos (id_contrato) ON DELETE CASCADE,

    creado_por           UUID        NOT NULL,
    fecha_creacion       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por      UUID        NOT NULL,
    ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Siempre se piden los anexos DE UN CONTRATO: es el único acceso que existe.
CREATE INDEX IF NOT EXISTS idx_anexos_contrato ON anexos (id_contrato);

-- ── Se va `url_pdf` ──────────────────────────────────────────────────────────
--
-- No se migran los archivos que hubiera. Los PDF de `/uploads/` son de prueba, y
-- en la base de desarrollo NINGUNA fila apunta a uno: 0 de 20 tienen `url_pdf`,
-- y el directorio del gateway está vacío. Aunque hubiera archivos, el directorio
-- no sobrevive a un contenedor efímero — que es justamente el problema que el
-- paso 6b viene a resolver.
--
-- Con esta columna desaparece también el motivo de `express.static('uploads')`,
-- que servía los contratos escaneados a cualquiera que conociera la URL. Era la
-- trampa que CLAUDE.md tenía anotada como «/uploads/ se sirve sin
-- autenticación»; a partir de aquí los anexos sólo salen por
-- `GET /api/contratos/:id/anexos/:idAnexo`, que pasa por la matriz RBAC y por el
-- ABAC del controlador.
ALTER TABLE contratos DROP COLUMN url_pdf;
