/**
 * Caché en memoria de los tokens revocados.
 *
 * El Capítulo 2 lo pide así: «para que la consulta no pese en cada petición, el
 * gateway mantiene una copia en memoria de los `jti` vigentes y la refresca
 * periódicamente». Antes de la extracción esa consulta era un `SELECT` local y
 * costaba poco; ahora sería un salto de red en el camino crítico de TODA la API,
 * y convertiría a ms-identidad en punto único de fallo para cualquier petición
 * autenticada — justo lo que la verificación local del JWT evita.
 *
 * Guarda DOS cosas, porque hay dos formas de invalidar un token:
 *
 * - Los `jti` revocados uno a uno, que es lo que hace el logout.
 * - Las marcas de «este usuario cambió su contraseña en tal momento», que
 *   invalidan de golpe todas sus sesiones anteriores. Es lo que hace útil
 *   restablecer una contraseña: no hace falta saber cuántas sesiones ajenas hay
 *   abiertas ni cuáles, cosa que por definición no se sabe.
 *
 * Las dos listas son cortas por construcción: sólo cubren la última hora, porque
 * un token no vive más y el origen descarta el resto.
 *
 * Ver `docs/adr/0008` para la frecuencia elegida y la ventana que implica.
 */

const { revocadosVigentes } = require('../clientes/identidad');

/** Cada cuánto se vuelve a preguntar. Ver ADR 0008. */
const INTERVALO_POR_DEFECTO_MS = Number(process.env.REVOCADOS_INTERVALO_MS || 15000);

/**
 * Construye la caché.
 *
 * @param {{ intervaloMs?: number, obtener?: () => Promise<Array<{jti: string}>> }} [opciones]
 *   `obtener` se inyecta en las pruebas para no depender de la red.
 */
const crearCacheRevocados = (opciones = {}) => {
    const intervaloMs = opciones.intervaloMs || INTERVALO_POR_DEFECTO_MS;
    const obtener = opciones.obtener || revocadosVigentes;

    let revocados = new Set();
    /** sub -> milisegundos desde los que sus tokens dejaron de valer. */
    let sesiones = new Map();
    let ultimoExito = null;
    let ultimoError = null;
    let temporizador = null;

    /**
     * Trae la lista y reemplaza la copia local.
     *
     * Reemplazo completo, no unión: así una fila que vence desaparece sola de la
     * caché sin necesidad de barrido, igual que desaparece del origen.
     */
    const refrescar = async () => {
        try {
            const datos = await obtener();
            revocados = new Set((datos.revocados || []).map((entrada) => entrada.jti));
            sesiones = new Map(
                (datos.sesiones || []).map((entrada) => [
                    entrada.sub,
                    new Date(entrada.desde).getTime()
                ])
            );
            ultimoExito = new Date();
            ultimoError = null;
            return true;
        } catch (error) {
            ultimoError = error;
            // Se conserva la última copia buena. La alternativa —rechazarlo todo
            // ante un fallo de red— convierte un hipo de ms-identidad en una
            // caída total de la plataforma. El riesgo que se acepta está acotado:
            // un token cerrado durante el incidente sigue sirviendo, como mucho,
            // hasta que expire. Ver ADR 0008.
            console.error(
                `⚠️  No se pudo refrescar la lista de revocados (última copia buena: ${
                    ultimoExito ? ultimoExito.toISOString() : 'ninguna'
                }):`,
                error.message
            );
            return false;
        }
    };

    /**
     * ¿Dejó de valer este token? Consulta en memoria, sin red ni base.
     *
     * Recibe los claims y no sólo el `jti` porque necesita `sub` e `iat` para
     * la invalidación en bloque.
     */
    const tokenInvalidado = async (claims) => {
        if (!claims) {
            return false;
        }

        if (claims.jti && revocados.has(claims.jti)) {
            return true;
        }

        const desde = sesiones.get(claims.sub);
        return desde !== undefined && claims.iat !== undefined && claims.iat * 1000 < desde;
    };

    const iniciar = async () => {
        // Una primera carga inmediata, para no arrancar con la copia vacía.
        await refrescar();

        temporizador = setInterval(() => {
            void refrescar();
        }, intervaloMs);

        // No debe mantener vivo el proceso: si lo único pendiente es este
        // temporizador, Node tiene que poder salir.
        if (typeof temporizador.unref === 'function') {
            temporizador.unref();
        }

        return temporizador;
    };

    const detener = () => {
        if (temporizador) {
            clearInterval(temporizador);
            temporizador = null;
        }
    };

    /** Estado legible, para el log de arranque y para depurar. */
    const estado = () => ({
        vigentes: revocados.size,
        sesionesInvalidadas: sesiones.size,
        intervaloMs,
        ultimoExito,
        ultimoError: ultimoError ? ultimoError.message : null
    });

    return { detener, estado, iniciar, refrescar, tokenInvalidado };
};

module.exports = { INTERVALO_POR_DEFECTO_MS, crearCacheRevocados };
