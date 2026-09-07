-- Registro de consultas por documento.
--
-- `GET /api/usuarios?documento=` permite a un propietario resolver la cedula de
-- una persona a su UUID. Es una capacidad necesaria —sin ella no se puede firmar
-- un contrato— pero tambien es un oraculo: quien la tenga puede comprobar si una
-- cedula concreta esta registrada en la plataforma. Que quede rastro de quien
-- pregunto y por quien es lo que hace la diferencia entre una consulta legitima
-- y un barrido silencioso.
--
-- NO se expone por ninguna API y NO forma parte del modelo canonico del
-- documento: es una tabla operativa del servicio, como `tokens_revocados`. Se
-- consulta con SQL cuando haga falta investigar algo.

CREATE TABLE IF NOT EXISTS identidad.consultas_documento (
    id_consulta   UUID        PRIMARY KEY,
    -- Quien pregunto: el `sub` del token. Sin clave foranea a proposito, para
    -- que borrar un usuario no borre el rastro de lo que consulto.
    id_consultante UUID       NOT NULL,
    -- Que documento se pregunto. Se guarda aunque no exista: un barrido se
    -- reconoce precisamente por la racha de consultas fallidas.
    documento     VARCHAR(20) NOT NULL,
    encontrado    BOOLEAN     NOT NULL,
    consultada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultas_consultante
    ON identidad.consultas_documento (id_consultante, consultada_en DESC);
