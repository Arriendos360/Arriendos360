/**
 * Composición de datos de otros servicios sobre entidades del gateway.
 *
 * Sustituye a los `include` que cruzaban la frontera de ms-identidad y, desde el
 * paso 4, también los de ms-inmuebles. La forma del resultado es exactamente la
 * que producía Sequelize —`Inquilino` y `Propietario` como objetos con
 * `id_usuario`, `nombres`, `apellidos`, `documento`, `telefono` y `email`;
 * `Inmueble` anidado en el contrato— para que ni el frontend ni los PDF noten la
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
const { porIds: inmueblesPorIds } = require('./inmuebles');

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
 * Adjunta al contrato su `Inmueble`, el `Propietario` de ese inmueble y su
 * `Inquilino`.
 *
 * Es lo que necesita el motor financiero: avisa a las dos partes, y para saber
 * a quién avisar hace falta la cadena entera.
 *
 * DOS SALTOS, y no se pueden paralelizar: hasta que ms-inmuebles no dice de
 * quién es cada inmueble, no se sabe qué propietarios pedirle a ms-identidad.
 * Lo que sí se hace es pedirlos todos de una vez, junto con los inquilinos, en
 * una sola petición.
 *
 * Antes esto era un `include` anidado de dos niveles. La forma del resultado se
 * conserva exactamente —`contrato.Inmueble.Propietario.email` sigue siendo la
 * ruta— para que el motor no se entere.
 */
const adjuntarPartes = async (contratos) => {
    const lista = (contratos || []).map(aPlano);

    const inmuebles = await inmueblesPorIds(lista.map((contrato) => contrato.id_inmueble));

    const ids = [];
    for (const contrato of lista) {
        ids.push(contrato.id_inquilino);
        const inmueble = inmuebles.get(contrato.id_inmueble);
        if (inmueble) {
            ids.push(inmueble.id_propietario);
        }
    }

    const usuarios = await usuariosPorIds(ids);

    return lista.map((contrato) => {
        const inmueble = inmuebles.get(contrato.id_inmueble);

        return {
            ...contrato,
            Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino)),
            Inmueble: inmueble
                ? { ...inmueble, Propietario: comoUsuario(usuarios.get(inmueble.id_propietario)) }
                : null
        };
    });
};

/**
 * Adjunta `Inmueble` a una lista de contratos.
 *
 * Ocupa el lugar exacto de `include: [{ model: Inmueble }]`. Una sola petición
 * para toda la lista, con los identificadores recogidos de antemano.
 *
 * Si ms-inmuebles no responde, la propiedad queda en `null` — igual que quedaba
 * cuando el `include` no encontraba fila. Los consumidores que AUTORIZAN a
 * partir de `Inmueble.id_propietario` no pueden conformarse con eso y no usan
 * esta función: piden la lista de identificadores por su cuenta y dejan que el
 * fallo se propague. Ver `clientes/inmuebles.js`.
 */
const adjuntarInmuebles = async (contratos) => {
    const lista = (contratos || []).map(aPlano);
    const inmuebles = await inmueblesPorIds(lista.map((contrato) => contrato.id_inmueble));

    return lista.map((contrato) => ({
        ...contrato,
        Inmueble: inmuebles.get(contrato.id_inmueble) || null
    }));
};

/** Adjunta `Inmueble` a un solo contrato. */
const adjuntarInmueble = async (contrato) => {
    if (!contrato) {
        return contrato;
    }

    const [conInmueble] = await adjuntarInmuebles([contrato]);
    return conInmueble;
};

/**
 * Adjunta `Inquilino` E `Inmueble` a una lista de contratos, en dos viajes.
 *
 * Dos y no cuatro: cada servicio se consulta una vez para toda la lista, y los
 * dos en paralelo porque no dependen entre sí.
 */
const adjuntarInquilinosEInmuebles = async (contratos) => {
    const lista = (contratos || []).map(aPlano);

    const [usuarios, inmuebles] = await Promise.all([
        usuariosPorIds(lista.map((contrato) => contrato.id_inquilino)),
        inmueblesPorIds(lista.map((contrato) => contrato.id_inmueble))
    ]);

    return lista.map((contrato) => ({
        ...contrato,
        Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino)),
        Inmueble: inmuebles.get(contrato.id_inmueble) || null
    }));
};

module.exports = {
    adjuntarInmueble,
    adjuntarInmuebles,
    adjuntarInquilino,
    adjuntarInquilinos,
    adjuntarInquilinosEInmuebles,
    adjuntarPartes,
    comoUsuario
};
