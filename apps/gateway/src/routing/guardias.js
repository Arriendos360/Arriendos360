/**
 * Guardias: reglas que dependen de dos contextos y se comprueban antes de
 * reenviar. Se montan después del RBAC y antes de la costura.
 */

const { activosDeInmueble } = require('../clientes/contratos');
const { esUuid } = require('../uuid');

const MENSAJE_CON_CONTRATO =
    'No se puede eliminar un inmueble con un contrato activo. Finaliza el contrato primero.';

/** `DELETE /api/inmuebles/:id` y nada más. */
const PATRON_BORRADO = /^\/api\/inmuebles\/([^/]+)\/?$/;

/**
 * Veta con 409 el borrado de un inmueble con contrato activo. La pertenencia la
 * comprueba ms-inmuebles.
 *
 * @param {object} [opciones]
 * @param {(id: string) => Promise<Array>} [opciones.activosDeInmueble] para que
 *   las pruebas puedan sustituir la consulta sin levantar un doble.
 */
const crearGuardiaDeBorrado = (opciones = {}) => {
    const consultar = opciones.activosDeInmueble || activosDeInmueble;

    return async function guardiaDeBorradoDeInmueble(req, res, next) {
        if (req.method !== 'DELETE') {
            return next();
        }

        const coincidencia = PATRON_BORRADO.exec(req.path);
        if (!coincidencia) {
            return next();
        }

        const id = coincidencia[1];

        // Un id mal formado no tiene contratos: que ms-inmuebles responda 404.
        if (!esUuid(id)) {
            return next();
        }

        try {
            const activos = await consultar(id);

            if (activos.length > 0) {
                return res.status(409).json({ mensaje: MENSAJE_CON_CONTRATO });
            }

            return next();
        } catch (error) {
            // Si no se pudo comprobar, 502: ni se deja pasar el borrado ni se afirma un 409.
            console.error('Error al comprobar contratos del inmueble:', error.message);
            return res
                .status(502)
                .json({ mensaje: 'No se pudo verificar el estado del inmueble' });
        }
    };
};

module.exports = {
    MENSAJE_CON_CONTRATO,
    crearGuardiaDeBorrado
};
