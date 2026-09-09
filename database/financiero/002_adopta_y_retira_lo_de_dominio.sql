-- Traslado de las cuentas de cobro y sus transacciones — Arriendos360, paso 6e
--
-- Se ejecuta UNA vez, al desconectar el gateway de estas dos tablas. Copia lo
-- que haya en `public` al esquema de este servicio y RETIRA el origen.
--
-- ── POR QUÉ ESTA MIGRACIÓN HACE LAS DOS COSAS Y LAS ANTERIORES NO ───────────
--
-- Las tres mudanzas anteriores se hicieron en dos migraciones: una que copia, en
-- el esquema del servicio, y otra que retira, en `database/dominio/`, aplicada
-- por el gateway. Compose garantizaba el orden haciendo esperar al gateway al
-- healthcheck del servicio.
--
-- Aquí no se puede, y no por comodidad: **el gateway se queda sin base**. Éstas
-- eran sus dos últimas tablas, así que con ellas se van su conexión, su
-- aplicador de migraciones y la carpeta `database/dominio/` entera. No queda
-- ningún proceso capaz de aplicar la retirada por separado.
--
-- Juntarlas es además MÁS seguro que el patrón que sustituyen. El runner envuelve
-- cada migración en una transacción, así que copia y retirada son atómicas: no
-- existe el instante en que los datos están sólo en un sitio, ni la posibilidad
-- de que la segunda mitad se adelante a la primera. Lo que se pierde —poder
-- arrancar el servicio nuevo y dejar el viejo leyendo un rato— aquí no vale
-- nada, porque el gateway ya no lee esto en ninguna versión del código.
--
-- Lo que NO cambia es la comprobación: no se borra ni una fila que no esté
-- confirmada en destino. Ver el bloque de verificación.
--
-- Si las tablas de `public` no existen —una base nueva, o un despliegue donde el
-- gateway nunca las tuvo— esto no hace nada y no falla.
--
-- ── LO QUE SE QUEDA ATRÁS ───────────────────────────────────────────────────
--
-- `public.migraciones_aplicadas`, la tabla de control del gateway. No se toca:
-- es bitácora de OTRO componente, y un servicio que adopta unos datos no tiene
-- por qué barrer el registro contable de quien se los entrega. Queda inerte —
-- lista migraciones de una carpeta que ya no existe— y desaparecerá con la base
-- el día que el gateway se despliegue sin ella.

DO $$
DECLARE
    cuentas_origen BIGINT;
    trx_origen     BIGINT;
    faltantes      BIGINT;
BEGIN
    IF to_regclass('public.cuentas_cobro') IS NULL THEN
        RAISE NOTICE 'No hay public.cuentas_cobro: nada que adoptar.';
        RETURN;
    END IF;

    -- ── Cuentas de cobro ────────────────────────────────────────────────────
    -- `ON CONFLICT DO NOTHING` hace la copia repetible: si la migración se
    -- reaplica sobre un esquema que ya tiene filas, no duplica ni revienta.
    --
    -- Los nombres de columna ya coinciden: el paso 6c los dejó en su forma
    -- canónica (`database/dominio/006`). Aquí no hay traducción, sólo mudanza.
    INSERT INTO financiero.cuentas_cobro (
        id_cuenta_cobro, detalle, valor, inicio, fin, fecha_pago, estado,
        id_contrato,
        creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
    )
    SELECT
        id_cuenta_cobro, detalle, valor, inicio, fin, fecha_pago, estado,
        id_contrato,
        creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
    FROM public.cuentas_cobro
    ON CONFLICT (id_cuenta_cobro) DO NOTHING;

    SELECT count(*) INTO cuentas_origen FROM public.cuentas_cobro;

    -- Comprobación FILA A FILA, no por recuento. Comparar totales no serviría:
    -- el esquema del servicio puede tener filas propias y entonces el total
    -- cuadraría aunque no se hubiera copiado ninguna de las de aquí.
    SELECT count(*) INTO faltantes
      FROM public.cuentas_cobro o
     WHERE NOT EXISTS (
         SELECT 1 FROM financiero.cuentas_cobro d
          WHERE d.id_cuenta_cobro = o.id_cuenta_cobro
     );

    IF faltantes > 0 THEN
        RAISE EXCEPTION
            'Quedaron % cuentas de cobro sin copiar de % en origen. No se retira nada hasta saber por que.',
            faltantes, cuentas_origen;
    END IF;

    RAISE NOTICE 'Adoptadas % cuentas de cobro.', cuentas_origen;

    -- ── Transacciones ───────────────────────────────────────────────────────
    -- Van DESPUÉS de las cuentas: la clave foránea las exige. Que la copia de
    -- arriba haya cuadrado es lo que garantiza que ninguna quede huérfana.
    IF to_regclass('public.transacciones') IS NOT NULL THEN
        INSERT INTO financiero.transacciones (
            id_transaccion, monto, fecha_pago, tipo, medio_pago, estado,
            observaciones, saldo_restante_momento, id_cuenta_cobro,
            creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
        )
        SELECT
            id_transaccion, monto, fecha_pago, tipo, medio_pago, estado,
            observaciones, saldo_restante_momento, id_cuenta_cobro,
            creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
        FROM public.transacciones
        ON CONFLICT (id_transaccion) DO NOTHING;

        SELECT count(*) INTO trx_origen FROM public.transacciones;

        SELECT count(*) INTO faltantes
          FROM public.transacciones o
         WHERE NOT EXISTS (
             SELECT 1 FROM financiero.transacciones d
              WHERE d.id_transaccion = o.id_transaccion
         );

        IF faltantes > 0 THEN
            RAISE EXCEPTION
                'Quedaron % transacciones sin copiar de % en origen.', faltantes, trx_origen;
        END IF;

        RAISE NOTICE 'Adoptadas % transacciones.', trx_origen;

        -- Sólo ahora, y sólo porque las dos comprobaciones de arriba cuadraron.
        DROP TABLE public.transacciones;
        RAISE NOTICE 'public.transacciones retirada.';
    END IF;

    DROP TABLE public.cuentas_cobro;
    RAISE NOTICE
        'public.cuentas_cobro retirada (% filas ya estaban en el esquema del servicio). '
        'El gateway se queda sin tablas de dominio.',
        cuentas_origen;
END
$$;
