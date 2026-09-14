-- Esquema inicial de MS-Notificaciones — Arriendos360, paso 7
--
-- El QUINTO y último servicio. Con él los cinco del Capítulo 2 están extraídos.
--
-- ── NO TIENE NI UNA TABLA DE DOMINIO, Y ESO ESTÁ EN EL CATÁLOGO ─────────────
--
-- El catálogo de microservicios de CLAUDE.md le asigna «ninguna». Las ocho tablas
-- de dominio del modelo canónico están repartidas entre los cuatro servicios
-- anteriores y aquí no llega ninguna: este servicio no es dueño de ningún
-- concepto del negocio, sólo de un canal.
--
-- Las dos que crea son OPERATIVAS, de la misma familia que `identidad.tokens_revocados`
-- o que las tablas de salida: existen para que el mecanismo funcione, no porque
-- el arrendamiento las necesite. Por eso NO llevan las cuatro columnas de
-- auditoría que CLAUDE.md exige a toda tabla de dominio — no hay un usuario
-- detrás de una fila que la escribió un evento, y el sobre no lleva actor.
--
-- ── Y TAMPOCO TIENE ENDPOINTS PÚBLICOS ──────────────────────────────────────
--
-- No aparece en la costura de enrutamiento del gateway ni tiene filas en la
-- matriz RBAC. Su única entrada es `POST /interno/eventos`, con credencial de
-- servicio. Se comunica sólo por eventos, que es lo que el Capítulo 2 describe
-- para un subdominio Genérico.

CREATE SCHEMA IF NOT EXISTS notificaciones;

-- ── Bitácora de eventos procesados ──────────────────────────────────────────
--
-- La mitad del trato del bus que le toca al consumidor, y AQUÍ IMPORTA MÁS QUE EN
-- NINGÚN OTRO SITIO. `database/inmuebles/003` avisaba de la escalada: poner un
-- inmueble en `arrendado` dos veces no hace daño, insertar una cuenta de cobro
-- dos veces factura el mismo mes dos veces. Éste es el tercer escalón y el peor:
-- mandar un correo dos veces es un efecto que ve una persona y que no se puede
-- deshacer. No hay `UPDATE` que recoja un correo ya leído.
--
-- La entrega es al-menos-una-vez por diseño, así que este servicio recibirá
-- eventos repetidos —por un reintento tras un fallo de red que en realidad sí se
-- aplicó, o porque otro suscriptor del mismo evento rechazó la entrega y el
-- publicador la repitió a todos. Sin esta tabla, cada reentrega sería un correo
-- más.
--
-- Es de este servicio y de nadie más (regla dura 3).
--
-- Ver `packages/shared/src/entrada.ts`.
CREATE TABLE IF NOT EXISTS notificaciones.eventos_procesados (
    -- El `id_evento` del sobre, generado por el productor. La clave primaria ES
    -- el mecanismo: el consumidor inserta con ON CONFLICT DO NOTHING dentro de la
    -- misma transacción en la que redacta los envíos, y si el sitio ya estaba
    -- ocupado, no redacta nada.
    id_evento    UUID          PRIMARY KEY,
    tipo         VARCHAR(80)   NOT NULL,
    procesado_en TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Sin claves foráneas hacia fuera: `id_evento` apunta a la tabla de salida de
-- OTRO servicio —`identidad.eventos_salida` o `financiero.eventos_salida`— y la
-- regla dura 1 prohíbe la FK física entre esquemas. Tampoco tendría sentido
-- funcional: el consumidor tiene que poder procesar un evento aunque el productor
-- ya haya redactado su payload.

-- ── Bitácora de envíos ──────────────────────────────────────────────────────
--
-- ESTA TABLA ES LA PIEZA CENTRAL DEL SERVICIO, y conviene entender por qué
-- existe antes de tocarla.
--
-- ── UN CORREO NO CABE EN UNA TRANSACCIÓN ────────────────────────────────────
--
-- El consumidor del bus garantiza la idempotencia metiendo la marca del evento y
-- el efecto del manejador en la misma transacción. Eso funciona cuando el efecto
-- es una fila. Un `sendMail` no lo es:
--
--   * enviar DENTRO de la transacción y que ésta falle después manda un correo
--     que ninguna fila registra, y el productor reintentará el evento — segundo
--     correo;
--   * marcar el evento como procesado y enviar DESPUÉS pierde el aviso sin rastro
--     si el envío falla, porque para el productor el evento ya está entregado.
--
-- Así que el manejador NO ENVÍA. Resuelve el destinatario, redacta el mensaje y
-- lo deja aquí como fila `pendiente`, en la misma transacción que la marca del
-- evento. Un barrido aparte —el mismo patrón del publicador de la tabla de
-- salida, un outbox de correos— es el único que habla con SMTP.
--
-- Eso encadena las cuatro garantías que se querían:
--
--   1. Un evento repetido no crea una segunda fila, porque la marca ya está.
--   2. Si ms-identidad no responde, el manejador lanza, la transacción se va
--      entera y el 500 hace que el productor reintente el evento. No se pierde.
--   3. Un fallo de SMTP queda en `ultimo_error`, en una fila que se puede
--      consultar. Antes se perdía en un `console.error`.
--   4. Lo que la petición del usuario prometió —«te enviaremos un enlace»— es
--      exactamente lo que esta tabla garantiza: que el envío está anotado.
--
-- ── ANTE LA DUDA, NO SE REENVÍA. AL CONTRARIO QUE EN EL BUS ─────────────────
--
-- Ésta es la asimetría deliberada con `eventos_salida`, y es una decisión de
-- diseño, no una omisión. La fila pasa a `enviando` ANTES del `sendMail`, y una
-- fila que se quede ahí porque el proceso murió NO se reintenta sola: queda a la
-- vista para que una persona decida.
--
-- En el bus, ante la duda se reentrega, porque el consumidor descarta repetidos y
-- un efecto duplicado no llega a producirse. Aquí el consumidor es una persona y
-- no descarta nada. Un aviso que no salió y se ve en una consulta es un problema
-- reparable; un correo que salió dos veces no se puede deshacer, y si el correo
-- llevaba un enlace de recuperación, la segunda copia es un segundo enlace vivo
-- en un buzón.
--
-- Ver `docs/adr/0019`.
CREATE TABLE IF NOT EXISTS notificaciones.envios (
    id_envio     UUID          PRIMARY KEY,

    -- Qué evento lo provocó. NO es único: un evento puede producir varios envíos
    -- —`CuentaCobroEnMora` avisa al inquilino y al propietario— y los dos van en
    -- la misma transacción, así que o se redactan los dos o ninguno.
    --
    -- La FK sí existe, porque no cruza esquema: un envío no puede existir sin el
    -- evento que lo justifica, y el consumidor inserta la marca antes de llamar
    -- al manejador, así que siempre está. Sin ON DELETE: de estas dos tablas no
    -- se borra nada.
    id_evento    UUID          NOT NULL
        REFERENCES notificaciones.eventos_procesados (id_evento),
    tipo_evento  VARCHAR(80)   NOT NULL,

    -- A QUIÉN se avisa, en las dos formas que hacen falta. `id_usuario` es lo que
    -- venía en el sobre; `destinatario` es lo que ms-identidad contestó cuando se
    -- le preguntó. Se guardan los dos porque responden a preguntas distintas:
    -- «a quién quisimos avisar» y «a qué dirección salió de verdad». Si alguien
    -- cambia su correo mañana, la segunda sigue diciendo dónde se entregó esto.
    id_usuario   UUID          NOT NULL,
    destinatario VARCHAR(255)  NOT NULL,

    -- El canal. Hoy sólo hay uno, y está aquí para que el día que haya SMS o
    -- notificación en la app no haga falta otra tabla. Catálogo ABIERTO a
    -- propósito: sin CHECK, como el `tipo` de Anexos.
    canal        VARCHAR(20)   NOT NULL DEFAULT 'EMAIL',

    asunto       VARCHAR(255)  NOT NULL,

    -- El cuerpo ya redactado. SE BORRA AL ENVIAR, en la misma sentencia que marca
    -- la fila como enviada, por la misma razón que el payload de
    -- `identidad.eventos_salida`: el correo de recuperación contiene un enlace con
    -- el token en claro, y guardarlo aquí para siempre sería dejar una llave
    -- debajo del felpudo. De ahí que sea NULL-able.
    --
    -- Lo que queda después es la bitácora de verdad: a quién, cuándo, con qué
    -- asunto y si funcionó. Lo que decía exactamente el correo no es lo que se
    -- audita.
    cuerpo       TEXT,

    -- Cuatro estados, no cinco. NO hay 'fallido': un fallo conocido devuelve la
    -- fila a 'pendiente' con el intento contado, el error escrito y el próximo
    -- intento en el futuro, que es lo mismo que hace la tabla de salida. Un estado
    -- que nadie escribe sobra. Ver `models/constantes.ts`.
    estado       VARCHAR(20)   NOT NULL DEFAULT 'pendiente'
        CONSTRAINT envios_estado_valido
        CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'apartado')),

    intentos           INTEGER      NOT NULL DEFAULT 0,
    proximo_intento_en TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ultimo_error       TEXT,
    enviado_en         TIMESTAMPTZ,
    registrado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Lo que barre el enviador: los pendientes por antigüedad. Índice parcial, igual
-- que el de la tabla de salida, porque las filas ya enviadas son la inmensa
-- mayoría y no se consultan por aquí.
CREATE INDEX IF NOT EXISTS idx_envios_pendientes
    ON notificaciones.envios (registrado_en, id_envio)
    WHERE estado = 'pendiente';

-- Para mirar qué le hemos mandado a una persona, que es la consulta que se hace
-- cuando alguien dice que no le llegó nada.
CREATE INDEX IF NOT EXISTS idx_envios_usuario
    ON notificaciones.envios (id_usuario, registrado_en DESC);

-- Y los que se quedaron colgados o fallaron, que es la consulta de operación: las
-- filas que nadie va a reintentar solo. Ver la nota sobre `enviando`.
CREATE INDEX IF NOT EXISTS idx_envios_atascados
    ON notificaciones.envios (estado, registrado_en)
    WHERE estado IN ('enviando', 'apartado');
