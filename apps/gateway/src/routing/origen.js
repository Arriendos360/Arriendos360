/**
 * La IP del cliente, tal como la ve el gateway, para el servicio de destino.
 *
 * ── DE DÓNDE SALE LA IP ─────────────────────────────────────────────────────
 *
 * De la conexión, salvo que haya proxies delante: entonces de `X-Forwarded-For`,
 * pero SÓLO tras tantos saltos como diga `PROXY_SALTOS_CONFIANZA`. Vacía en local y
 * en Compose, donde el cliente llega directo; 1 en Container Apps, donde llega por
 * su ingreso. Un número mayor que el real deja que el cliente elija su IP; uno menor
 * cuenta a todo el mundo bajo la IP del proxy.
 *
 * ── Y CÓMO LLEGA AL SERVICIO ────────────────────────────────────────────────
 *
 * `proxy.js` copia las cabeceras entrantes, así que `X-Forwarded-For` —y cualquier
 * otra cabecera de origen— la podía escribir el cliente. Ahora se descartan las que
 * trae y se ponen dos: `X-Forwarded-For` con la IP resuelta, para los logs, y
 * `X-Origen-Cliente` con esa misma IP FIRMADA, que es la única en la que un servicio
 * puede confiar. ms-identidad la usa para limitar intentos (`docs/adr/0020`).
 *
 * La firma se hace en CADA reenvío y no se guarda en ningún sitio: un token
 * reutilizado contaría a todos los clientes bajo la IP del primero.
 */

const {
    CABECERA_ORIGEN_CLIENTE,
    enteroOpcionalDeEntorno,
    firmarOrigenCliente,
    leerEntorno,
    textoDeEntorno
} = require('arriendos360-shared');

/** Cabeceras de origen que puede traer el cliente y que no se reenvían nunca. */
const CABECERAS_DE_ORIGEN = new Set(['x-forwarded-for', 'forwarded', 'x-real-ip', CABECERA_ORIGEN_CLIENTE]);

/**
 * Función para `app.set('trust proxy', ...)`: confía en los primeros N saltos.
 *
 * Lee la variable en cada petición, no al cargar: así las pruebas pueden inyectar
 * su propio entorno.
 */
const crearConfianzaDeProxy = (entorno = process.env) => (_direccion, salto) =>
    salto < (enteroOpcionalDeEntorno('PROXY_SALTOS_CONFIANZA', entorno) ?? 0);

/**
 * Las cabeceras de origen de UN reenvío.
 *
 * Sin secreto no se firma nada —el arranque exige `SERVICIO_JWT_SECRET`, así que eso
 * sólo pasa en una prueba aislada— y el servicio caerá en la IP de su conexión.
 *
 * @param {import('express').Request} req
 * @param {string|null} servicio nombre del destino, que es la audiencia de la firma
 * @param {{ secretoServicio?: string }} [opciones]
 */
const cabecerasDeOrigen = (req, servicio, opciones = {}) => {
    const ip = req.ip || req.socket.remoteAddress || 'desconocida';
    const cabeceras = { 'x-forwarded-for': ip };

    const secreto = opciones.secretoServicio ?? leerEntorno('SERVICIO_JWT_SECRET');
    if (secreto && servicio) {
        cabeceras[CABECERA_ORIGEN_CLIENTE] = firmarOrigenCliente({
            ip,
            emisor: textoDeEntorno('SERVICIO_NOMBRE', 'gateway'),
            destinatario: servicio,
            secreto
        });
    }

    return cabeceras;
};

module.exports = {
    CABECERAS_DE_ORIGEN,
    cabecerasDeOrigen,
    crearConfianzaDeProxy
};
