-- Tabla de salida (outbox) de MS-Identidad — Arriendos360, paso 7
--
-- La TERCERA tabla de salida del sistema, después de `contratos` (paso 6d) y a
-- la vez que `financiero` (este mismo paso). Y no trae ni una línea de mecanismo
-- nuevo: el publicador, el reintento con espera creciente, el apartado tras diez
-- intentos y el orden por clave viven en `packages/shared/src/salida.ts` desde el
-- paso 5. Aquí sólo hace falta la tabla.
--
-- ── POR QUÉ MS-IDENTIDAD SE CONVIERTE EN PRODUCTOR ──────────────────────────
--
-- Porque deja de mandar correos. Hasta el paso 7 este servicio abría una
-- conexión SMTP para el enlace de recuperación de contraseña, cosa que su propio
-- `services/notificador.ts` declaraba provisional y que el `docs/adr/0010`
-- anotaba como deuda con fecha de vencimiento: «el Capítulo 2 pone las
-- notificaciones en ms-notificaciones (paso 7), al que los demás servicios
-- avisan publicando un evento en el bus».
--
-- Esto es ese paso. `RecuperacionSolicitada` y `ContrasenaTemporalEmitida` se
-- registran aquí, en la MISMA transacción que el cambio de dominio que los
-- provoca —el token de recuperación, el alta del usuario— y ms-notificaciones
-- decide a quién avisar y por qué canal. Con eso el ADR 0010 queda SALDADO: su
-- desviación era el envío directo, y el envío directo desaparece.
--
-- ── UNA TABLA POR PRODUCTOR, EN SU PROPIO ESQUEMA ───────────────────────────
--
-- Nunca compartida. Una tabla común sería un punto de acoplamiento que la regla
-- dura 3 prohíbe, y rompería lo único que hace que el patrón funcione: que el
-- evento y el cambio de dominio quepan en la MISMA transacción. Contra una tabla
-- de otro esquema —y mañana de otra base— esa transacción no existe.
--
-- ── ESTA TABLA GUARDA UN SECRETO, Y POR POCO TIEMPO ─────────────────────────
--
-- Es la diferencia con las otras dos tablas de salida, y hay que conocerla. El
-- sobre de `RecuperacionSolicitada` lleva el token de restablecimiento EN CLARO,
-- porque el consumidor construye con él el enlace del correo. Mientras
-- `identidad.tokens_recuperacion` guarda sólo su SHA-256 —precisamente para que
-- leer esa tabla no permita restablecer la contraseña de nadie— aquí el token
-- está legible hasta que se entrega.
--
-- Se acota: `marcarEntregado()` BORRA el `payload` de ese tipo en la MISMA
-- sentencia que marca la fila como entregada. No en una segunda operación, que
-- dejaría el token en claro indefinidamente si el proceso se cayera entre las
-- dos. Ver `tiposRedactados` en `packages/shared/src/salida.ts` y `docs/adr/0019`.
--
-- Queda una ventana real, de unos 5 segundos en entrega normal y de lo que dure
-- una caída en el peor caso. Es aceptable y está documentada; lo que no sería
-- aceptable es que fuera indefinida.
--
-- Ver `packages/shared/src/salida.ts` y `docs/adr/0012`.

CREATE TABLE IF NOT EXISTS identidad.eventos_salida (
    id_evento          UUID          PRIMARY KEY,
    tipo               VARCHAR(80)   NOT NULL,
    version            INTEGER       NOT NULL,
    ocurrido_en        TIMESTAMPTZ   NOT NULL,
    payload            JSONB         NOT NULL,

    -- Clave de ordenación. Aquí guarda el `id_usuario`: dos recuperaciones
    -- seguidas de la misma persona tienen que entregarse en orden, porque la
    -- segunda invalida el enlace de la primera y entregarlas al revés le mandaría
    -- primero el enlace que sirve y después el que ya no. NULL = sin restricción.
    clave_orden        VARCHAR(64),

    estado             VARCHAR(20)   NOT NULL DEFAULT 'pendiente'
        CONSTRAINT eventos_salida_estado_valido
        CHECK (estado IN ('pendiente', 'entregado', 'apartado')),
    intentos           INTEGER       NOT NULL DEFAULT 0,
    proximo_intento_en TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ultimo_error       TEXT,
    entregado_en       TIMESTAMPTZ,
    registrado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_salida_pendientes
    ON identidad.eventos_salida (registrado_en, id_evento)
    WHERE estado = 'pendiente';
