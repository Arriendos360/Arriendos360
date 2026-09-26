/**
 * Pertenencia de un contrato: único sitio donde se decide si un usuario es su
 * propietario (dueño del inmueble, en ms-inmuebles) o su inquilino (local).
 *
 * No denormalices `id_propietario` en `Contratos`: un inmueble cambia de dueño y
 * de ese dato depende la autorización.
 */

import { Op } from 'sequelize';

import { idsDePropietario, propioDe } from '../clientes/inmuebles';
import { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_ACTIVO } from '../models/constantes';
import { esUuid } from '../models/uuid';

/**
 * Los contratos sobre los inmuebles de un propietario, con una sola petición a
 * ms-inmuebles.
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
 * Los contratos donde el usuario es dueño del inmueble o inquilino.
 *
 * @throws si ms-inmuebles no responde; nunca devuelve sólo la mitad de inquilino.
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
 * El contrato, sólo si es sobre un inmueble de `sub`; si no, `null`. Autoriza lo
 * que sólo hace el propietario.
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
 * El contrato, si `sub` es su inquilino o el dueño del inmueble. Comprueba primero
 * el inquilino, que no necesita red.
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

/** Los contratos activos de un inmueble, sin comprobar de quién es. */
export const contratosActivosDeInmueble = async (idInmueble: string): Promise<Contrato[]> => {
  if (!esUuid(idInmueble)) {
    return [];
  }

  return Contrato.findAll({
    where: { id_inmueble: idInmueble, estado: ESTADO_CONTRATO_ACTIVO },
  });
};
