-- Bitacora de eventos procesados de MS-Inmuebles — Arriendos360, paso 5
--
-- La otra mitad del trato del bus. El productor entrega al-menos-una-vez, asi
-- que este servicio recibira el mismo evento mas de una vez: por un reintento
-- tras un fallo de red que en realidad si se aplico, o por dos publicadores
-- barriendo la misma tabla de salida. Esta tabla es lo que hace que dé igual.
--
-- POR QUE UNA TABLA Y NO «QUE EL MANEJADOR SEA IDEMPOTENTE». Poner un inmueble
-- en `arrendado` dos veces no hace daño, es cierto — hoy. Deja de serlo en
-- cuanto un consumidor tenga que INSERTAR algo, que es exactamente lo que hara
-- ms-financiero en el paso 6 con la primera cuenta de cobro. La idempotencia
-- por casualidad no se hereda; la deduplicacion por identificador si.
--
-- Es de este servicio y de nadie mas (regla dura 3): cada consumidor lleva la
-- suya, porque dos consumidores del mismo evento tienen que poder procesarlo
-- cada uno por su lado.
--
-- Ver `packages/shared/src/entrada.ts`.

CREATE TABLE IF NOT EXISTS inmuebles.eventos_procesados (
    -- El `id_evento` del sobre, generado por el productor. La clave primaria ES
    -- el mecanismo: el consumidor inserta con ON CONFLICT DO NOTHING dentro de
    -- la misma transaccion que aplica el efecto, y si el sitio ya estaba
    -- ocupado, no vuelve a hacer nada.
    id_evento    UUID          PRIMARY KEY,
    tipo         VARCHAR(80)   NOT NULL,
    procesado_en TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Sin claves foraneas: `id_evento` apunta a la tabla de salida de OTRO servicio,
-- y la regla dura 1 prohibe la FK fisica entre esquemas. Tampoco tendria sentido
-- funcional: el consumidor tiene que poder procesar un evento aunque el
-- productor ya haya limpiado su bandeja.
