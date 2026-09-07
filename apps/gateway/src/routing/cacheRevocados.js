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
 * La lista es corta por construcción: sólo contiene los cierres de sesión de la
 * última hora, porque `expira_en > NOW()` descarta el resto en el origen.
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
            const lista = await obtener();
            revocados = new Set(lista.map((entrada) => entrada.jti));
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

    /** ¿Está revocado este `jti`? Consulta en memoria, sin red ni base. */
    const estaRevocado = async (jti) => Boolean(jti) && revocados.has(jti);

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
        intervaloMs,
        ultimoExito,
        ultimoError: ultimoError ? ultimoError.message : null
    });

    return { detener, estado, estaRevocado, iniciar, refrescar };
};

module.exports = { INTERVALO_POR_DEFECTO_MS, crearCacheRevocados };
