/**
 * IP del cliente para el servicio de destino. Se toma de la conexión o de
 * `X-Forwarded-For` tras `PROXY_SALTOS_CONFIANZA` saltos, y se reenvía firmada en
 * `X-Origen-Cliente`, con una firma nueva en cada reenvío.
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

/** Función para `app.set('trust proxy', ...)`: confía en los primeros N saltos. */
const crearConfianzaDeProxy = (entorno = process.env) => (_direccion, salto) =>
    salto < (enteroOpcionalDeEntorno('PROXY_SALTOS_CONFIANZA', entorno) ?? 0);

/**
 * Las cabeceras de origen de un reenvío. Sin secreto no se firma.
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
