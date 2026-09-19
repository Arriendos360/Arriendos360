/**
 * Composición de datos de otros servicios en las respuestas del gateway.
 *
 * Hoy la usa solo el dashboard (`/contratos-activos`): los contratos llegan de
 * ms-contratos y el inmueble de cada uno se pide a ms-inmuebles.
 *
 * Recoge los identificadores de la colección entera y hace UNA sola petición.
 * Componer dentro de un bucle sería cambiar un JOIN por N llamadas de red.
 */

const { porIds: inmueblesPorIds } = require('./inmuebles');

/** Convierte una instancia de Sequelize en objeto plano, o lo deja pasar. */
const aPlano = (entidad) => (entidad && typeof entidad.toJSON === 'function' ? entidad.toJSON() : entidad);

/**
 * Adjunta `Inmueble` a una lista de contratos.
 *
 * Una sola petición para toda la lista, con los identificadores recogidos de
 * antemano.
 *
 * Si ms-inmuebles no responde, la propiedad queda en `null`: esto es DECORAR, no
 * autorizar. Los consumidores que AUTORIZAN a partir de `Inmueble.id_propietario`
 * no pueden conformarse con eso y no usan esta función: piden la lista por su
 * cuenta y dejan que el fallo se propague. Ver `clientes/inmuebles.js`.
 */
const adjuntarInmuebles = async (contratos) => {
    const lista = (contratos || []).map(aPlano);
    const inmuebles = await inmueblesPorIds(lista.map((contrato) => contrato.id_inmueble));

    return lista.map((contrato) => ({
        ...contrato,
        Inmueble: inmuebles.get(contrato.id_inmueble) || null
    }));
};

module.exports = { adjuntarInmuebles };
