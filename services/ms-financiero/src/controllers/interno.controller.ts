/**
 * Endpoints para otros servicios (el dashboard del gateway). La credencial de
 * servicio la exige el router. Devuelven cuentas con su saldo, no métricas.
 */

import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { crearError } from 'arriendos360-shared';

import { CuentaCobro } from '../models/CuentaCobro';
import { esUuid } from '../models/uuid';
import { conSaldos } from '../services/saldos';

/** Límite de contratos por petición. */
const MAX_CONTRATOS = 500;

/**
 * GET /interno/cuentas-cobro?contratos=a,b,c[&estado=PAGADA,EN_MORA]
 *
 * Las cuentas de cobro de esos contratos, con `saldo_pendiente`. No comprueba de
 * quién son los contratos: eso lo hace quien llama. Sin `contratos`, 400.
 */
export const listarCuentas = async (req: Request, res: Response): Promise<Response> => {
  const { contratos, estado } = req.query;

  if (typeof contratos !== 'string') {
    return res.status(400).json(crearError('Indica `contratos` con una lista de identificadores'));
  }

  // Se descartan los que no son UUID, que PostgreSQL rechazaría.
  const ids = contratos
    .split(',')
    .map((valor) => valor.trim())
    .filter(esUuid);

  if (ids.length === 0) {
    return res.json({ cuentas_cobro: [] });
  }

  // Pasado el tope se rechaza en vez de truncar, que daría cifras falsas.
  if (ids.length > MAX_CONTRATOS) {
    return res
      .status(400)
      .json(crearError(`No se pueden consultar mas de ${MAX_CONTRATOS} contratos por peticion`));
  }

  try {
    const estados =
      typeof estado === 'string' && estado !== ''
        ? estado.split(',').map((valor) => valor.trim())
        : null;

    const cuentas = await CuentaCobro.findAll({
      where: {
        id_contrato: { [Op.in]: ids },
        ...(estados ? { estado: { [Op.in]: estados } } : {}),
      },
      order: [['inicio', 'ASC']],
    });

    return res.json({ cuentas_cobro: await conSaldos(cuentas) });
  } catch (error) {
    console.error('Error al listar cuentas de cobro:', (error as Error).message);
    return res.status(500).json(crearError('No se pudieron obtener las cuentas de cobro'));
  }
};
