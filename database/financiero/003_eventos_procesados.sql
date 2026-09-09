-- Bitácora de eventos procesados de MS-Financiero — Arriendos360, paso 6e
--
-- La otra mitad del trato del bus, y aquí importa más que en ms-inmuebles.
--
-- POR QUÉ. `database/inmuebles/003` avisaba de esto textualmente: «poner un
-- inmueble en `arrendado` dos veces no hace daño, es cierto — hoy. Deja de
-- serlo en cuanto un consumidor tenga que INSERTAR algo, que es exactamente lo
-- que hará ms-financiero en el paso 6 con la primera cuenta de cobro». Éste es
-- ese consumidor.
--
-- La entrega es al-menos-una-vez, así que este servicio recibirá
-- `ContratoFormalizado` más de una vez: por un reintento tras un fallo de red
-- que en realidad sí se aplicó, o por dos publicadores barriendo la misma tabla
-- de salida. Sin esta tabla, cada reentrega sería una segunda factura al
-- inquilino por el mismo mes.
--
-- HAY UNA SEGUNDA RED DEBAJO, y las dos hacen falta. El índice único
-- `(id_contrato, inicio)` de `001` impide el duplicado a nivel de datos aunque
-- alguien se salte esta bitácora; esta bitácora impide que el intento llegue a
-- producirse y a fallar. La primera protege la contabilidad, la segunda evita
-- que un reintento legítimo acabe en un 500 que el productor volvería a
-- reintentar.
--
-- Es de este servicio y de nadie más (regla dura 3): cada consumidor lleva la
-- suya, porque dos consumidores del mismo evento tienen que poder procesarlo
-- cada uno por su lado. `ContratoFormalizado` tiene justamente dos desde este
-- paso —ms-inmuebles y este servicio— que es el caso que el diseño anticipaba.
--
-- Ver `packages/shared/src/entrada.ts`.

CREATE TABLE IF NOT EXISTS financiero.eventos_procesados (
    -- El `id_evento` del sobre, generado por el productor. La clave primaria ES
    -- el mecanismo: el consumidor inserta con ON CONFLICT DO NOTHING dentro de
    -- la misma transacción que aplica el efecto, y si el sitio ya estaba
    -- ocupado, no vuelve a hacer nada.
    id_evento    UUID          PRIMARY KEY,
    tipo         VARCHAR(80)   NOT NULL,
    procesado_en TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Sin claves foráneas: `id_evento` apunta a la tabla de salida de OTRO servicio
-- —`contratos.eventos_salida`— y la regla dura 1 prohíbe la FK física entre
-- esquemas. Tampoco tendría sentido funcional: el consumidor tiene que poder
-- procesar un evento aunque el productor ya haya limpiado su bandeja.
