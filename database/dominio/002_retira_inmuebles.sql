-- El gateway deja de tener inmuebles.
--
-- La tabla se fue a `inmuebles.inmuebles` con `database/inmuebles/002`, que la
-- copia entera. Aqui solo se retira el original.
--
-- ORDEN. Esta migracion NO puede correr antes de esa copia, o se perderian los
-- datos. Lo garantiza Compose: el gateway espera a que ms-inmuebles este sano, y
-- ms-inmuebles solo responde al healthcheck despues de aplicar sus migraciones.
-- Fuera de Compose —un `npm run migrate` a mano— el orden es responsabilidad de
-- quien lo lanza; por eso el mensaje de mas abajo dice que mirar.
--
-- No hay `DROP CONSTRAINT` que hacer: `contratos.id_inmueble` nunca tuvo clave
-- foranea hacia aqui. La regla dura 1 lo prohibia desde el principio,
-- precisamente para que este momento fuera un `DROP TABLE` y no una cirugia.

DO $$
DECLARE
    origen    BIGINT;
    faltantes BIGINT;
BEGIN
    IF to_regclass('public.inmuebles') IS NULL THEN
        RETURN;
    END IF;

    IF to_regclass('inmuebles.inmuebles') IS NULL THEN
        RAISE EXCEPTION
            'No existe inmuebles.inmuebles: ms-inmuebles todavia no ha migrado. '
            'Arrancalo primero (o ejecuta npm run migrate --workspace=services/ms-inmuebles).';
    END IF;

    EXECUTE 'SELECT count(*) FROM public.inmuebles' INTO origen;

    -- No se borra NADA que no este ya del otro lado, y se comprueba fila a fila.
    -- Comparar recuentos no serviria: el esquema del servicio puede tener filas
    -- propias —creadas por la API antes de este momento— y entonces el total
    -- cuadraria aunque no se hubiera copiado ninguna de las de aqui.
    EXECUTE '
        SELECT count(*)
          FROM public.inmuebles v
         WHERE NOT EXISTS (
                SELECT 1 FROM inmuebles.inmuebles n
                 WHERE n.id_inmueble = v.id_inmueble
               )'
      INTO faltantes;

    IF faltantes > 0 THEN
        RAISE EXCEPTION
            'Quedan % de % inmuebles sin copiar a inmuebles.inmuebles. '
            'La migracion database/inmuebles/002 no se ha completado; no se retira nada.',
            faltantes, origen;
    END IF;

    DROP TABLE public.inmuebles;
    RAISE NOTICE 'public.inmuebles retirada (% filas ya estaban en el esquema del servicio).', origen;
END
$$;
