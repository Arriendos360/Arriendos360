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
 * Core y se invertiría la dirección de las dependencias.
 *
 * Así que la regla vive donde se puede componer la respuesta: el gateway.
 *
 * DÓNDE SE MONTA. Entre el control de acceso y la costura. Después del RBAC,
 * porque necesita saber quién pregunta; antes de la costura, porque su trabajo
 * es decidir si la petición llega siquiera a salir a la red.
 *
 * Un guardia que no opina llama a `next()` y la costura sigue su curso normal.
 *
 * ── QUÉ CAMBIA EN EL PASO 6d ────────────────────────────────────────────────
 *
 * El dato que decide dejó de ser local. Esto era un `Contrato.count(...)` contra
 * la base del gateway; ahora es una pregunta a ms-contratos, que es una de las
 * tres comprobaciones de pertenencia que el paso 6d colapsa en un solo sitio
 * —`services/pertenencia.ts` de ese servicio— en vez de tenerlas repartidas.
 *
 * Lo que NO cambia es dónde vive la regla ni por qué. El guardia sigue aquí,
 * porque sigue siendo el gateway quien cruza los dos contextos: pregunta a
 * Contratos y decide si deja pasar el borrado hacia Inmuebles. Moverlo a
 * ms-inmuebles seguiría invirtiendo la dirección de las dependencias, y moverlo
 * a ms-contratos lo pondría a opinar sobre una petición que no es suya.
 */

const { activosDeInmueble } = require('../clientes/contratos');
const { esUuid } = require('../uuid');

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
 * identificador existe. Es un identificador que ya tenía en la mano.
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

        // Un identificador con forma inválida no puede tener contratos. Se deja
        // pasar para que sea ms-inmuebles quien responda 404, y así el gateway
        // no adivina respuestas que no son suyas.
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
            // Antes esta consulta era local y un fallo significaba «algo va mal
            // en el gateway». Ahora es de red y significa «no se pudo
            // comprobar», que es peor: el borrado es irreversible.
            //
            // NO se deja pasar «por si acaso» — sería permitir justo lo que este
            // guardia existe para impedir. Y no se responde 409, que afirmaría
            // que hay un contrato activo sin haberlo visto. **502**: no se pudo
            // preguntar, y quien lo lea sabe que el problema no es su inmueble.
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
