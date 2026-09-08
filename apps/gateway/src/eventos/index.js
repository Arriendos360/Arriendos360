/**
 * El gateway como PRODUCTOR de eventos.
 *
 * Aquí se cablea el mecanismo de `packages/shared` con lo que este proceso
 * tiene: su conexión a PostgreSQL, su tabla de salida y la lista de quién
 * escucha. El mecanismo no se reimplementa — igual que la caché de revocados
 * dejó de tener copia propia cuando subió al paquete compartido.
 *
 * POR QUÉ EL PRODUCTOR ES EL GATEWAY Y NO MS-CONTRATOS. Porque `contratos`
 * todavía es suya. El Capítulo 2 dice que `ContratoFormalizado` lo emite
 * MS-Contratos, y así será en el paso 6; lo que no puede es esperar a entonces,
 * porque el evento es lo que sustituye a la llamada síncrona del ADR 0011 y esa
 * llamada está viva hoy. La regla que se respeta es la que importa: **lo emite
 * quien escribe el contrato**, sea quien sea. Cuando el contrato se mude, se
 * mudan con él la tabla de salida y estas cuatro líneas.
 *
 * LOS NOMBRES DEL EVENTO SON LOS DEL MODELO CANÓNICO, y desde el paso 6a los de
 * la tabla también. Aquí hubo una traducción postiza mientras duró el desfase:
 * el evento hablaba de `canon` y `fecha_inicio_corte` cuando la columna se
 * llamaba `valor_mensual` y la de corte no existía, así que la fecha se derivaba
 * de `fecha_inicio` en el emisor. Ya no: las dos se leen de su columna.
 *
 * La diferencia no es cosmética. Derivada, la fecha de corte que anunciaba el
 * evento era siempre la del inicio del contrato, aunque alguien la hubiera
 * cambiado después; ahora el evento dice lo que dice la fila.
 */

const {
    TIPO_CONTRATO_FINALIZADO,
    TIPO_CONTRATO_FORMALIZADO,
    crearAlmacenSalidaSql,
    crearEntregaHttp,
    crearPublicador,
    crearSobre
} = require('arriendos360-shared');

const { sequelize } = require('../config/database');

/** La bandeja de este productor. Ver `database/dominio/003`. */
const TABLA_SALIDA = 'public.eventos_salida';

const almacen = crearAlmacenSalidaSql({ conexion: sequelize, tabla: TABLA_SALIDA });

/**
 * Quién escucha cada tipo.
 *
 * Se configura, no se descubre: nada de service discovery (CLAUDE.md, «Qué no
 * hacer»). Se lee del entorno EN CADA ENTREGA, igual que hace la costura con
 * `MS_*_URL`, y por el mismo motivo práctico: las pruebas apuntan el destino a
 * un doble después de haber cargado este módulo.
 *
 * Hoy los dos eventos van al mismo sitio. En el paso 6, `ContratoFormalizado`
 * gana un segundo suscriptor —ms-financiero, que crea la primera cuenta de
 * cobro— y esto es lo único que cambia.
 */
const SUSCRIPCIONES = {
    [TIPO_CONTRATO_FORMALIZADO]: [{ nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' }],
    [TIPO_CONTRATO_FINALIZADO]: [{ nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' }]
};

const suscriptoresDe = (tipo) =>
    (SUSCRIPCIONES[tipo] || [])
        .map(({ nombre, variable }) => ({ nombre, url: (process.env[variable] || '').trim() }))
        .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
    suscriptores: suscriptoresDe,
    emisor: () => process.env.SERVICIO_NOMBRE || 'gateway',
    secreto: () => process.env.SERVICIO_JWT_SECRET
});

/**
 * Un publicador sobre esta tabla de salida y este transporte.
 *
 * Se expone la fábrica y no solo la instancia para que las pruebas puedan
 * ajustar lo único que les estorba —la espera entre reintentos, el límite de
 * intentos— sin sustituir el almacén ni la entrega, que son justo las dos
 * piezas que interesa ejercitar de verdad.
 */
const crearPublicadorDeSalida = (opciones = {}) =>
    crearPublicador({
        almacen,
        entregar,
        intervaloMs: Number(process.env.EVENTOS_INTERVALO_MS) || undefined,
        ...opciones
    });

/**
 * El publicador del proceso.
 *
 * Uno solo, creado al cargar el módulo pero SIN arrancar: `app.js` lo pone en
 * marcha cuando el servidor arranca de verdad, y las pruebas llaman a `ciclo()`
 * a mano. Un temporizador corriendo durante una suite haría que las entregas
 * ocurrieran en momentos que la prueba no controla, que es la forma más fácil
 * de escribir una prueba que falla un día de cada veinte.
 */
const publicador = crearPublicadorDeSalida();

/**
 * Anota `ContratoFormalizado` en la tabla de salida.
 *
 * **Tiene que ir dentro de la transacción que guarda el contrato.** Es todo el
 * sentido del patrón: las dos escrituras van a la misma base, así que o quedan
 * las dos o no queda ninguna. Registrarlo fuera reintroduce exactamente el
 * problema del ADR 0011, solo que con más código.
 */
const registrarContratoFormalizado = (contrato, transaccion) =>
    almacen.registrar(
        crearSobre(TIPO_CONTRATO_FORMALIZADO, {
            id_contrato: contrato.id_contrato,
            id_inmueble: contrato.id_inmueble,
            // `canon` es DECIMAL, y Sequelize devuelve los DECIMAL como texto
            // para no perder precisión. El evento lleva un número.
            canon: Number(contrato.canon),
            // De la columna, tal cual. `DATEONLY` ya viene como `YYYY-MM-DD`.
            fecha_inicio_corte: contrato.fecha_inicio_corte
        }),
        // El inmueble ordena: sus eventos se entregan en el orden en que se
        // registraron. Sin esto, un `Finalizado` podría adelantar a su
        // `Formalizado` y dejar el inmueble arrendado para siempre.
        { transaccion, claveOrden: contrato.id_inmueble }
    );

/** Anota `ContratoFinalizado`. Mismas condiciones que el anterior. */
const registrarContratoFinalizado = (contrato, transaccion) =>
    almacen.registrar(
        crearSobre(TIPO_CONTRATO_FINALIZADO, {
            id_contrato: contrato.id_contrato,
            id_inmueble: contrato.id_inmueble
        }),
        { transaccion, claveOrden: contrato.id_inmueble }
    );

module.exports = {
    TABLA_SALIDA,
    almacen,
    crearPublicadorDeSalida,
    publicador,
    registrarContratoFinalizado,
    registrarContratoFormalizado,
    suscriptoresDe
};
