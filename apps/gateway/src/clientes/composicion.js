/**
 * Composición de datos de usuario sobre entidades del gateway.
 *
 * Sustituye a los `include` que cruzaban la frontera de ms-identidad. La forma
 * del resultado es exactamente la que producía Sequelize —`Inquilino` y
 * `Propietario` como objetos con `id_usuario`, `nombres`, `apellidos`,
 * `documento`, `telefono` y `email`— para que ni el frontend ni los PDF noten la
 * diferencia. Lo único que cambió es de dónde salen los datos.
 *
 * Todas las funciones recogen los identificadores de la colección entera y hacen
 * UNA sola petición. Componer dentro de un bucle sería cambiar un JOIN por N
 * llamadas de red, que es peor que el problema que se estaba resolviendo.
 *
 * Si ms-identidad no responde, el cliente devuelve un mapa vacío y aquí la
 * propiedad queda en `null`. Es la misma situación que ya podía darse cuando el
 * `include` no encontraba fila, así que los consumidores ya la manejan.
 */

const { usuariosPorIds } = require('./identidad');

/** Da al usuario del servicio la forma que tenía el modelo del monolito. */
const comoUsuario = (usuario) =>
    usuario
        ? {
              id_usuario: usuario.id,
              nombres: usuario.nombres,
              apellidos: usuario.apellidos,
              documento: usuario.documento,
              telefono: usuario.telefono,
              email: usuario.email
          }
        : null;

/** Convierte una instancia de Sequelize en objeto plano, o lo deja pasar. */
const aPlano = (entidad) => (entidad && typeof entidad.toJSON === 'function' ? entidad.toJSON() : entidad);

/**
 * Adjunta `Inquilino` a una lista de contratos.
 *
 * @param {Array} contratos instancias o planos, con `id_inquilino`
 * @returns {Promise<Array>} los mismos contratos, planos y con `Inquilino`
 */
const adjuntarInquilinos = async (contratos) => {
    const lista = (contratos || []).map(aPlano);
    const usuarios = await usuariosPorIds(lista.map((contrato) => contrato.id_inquilino));

    return lista.map((contrato) => ({
        ...contrato,
        Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino))
    }));
};

/** Adjunta `Inquilino` a un solo contrato. */
const adjuntarInquilino = async (contrato) => {
    if (!contrato) {
        return contrato;
    }

    const [conInquilino] = await adjuntarInquilinos([contrato]);
    return conInquilino;
};

/**
 * Adjunta `Propietario` a los inmuebles anidados de una lista de contratos y,
 * a la vez, `Inquilino` a los contratos.
 *
 * Es lo que necesita el motor financiero: avisa a las dos partes, así que pedir
 * inquilinos y propietarios por separado serían dos viajes donde basta uno.
 */
const adjuntarPartes = async (contratos) => {
    const lista = (contratos || []).map(aPlano);

    const ids = [];
    for (const contrato of lista) {
        ids.push(contrato.id_inquilino);
        if (contrato.Inmueble) {
            ids.push(contrato.Inmueble.id_propietario);
        }
    }

    const usuarios = await usuariosPorIds(ids);

    return lista.map((contrato) => ({
        ...contrato,
        Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino)),
        ...(contrato.Inmueble
            ? {
                  Inmueble: {
                      ...contrato.Inmueble,
                      Propietario: comoUsuario(usuarios.get(contrato.Inmueble.id_propietario))
                  }
              }
            : {})
    }));
};

module.exports = { adjuntarInquilino, adjuntarInquilinos, adjuntarPartes, comoUsuario };
