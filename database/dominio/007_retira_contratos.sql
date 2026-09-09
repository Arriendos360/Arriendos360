-- El gateway deja de tener contratos, anexos y bandeja de eventos.
--
-- Las tres se fueron al esquema `contratos` con `database/contratos/002`, que
-- las copia. Aquí sólo se retiran los originales.
--
-- ORDEN. Esta migración NO puede correr antes de esa copia, o se perderían los
-- datos. Lo garantiza Compose: el gateway espera a que ms-contratos esté sano, y
-- ms-contratos sólo responde al healthcheck después de aplicar sus migraciones.
-- Fuera de Compose —un `npm run migrate` a mano— el orden es responsabilidad de
-- quien lo lanza; por eso los mensajes de abajo dicen qué mirar.
--
-- No hay `DROP CONSTRAINT` que hacer contra otras tablas: `cuentas_cobro.
-- id_contrato` nunca tuvo clave foránea hacia `contratos`. La regla dura 1 lo
-- prohibía desde el principio, precisamente para que este momento fuera un
-- `DROP TABLE` y no una cirugía.
--
-- `anexos` SÍ tenía FK hacia `contratos`, y por eso se retira primero: las dos
-- son de ms-contratos y su relación se mudó entera.

DO $$
DECLARE
    origen    BIGINT;
    faltantes BIGINT;
    perdidos  BIGINT;
BEGIN
    IF to_regclass('public.contratos') IS NULL THEN
        RAISE NOTICE 'public.contratos ya no existe: nada que retirar.';
        RETURN;
    END IF;

    EXECUTE 'SELECT count(*) FROM public.contratos' INTO origen;

    -- ── UNA TABLA VACIA NO TIENE NADA QUE PERDER ────────────────────────────
    --
    -- Si no hay filas, se retira sin exigir que el esquema del servicio exista.
    -- No es un atajo: la comprobación de más abajo existe para no borrar datos
    -- que no estén copiados, y aquí no hay datos. Sin esta salida, una base
    -- recién creada —la de las pruebas del gateway, que rehace `public` entero
    -- en cada suite— no podría migrar sin arrancar antes ms-contratos, y las
    -- suites dejarían de correr en un portátil sin Docker.
    IF origen = 0 THEN
        IF to_regclass('public.anexos') IS NOT NULL THEN
            DROP TABLE public.anexos;
        END IF;
        DROP TABLE public.contratos;

        IF to_regclass('public.eventos_salida') IS NOT NULL THEN
            EXECUTE 'SELECT count(*) FROM public.eventos_salida WHERE estado = ''pendiente'''
              INTO perdidos;

            IF perdidos > 0 THEN
                RAISE EXCEPTION
                    'Hay % eventos pendientes de entrega y ningun contrato. Revisar antes de borrar.',
                    perdidos;
            END IF;

            DROP TABLE public.eventos_salida;
        END IF;

        RAISE NOTICE 'public.contratos estaba vacia: retirada sin adopcion.';
        RETURN;
    END IF;

    IF to_regclass('contratos.contratos') IS NULL THEN
        RAISE EXCEPTION
            'No existe contratos.contratos: ms-contratos todavia no ha migrado. '
            'Arrancalo primero (o ejecuta npm run migrate --workspace=services/ms-contratos).';
    END IF;

    -- ── Comprobación fila a fila, no por recuento ───────────────────────────
    -- Comparar totales no serviría: el esquema del servicio puede tener filas
    -- propias —creadas por su API antes de este momento— y entonces el total
    -- cuadraría aunque no se hubiera copiado ninguna de las de aquí.
    EXECUTE '
        SELECT count(*)
          FROM public.contratos v
         WHERE NOT EXISTS (
                SELECT 1 FROM contratos.contratos n
                 WHERE n.id_contrato = v.id_contrato
               )'
      INTO faltantes;

    IF faltantes > 0 THEN
        RAISE EXCEPTION
            'Quedan % de % contratos sin copiar a contratos.contratos. '
            'La migracion database/contratos/002 no se ha completado; no se retira nada.',
            faltantes, origen;
    END IF;

    -- ── Anexos ──────────────────────────────────────────────────────────────
    IF to_regclass('public.anexos') IS NOT NULL THEN
        EXECUTE '
            SELECT count(*)
              FROM public.anexos v
             WHERE NOT EXISTS (
                    SELECT 1 FROM contratos.anexos n WHERE n.id_anexo = v.id_anexo
                   )'
          INTO faltantes;

        IF faltantes > 0 THEN
            RAISE EXCEPTION 'Quedan % anexos sin copiar a contratos.anexos.', faltantes;
        END IF;

        DROP TABLE public.anexos;
        RAISE NOTICE 'public.anexos retirada.';
    END IF;

    DROP TABLE public.contratos;
    RAISE NOTICE 'public.contratos retirada (% filas ya estaban en el esquema del servicio).', origen;

    -- ── La bandeja de eventos ───────────────────────────────────────────────
    --
    -- El gateway deja de ser productor: no le queda ningún cambio de dominio que
    -- anunciar, porque los dos eventos del sistema son del ciclo de vida del
    -- contrato. Cuando en el paso 6e se extraiga ms-financiero y algún día
    -- emita algo, tendrá su propia tabla en su propio esquema.
    --
    -- SE COMPRUEBA QUE NO QUEDE NADA PENDIENTE antes de borrarla. Un evento en
    -- `pendiente` que se fuera con la tabla es un inmueble que se queda para
    -- siempre en el estado que no toca, sin que nada lo delate. `contratos/002`
    -- los copió; si aquí sigue habiendo alguno, es que esa migración no corrió.
    IF to_regclass('public.eventos_salida') IS NOT NULL THEN
        EXECUTE '
            SELECT count(*)
              FROM public.eventos_salida v
             WHERE v.estado = ''pendiente''
               AND NOT EXISTS (
                    SELECT 1 FROM contratos.eventos_salida n
                     WHERE n.id_evento = v.id_evento
                   )'
          INTO perdidos;

        IF perdidos > 0 THEN
            RAISE EXCEPTION
                'Hay % eventos pendientes de entrega que no estan en contratos.eventos_salida. '
                'Borrar esta tabla los perderia y dejaria inmuebles con el estado equivocado.',
                perdidos;
        END IF;

        DROP TABLE public.eventos_salida;
        RAISE NOTICE 'public.eventos_salida retirada: el gateway ya no produce eventos.';
    END IF;
END
$$;
