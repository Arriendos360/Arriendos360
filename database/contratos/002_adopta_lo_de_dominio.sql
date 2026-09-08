-- Traslado de los contratos, sus anexos y su bandeja de eventos.
--
-- Se ejecuta UNA vez, al desconectar el gateway de estas tablas. Copia lo que
-- haya en `public` y lo deja en el esquema de este servicio. Los nombres de
-- columna ya coinciden —el paso 6a los realineó y el 6b creó `anexos` con su
-- forma final— así que aquí no hay traducción que hacer, sólo mudanza.
--
-- NO borra el origen. De eso se encarga `database/dominio/007`, que aplica el
-- gateway; y para que no pueda adelantarse, Compose hace esperar al gateway a
-- que este servicio esté sano, cosa que sólo ocurre después de migrar. Es el
-- mismo mecanismo con el que se movió `inmuebles` en el paso 4.
--
-- Si las tablas de `public` no existen —una base nueva, o un despliegue donde el
-- gateway nunca las tuvo— esto no hace nada y no falla.
--
-- ── LOS EVENTOS PENDIENTES TAMBIÉN SE MUDAN, Y ESO NO ES OPCIONAL ────────────
--
-- La tabla de salida del gateway puede tener filas en `pendiente`: contratos
-- firmados cuyo evento todavía no se entregó, o que están esperando un
-- reintento. Si se dejaran atrás, `public.eventos_salida` se borraría con ellas
-- dentro y esos inmuebles se quedarían para siempre en `disponible` con un
-- contrato activo encima — exactamente el fallo silencioso que el patrón outbox
-- existe para impedir.
--
-- Se copian SÓLO las pendientes. Las entregadas ya cumplieron su función y son
-- bitácora del gateway; copiarlas mezclaría el historial de dos productores en
-- una tabla que dice ser de uno. Las apartadas tampoco: son fallos que alguien
-- tiene que mirar, y mudarlas de esquema las escondería.

DO $$
DECLARE
    contratos_origen BIGINT;
    anexos_origen    BIGINT;
    pendientes       BIGINT;
    faltantes        BIGINT;
BEGIN
    IF to_regclass('public.contratos') IS NULL THEN
        RAISE NOTICE 'No hay public.contratos: nada que adoptar.';
        RETURN;
    END IF;

    -- ── Contratos ───────────────────────────────────────────────────────────
    -- `ON CONFLICT DO NOTHING` hace la copia repetible: si la migración se
    -- reaplica sobre un esquema que ya tiene filas, no duplica ni revienta.
    INSERT INTO contratos.contratos (
        id_contrato, inicio, fin, canon,
        fecha_inicio_corte, fecha_limite_pago, info_contrato, estado,
        nombre_deudor_solidario, documento_deudor_solidario,
        id_inmueble, id_inquilino,
        creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
    )
    SELECT
        id_contrato, inicio, fin, canon,
        fecha_inicio_corte, fecha_limite_pago, info_contrato, estado,
        nombre_deudor_solidario, documento_deudor_solidario,
        id_inmueble, id_inquilino,
        creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
    FROM public.contratos
    ON CONFLICT (id_contrato) DO NOTHING;

    SELECT count(*) INTO contratos_origen FROM public.contratos;

    SELECT count(*) INTO faltantes
      FROM public.contratos o
     WHERE NOT EXISTS (
         SELECT 1 FROM contratos.contratos d WHERE d.id_contrato = o.id_contrato
     );

    IF faltantes > 0 THEN
        RAISE EXCEPTION
            'Quedaron % contratos sin copiar de % en origen. No se retira nada hasta saber por que.',
            faltantes, contratos_origen;
    END IF;

    RAISE NOTICE 'Adoptados % contratos.', contratos_origen;

    -- ── Anexos ──────────────────────────────────────────────────────────────
    -- Van DESPUÉS de los contratos: la clave foránea los exige. Que la copia de
    -- arriba haya cuadrado es lo que garantiza que ninguno quede huérfano.
    IF to_regclass('public.anexos') IS NOT NULL THEN
        INSERT INTO contratos.anexos (
            id_anexo, archivo_anexo, tipo, id_contrato,
            creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
        )
        SELECT
            id_anexo, archivo_anexo, tipo, id_contrato,
            creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
        FROM public.anexos
        ON CONFLICT (id_anexo) DO NOTHING;

        SELECT count(*) INTO anexos_origen FROM public.anexos;

        SELECT count(*) INTO faltantes
          FROM public.anexos o
         WHERE NOT EXISTS (
             SELECT 1 FROM contratos.anexos d WHERE d.id_anexo = o.id_anexo
         );

        IF faltantes > 0 THEN
            RAISE EXCEPTION
                'Quedaron % anexos sin copiar de % en origen.', faltantes, anexos_origen;
        END IF;

        RAISE NOTICE 'Adoptados % anexos.', anexos_origen;
    END IF;

    -- Los ARCHIVOS de los anexos no se mudan aquí, porque no están en la base.
    -- Con la implementación de disco viven en el volumen del gateway y hay que
    -- copiarlos a mano al del servicio; con Azure Blob no se mueven en absoluto,
    -- porque el contenedor es el mismo y la referencia guardada sigue valiendo.
    -- En la base de desarrollo no hay ninguno. Ver `docs/adr/0014`.

    -- ── Eventos pendientes ──────────────────────────────────────────────────
    IF to_regclass('public.eventos_salida') IS NOT NULL THEN
        INSERT INTO contratos.eventos_salida (
            id_evento, tipo, version, ocurrido_en, payload, clave_orden,
            estado, intentos, proximo_intento_en, ultimo_error,
            entregado_en, registrado_en
        )
        SELECT
            id_evento, tipo, version, ocurrido_en, payload, clave_orden,
            estado, intentos, proximo_intento_en, ultimo_error,
            entregado_en, registrado_en
        FROM public.eventos_salida
        WHERE estado = 'pendiente'
        ON CONFLICT (id_evento) DO NOTHING;

        GET DIAGNOSTICS pendientes = ROW_COUNT;
        RAISE NOTICE 'Adoptados % eventos pendientes de entrega.', pendientes;
    END IF;
END $$;
