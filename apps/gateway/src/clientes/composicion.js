/** Composición de datos de otros servicios en las respuestas del gateway. */

const { porIds: inmueblesPorIds } = require('./inmuebles');

/** Convierte una instancia de Sequelize en objeto plano, o lo deja pasar. */
const aPlano = (entidad) => (entidad && typeof entidad.toJSON === 'function' ? entidad.toJSON() : entidad);

/**
 * Adjunta `Inmueble` a una lista de contratos con una sola petición. Si
 * ms-inmuebles no responde, queda en `null`: sirve para decorar, no para autorizar.
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
