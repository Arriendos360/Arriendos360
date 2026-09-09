/**
 * Composición de datos de otros servicios sobre entidades del gateway.
 *
 * Sustituye a los `include` que cruzaban la frontera de ms-identidad, desde el
 * paso 4 los de ms-inmuebles y desde el 6d los de ms-contratos. La forma del resultado es exactamente la
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

const { porIds: contratosPorIds } = require('./contratos');
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

/**
 * Adjunta el `Contrato` —y dentro de él su `Inmueble`— a una lista de cuentas
 * de cobro o de transacciones.
 *
 * ── ESTO ERA UN `include` HASTA EL PASO 6d ──────────────────────────────────
 *
 * Las cuentas de cobro y las transacciones no llevan `id_inmueble` propio:
 * cuelgan de un contrato, y es ese contrato el que sabe de qué inmueble se
 * trata. Mientras `contratos` vivió en la base del gateway, la primera mitad la
 * resolvía Sequelize con un `include` y sólo había que componer el inmueble.
 * Ahora hay que componer los dos, y la pantalla de Pagos sigue leyendo la misma
 * ruta (`cuenta.Contrato.Inmueble.direccion`), así que la forma del resultado no
 * cambia.
 *
 * ── DOS VIAJES PARA LA LISTA ENTERA, NO DOS POR FILA ────────────────────────
 *
 * Es la misma disciplina que el resto de este archivo, y aquí importa el doble
 * porque son dos saltos encadenados: hasta que ms-contratos no dice de qué
 * inmueble es cada contrato, no se sabe qué inmuebles pedir. Lo que sí se hace
 * es pedirlos TODOS de una vez en cada salto. Una petición por cuenta de cobro
 * sería el N+1 de siempre, multiplicado por dos.
 *
 * ── Y SI ALGUNO NO RESPONDE, LA PROPIEDAD QUEDA EN `null` ───────────────────
 *
 * Esto es DECORAR, no autorizar: la lista ya se filtró antes con los contratos
 * de quien pregunta. Un listado sin la dirección del inmueble sigue siendo
 * útil; un 502 en la pantalla entera porque ms-inmuebles tosió, no. Es la misma
 * situación que ya podía darse cuando el `include` no encontraba fila, así que
 * los consumidores ya la manejan.
 *
 * @param {Array} elementos cuentas de cobro o transacciones
 * @param {(elemento: object) => object|null|undefined} contenedor dónde colgar
 *   el `Contrato`: el propio elemento, o su `CuentaCobro` si va un nivel abajo
 */
const adjuntarContratoConInmueble = async (elementos, contenedor) => {
    const lista = (elementos || []).map(aPlano);
    const destinos = lista.map((elemento) => contenedor(elemento)).filter(Boolean);

    const contratos = await contratosPorIds(destinos.map((d) => d.id_contrato));

    // Segundo salto: sólo ahora se sabe qué inmuebles hacen falta.
    const inmuebles = await inmueblesPorIds(
        [...contratos.values()].map((contrato) => contrato.id_inmueble)
    );

    for (const elemento of lista) {
        const destino = contenedor(elemento);
        if (!destino) {
            continue;
        }

        const contrato = contratos.get(destino.id_contrato);
        destino.Contrato = contrato
            ? { ...contrato, Inmueble: inmuebles.get(contrato.id_inmueble) || null }
            : null;
    }

    return lista;
};

/** `cuenta.Contrato.Inmueble`. */
const adjuntarContratoACuentas = (cuentas) =>
    adjuntarContratoConInmueble(cuentas, (cuenta) => cuenta);

/** `transaccion.CuentaCobro.Contrato.Inmueble`. */
const adjuntarContratoATransacciones = (transacciones) =>
    adjuntarContratoConInmueble(transacciones, (transaccion) => transaccion.CuentaCobro);

module.exports = {
    adjuntarContratoACuentas,
    adjuntarContratoATransacciones,
    adjuntarContratoConInmueble,
    adjuntarInmueble,
    adjuntarInmuebles,
    adjuntarInquilino,
    adjuntarInquilinos,
    adjuntarInquilinosEInmuebles,
    adjuntarPartes,
    comoUsuario
};
