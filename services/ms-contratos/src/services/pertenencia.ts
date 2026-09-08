/**
 * La pertenencia de un contrato. UN solo sitio, y este.
 *
 * ── QUE PROBLEMA RESUELVE ───────────────────────────────────────────────────
 *
 * Antes del paso 6d la misma pregunta —«¿este contrato es de este
 * propietario?»— estaba escrita CUATRO veces en el gateway, con cuatro formas
 * distintas y ninguna igual a otra:
 *
 *   1. `contratoPropio()` en `contrato.controller.js`, para editar y finalizar.
 *   2. `contratoAccesible()` en `anexo.controller.js`, con la disyuncion
 *      completa (dueño O inquilino) y el orden de evaluacion invertido para
 *      ahorrar una llamada de red.
 *   3. `visiblePara()` en el mismo controlador, como condicion de un `where`.
 *   4. El `count` del guardia de borrado en `routing/guardias.js`, que preguntaba
 *      lo mismo del reves: «¿tiene este inmueble contratos activos?».
 *
 * Cuatro copias que tenian que coincidir y que nada obligaba a coincidir. Aqui
 * hay una, y las cuatro la llaman.
 *
 * ── LAS DOS MITADES NO CUESTAN LO MISMO ─────────────────────────────────────
 *
 * Un contrato es de quien lo firmo como INQUILINO o de quien es DUEÑO del
 * inmueble sobre el que se firmo:
 *
 *   - **Inquilino** — `contratos.id_inquilino` esta en esta misma tabla. Es una
 *     comparacion en memoria, sin red.
 *   - **Propietario** — hace falta saber de quien es `id_inmueble`, y eso vive
 *     en ms-inmuebles. Es un salto HTTP.
 *
 * `esParteDelContrato` comprueba PRIMERO el barato. No es microoptimizacion:
 * ademas de ahorrar una peticion, hace que un inquilino pueda seguir bajandose
 * su contrato aunque ms-inmuebles este caido. La disyuncion se evalua en el
 * orden en que se puede.
 *
 * ── Y POR ESO NO SE DENORMALIZA `id_propietario` ────────────────────────────
 *
 * La tentacion es obvia: copiar el `id_propietario` en la fila del contrato y
 * quedarse sin saltos de red. No se hace, porque un inmueble puede cambiar de
 * dueño y de este dato depende toda la autorizacion del servicio. Una copia
 * vieja le daria acceso al propietario anterior y se lo negaria al nuevo, sin
 * que nada lo delatara. Ver `docs/adr/0017`.
 */

import { Op } from 'sequelize';

import { idsDePropietario, propioDe } from '../clientes/inmuebles';
import { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_ACTIVO } from '../models/constantes';
import { esUuid } from '../models/uuid';

/**
 * Los contratos sobre los inmuebles de un propietario.
 *
 * Un salto a ms-inmuebles para toda la lista, no uno por contrato.
 *
 * @throws si ms-inmuebles no responde.
 */
export const contratosDePropietario = async (sub: string): Promise<Contrato[]> => {
  const inmuebles = await idsDePropietario(sub);

  if (inmuebles.length === 0) {
    return [];
  }

  return Contrato.findAll({ where: { id_inmueble: { [Op.in]: inmuebles } } });
};

/**
 * Los contratos en los que el usuario es PARTE: dueño del inmueble O inquilino.
 *
 * Es la disyuncion completa del proyecto, resuelta donde estan los dos datos.
 * El gateway la usa para filtrar cuentas de cobro y transacciones sin tener que
 * saber nada de inmuebles.
 *
 * Un solo salto de red aunque la disyuncion tenga dos ramas: la lista de
 * inmuebles se pide una vez y las dos condiciones entran en el mismo `where`.
 *
 * @throws si ms-inmuebles no responde. NO se degrada a «solo los que arriendo»:
 *   eso le enseñaria a un propietario la mitad de sus contratos como si fueran
 *   todos, que es peor que un error.
 */
export const contratosDondeEsParte = async (sub: string): Promise<Contrato[]> => {
  const inmuebles = await idsDePropietario(sub);

  return Contrato.findAll({
    where: {
      [Op.or]: [{ id_inmueble: { [Op.in]: inmuebles } }, { id_inquilino: sub }],
    },
  });
};

/**
 * El contrato, solo si es sobre un inmueble de `sub`. `null` si no.
 *
 * Es el ABAC de las operaciones que solo puede hacer el arrendador: editar,
 * finalizar, adjuntar un anexo, reemitir la contraseña del inquilino.
 *
 * @throws si ms-inmuebles no responde.
 */
export const contratoPropio = async (
  idContrato: string,
  sub: string,
): Promise<Contrato | null> => {
  const contrato = esUuid(idContrato) ? await Contrato.findByPk(idContrato) : null;

  if (!contrato) {
    return null;
  }

  const inmueble = await propioDe(contrato.id_inmueble, sub);
  return inmueble ? contrato : null;
};

/**
 * El contrato, si `sub` es parte de el por cualquiera de las dos vias.
 *
 * Es el ABAC de lo que las DOS partes pueden hacer: ver el contrato y leer sus
 * anexos. El orden de las comprobaciones importa; ver la cabecera.
 *
 * @throws si hacia falta preguntar a ms-inmuebles y no respondio.
 */
export const contratoDondeEsParte = async (
  idContrato: string,
  sub: string,
): Promise<Contrato | null> => {
  const contrato = esUuid(idContrato) ? await Contrato.findByPk(idContrato) : null;

  if (!contrato) {
    return null;
  }

  // Camino 1: el inquilino. Local, sin red.
  if (contrato.id_inquilino === sub) {
    return contrato;
  }

  // Camino 2: el dueño del inmueble. Un salto a ms-inmuebles.
  const inmueble = await propioDe(contrato.id_inmueble, sub);
  return inmueble ? contrato : null;
};

/**
 * Los contratos ACTIVOS de un inmueble.
 *
 * Es la cuarta copia de la pregunta, la del guardia de borrado del gateway,
 * hecha del reves: no «¿de quien es este contrato?» sino «¿tiene este inmueble
 * alguno vivo?». Se resuelve sin salir del servicio, porque `id_inmueble` es
 * columna de aqui.
 *
 * NO comprueba de quien es el inmueble. De eso responde ms-inmuebles cuando le
 * llegue el borrado; lo que este dato decide es el ESTADO del recurso, que es
 * una pregunta distinta y con un codigo distinto (409, no 403).
 */
export const contratosActivosDeInmueble = async (idInmueble: string): Promise<Contrato[]> => {
  if (!esUuid(idInmueble)) {
    return [];
  }

  return Contrato.findAll({
    where: { id_inmueble: idInmueble, estado: ESTADO_CONTRATO_ACTIVO },
  });
};
