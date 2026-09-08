-- Tabla de salida (outbox) del gateway — Arriendos360, paso 5
--
-- El gateway es HOY el productor de los eventos del ciclo de vida del contrato,
-- porque `contratos` sigue siendo suya. En el paso 6, cuando se extraiga
-- ms-contratos, esta misma tabla se recrea en el esquema `contratos` y esta
-- desaparece: el productor se lleva su bandeja consigo. Por eso vive en
-- `database/dominio/`, que CLAUDE.md ya marca como provisional.
--
-- POR QUE NO ES UNA TABLA COMPARTIDA. Cada productor tiene la suya, en su propio
-- esquema. Una tabla comun a todos los servicios seria un punto de acoplamiento
-- que la regla dura 3 prohibe, y romperia ademas lo unico que hace que el patron
-- funcione: que el evento y el cambio de dominio quepan en la MISMA transaccion.
-- Contra una tabla de otro esquema —y mañana de otra base— esa transaccion no
-- existe, y volveriamos al problema que esto viene a resolver.
--
-- Ver `packages/shared/src/salida.ts` y `docs/adr/0012`.

CREATE TABLE IF NOT EXISTS public.eventos_salida (
    -- Generado en la aplicacion con crypto.randomUUID(), como todas las claves
    -- del proyecto. Es ADEMAS la clave de deduplicacion del consumidor: viaja en
    -- el sobre y el otro extremo la usa para descartar entregas repetidas.
    id_evento          UUID          PRIMARY KEY,
    tipo               VARCHAR(80)   NOT NULL,
    -- Version de la FORMA de la carga. Va desde el primer evento; ponerla
    -- despues obliga a tratar como version 1 los sobres que no la traen.
    version            INTEGER       NOT NULL,
    -- Cuando OCURRIO el hecho, no cuando se entrego. UTC, como todo.
    ocurrido_en        TIMESTAMPTZ   NOT NULL,
    payload            JSONB         NOT NULL,

    -- Clave de ordenacion. Los eventos que la comparten se entregan en el orden
    -- en que se registraron. No es un lujo: ContratoFormalizado y
    -- ContratoFinalizado sobre el mismo inmueble son ordenes contrarias, y
    -- entregarlas al reves deja el inmueble ocupado para siempre. Aqui guarda el
    -- `id_inmueble`. NULL = sin restriccion de orden.
    clave_orden        VARCHAR(64),

    estado             VARCHAR(20)   NOT NULL DEFAULT 'pendiente'
        CONSTRAINT eventos_salida_estado_valido
        CHECK (estado IN ('pendiente', 'entregado', 'apartado')),
    intentos           INTEGER       NOT NULL DEFAULT 0,
    -- Espera exponencial entre reintentos. El publicador no toca la fila antes
    -- de esta hora.
    proximo_intento_en TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    -- Por que fallo la ultima vez. Es lo que se mira cuando un evento acaba
    -- apartado, y la unica pista de que paso si nadie estaba delante del log.
    ultimo_error       TEXT,
    entregado_en       TIMESTAMPTZ,
    registrado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- El publicador solo mira lo pendiente, y lo mira por antiguedad. El indice es
-- parcial porque lo entregado se acumula y no se consulta: sin el filtro, el
-- indice creceria para siempre por nada.
CREATE INDEX IF NOT EXISTS idx_eventos_salida_pendientes
    ON public.eventos_salida (registrado_en, id_evento)
    WHERE estado = 'pendiente';

-- NO HAY BARRIDO de lo entregado, igual que no lo hay de TokensRevocados. Con el
-- volumen de este proyecto la tabla es tambien la bitacora de que se emitio y
-- cuando, que es util para la defensa y para depurar. Si algun dia estorba, se
-- limpia con un DELETE de lo entregado hace mas de N dias.
