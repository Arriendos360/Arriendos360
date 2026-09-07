/**
 * Comprobaciones que el gateway hace ANTES de reenviar a un servicio.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Hay reglas que ningún servicio puede aplicar
 * solo, porque dependen de datos de otro contexto. «No borres un inmueble que
 * tiene contrato activo» es una de ellas: la escribe Inmuebles pero la decide
 * Contratos.
 *
 * Ms-inmuebles es subdominio de Soporte y Contratos es Core. Si ms-inmuebles
 * consultara contratos para decidir, un servicio de Soporte dependería de uno de
 * Core y se invertiría la dirección de las dependencias — el mismo razonamiento
 * por el que la reemisión de la contraseña temporal vive aquí y no en
 * ms-identidad (`docs/adr/0010`).
 *
 * Así que la regla vive donde están los dos datos: el gateway.
 *
 * DÓNDE SE MONTA. Entre el control de acceso y la costura. Después del RBAC,
 * porque necesita saber quién pregunta; antes de la costura, porque su trabajo
 * es decidir si la petición llega siquiera a salir a la red.
 *
 * Un guardia que no opina llama a `next()` y la costura sigue su curso normal.
 */

const { Op } = require('sequelize');

const Contrato = require('../models/Contrato');
const { esUuid } = require('../models/uuid');

/** Estados de contrato que impiden borrar el inmueble. Hoy solo el activo. */
const ESTADOS_QUE_BLOQUEAN = [1];

const MENSAJE_CON_CONTRATO =
    'No se puede eliminar un inmueble con un contrato activo. Finaliza el contrato primero.';

/** `DELETE /api/inmuebles/:id` y nada más. */
const PATRON_BORRADO = /^\/api\/inmuebles\/([^/]+)\/?$/;

/**
 * Veta el borrado de un inmueble que tenga contrato activo.
 *
 * Responde **409 y no 403**: no es un problema de permisos —el inmueble es suyo
 * y su rol es el correcto, las dos capas de autorización ya dijeron que sí—,
 * sino del estado del recurso. Un 403 le diría al propietario que no tiene
 * derecho a borrar su propio inmueble, que es falso y no le dice qué hacer.
 *
 * NO comprueba la pertenencia: de eso se encarga ms-inmuebles, y responde 404 si
 * el inmueble es de otro. Aquí solo se mira el estado. El orden tiene una
 * consecuencia menor y aceptable: alguien que pida borrar un inmueble ajeno CON
 * contrato activo recibe 409 en vez de 404, y con ello aprende que ese
 * identificador existe. Es un identificador que ya tenía en la mano, y evitarlo
 * costaría una consulta a ms-inmuebles antes de cada borrado.
 */
const crearGuardiaDeBorrado = (opciones = {}) => {
    const modelo = opciones.Contrato || Contrato;

    return async function guardiaDeBorradoDeInmueble(req, res, next) {
        if (req.method !== 'DELETE') {
            return next();
        }

        const coincidencia = PATRON_BORRADO.exec(req.path);
        if (!coincidencia) {
            return next();
        }

        const id = coincidencia[1];

        // Un identificador con forma inválida no puede tener contratos. Se deja
        // pasar para que sea ms-inmuebles quien responda 404, y así el gateway
        // no adivina respuestas que no son suyas.
        if (!esUuid(id)) {
            return next();
        }

        try {
            const activos = await modelo.count({
                where: { id_inmueble: id, estado: { [Op.in]: ESTADOS_QUE_BLOQUEAN } }
            });

            if (activos > 0) {
                return res.status(409).json({ mensaje: MENSAJE_CON_CONTRATO });
            }

            return next();
        } catch (error) {
            // La consulta es local: si falla, algo va mal en el gateway, no en
            // la red. No se deja pasar el borrado «por si acaso» — sería
            // permitir justo lo que este guardia existe para impedir.
            console.error('Error al comprobar contratos del inmueble:', error.message);
            return res.status(500).json({ mensaje: 'No se pudo verificar el estado del inmueble' });
        }
    };
};

module.exports = {
    ESTADOS_QUE_BLOQUEAN,
    MENSAJE_CON_CONTRATO,
    crearGuardiaDeBorrado
};
