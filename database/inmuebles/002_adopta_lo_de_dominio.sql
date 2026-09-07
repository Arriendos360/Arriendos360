-- Traslado de los inmuebles que vivian en el esquema del gateway.
--
-- Se ejecuta UNA vez, al desconectar el gateway de la tabla. Copia lo que haya
-- en `public.inmuebles` y lo deja en el esquema de este servicio, traduciendo
-- de paso los dos campos que cambiaron de nombre y de dominio.
--
-- NO borra el origen. De eso se encarga `database/dominio/002`, que aplica el
-- gateway; y para que no pueda adelantarse, Compose hace esperar al gateway a
-- que este servicio este sano, cosa que solo ocurre despues de migrar.
--
-- Si `public.inmuebles` no existe —una base nueva, o un despliegue donde el
-- gateway nunca la tuvo— esto no hace nada y no falla.

DO $$
DECLARE
    sin_mapear TEXT;
BEGIN
    IF to_regclass('public.inmuebles') IS NULL THEN
        RAISE NOTICE 'No hay public.inmuebles: nada que adoptar.';
        RETURN;
    END IF;

    -- El `tipo` era VARCHAR(50) libre y el formulario ofrecia "Apartamento",
    -- "Casa", "Local", "Apartaestudio" y "Finca". Los cuatro primeros tienen
    -- destino en el catalogo nuevo; "Finca" NO, porque no esta entre los seis
    -- valores del modelo canonico.
    --
    -- Antes de copiar nada se comprueba que TODO sea traducible. Si aparece un
    -- valor sin destino, la migracion falla y dice cual: inventarle un tipo a un
    -- inmueble real seria peor que parar. La transaccion del runner deja el
    -- esquema como estaba.
    SELECT string_agg(DISTINCT tipo_inmueble, ', ')
      INTO sin_mapear
      FROM public.inmuebles
     WHERE lower(coalesce(tipo_inmueble, '')) NOT IN (
            'apartamento', 'apto', 'casa', 'local',
            'oficina', 'bodega', 'apartaestudio'
           );

    IF sin_mapear IS NOT NULL THEN
        RAISE EXCEPTION
            'Hay tipos de inmueble sin equivalente en el catalogo cerrado: %. '
            'Corrigelos en public.inmuebles antes de migrar, o agregalos al '
            'catalogo en packages/contracts y al CHECK de 001.', sin_mapear;
    END IF;

    INSERT INTO inmuebles.inmuebles (
        id_inmueble, departamento, municipio, barrio, direccion, tipo,
        area_m2, habitaciones, banos, deposito, parqueaderos, estrato,
        estado, id_propietario,
        creado_por, fecha_creacion, actualizado_por, ultima_actualizacion
    )
    SELECT
        v.id_inmueble, v.departamento, v.municipio, v.barrio, v.direccion,
        CASE lower(v.tipo_inmueble)
            WHEN 'apto' THEN 'apartamento'
            ELSE lower(v.tipo_inmueble)
        END,
        v.area_m2, v.habitaciones, v.banos, v.deposito, v.parqueaderos, v.estrato,
        -- `estado_ocupacion` solo tomaba estos dos valores. Cualquier otra cosa
        -- —incluido NULL— se interpreta como disponible, que es el estado con el
        -- que nace un inmueble y el que menos dano hace si se equivoca: muestra
        -- como libre algo que quiza no lo esta, en vez de bloquear un inmueble.
        CASE WHEN v.estado_ocupacion = 'arrendado' THEN 'arrendado' ELSE 'disponible' END,
        v.id_propietario,
        v.creado_por, v.fecha_creacion, v.actualizado_por, v.ultima_actualizacion
    FROM public.inmuebles v
    -- Idempotente: si esto ya corrio, no duplica.
    ON CONFLICT (id_inmueble) DO NOTHING;

    RAISE NOTICE 'Inmuebles adoptados desde public.inmuebles.';
END
$$;
