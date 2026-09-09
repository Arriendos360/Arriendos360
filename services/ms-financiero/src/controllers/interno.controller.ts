/**
 * Endpoints que llama otro servicio, no una persona.
 *
 * Ninguno lleva token de usuario ni pasa por la matriz RBAC: la credencial es un
 * JWT de servicio, que `interno.routes.ts` exige de una sola vez para todo el
 * router.
 *
 * ── QUIEN LLAMA A ESTO, Y PARA QUE ─────────────────────────────────────────
 *
 * El GATEWAY, y solo para el dashboard. El dashboard vive alli por diseño
 * (regla dura 5): agrega datos de tres contextos y no tiene tablas propias.
 * Hasta el paso 6e las cuentas de cobro eran suyas y las contaba con un
 * `findAll`; ahora tiene que pedirlas, y esto es lo que las sirve.
 *
 * ── SE EXPONEN HECHOS, NO METRICAS ─────────────────────────────────────────
 *
 * Es la misma decision que tomo el `/interno` de ms-contratos, y conviene
 * repetir por que. La tentacion era devolver `{ ingresos_totales, en_mora, ...
 * }` ya sumado, que habria sido menos bytes. No se hace:
 *
 *   - El dashboard cruza cuentas de cobro con inmuebles y contratos. Si cada
 *     servicio devolviera su trozo ya agregado, el gateway no podria combinarlos
 *     — y la alternativa seria que este servicio supiera que es un dashboard,
 *     que es exactamente el acoplamiento que la regla dura 5 evita.
 *   - Una metrica es una decision de producto y cambia; una lista de cuentas de
 *     cobro con su saldo es un hecho y no cambia. Poner la metrica aqui haria
 *     que rediseñar el dashboard obligara a desplegar Financiero.
 *
 * Asi que se devuelven las cuentas, con `saldo_pendiente` ya derivado —eso si es
 * nuestro, y el gateway no tiene forma de calcularlo— y el gateway suma.
 *
 * ── FILTRAR POR CONTRATO NO ES AUTORIZAR ───────────────────────────────────
 *
 * `?contratos=a,b,c` no comprueba de quien son esos contratos, y no debe: quien
 * llama ya lo comprobo con datos que este servicio no tiene. Es el mismo reparto
 * que el `/interno` de ms-inmuebles. Lo que protege el endpoint es la credencial
 * de servicio, no una regla de negocio.
 */

import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { crearError } from 'arriendos360-shared';

import { CuentaCobro } from '../models/CuentaCobro';
import { esUuid } from '../models/uuid';
import { conSaldos } from '../services/saldos';

/** Limite de identificadores por peticion. Ver la nota de `listarCuentas`. */
const MAX_CONTRATOS = 500;

/**
 * GET /interno/cuentas-cobro?contratos=a,b,c[&estado=PAGADA]
 *
 * Las cuentas de cobro de esos contratos, con `saldo_pendiente` derivado.
 *
 * SIN `contratos` NO se devuelve la tabla entera: este endpoint sirve para
 * componer la respuesta de alguien concreto, no para volcar el catalogo. Una
 * lista vacia devuelve una lista vacia, que no es lo mismo que no filtrar — un
 * propietario sin contratos tiene cero cuentas de cobro, y eso es un hecho.
 *
 * `estado` acepta varios separados por coma: el dashboard pide las PAGADA para
 * los ingresos y las PENDIENTE/EN_MORA para la mora, y hacerlo en dos peticiones
 * seria pedir dos veces lo mismo.
 */
export const listarCuentas = async (req: Request, res: Response): Promise<Response> => {
  const { contratos, estado } = req.query;

  if (typeof contratos !== 'string') {
    return res.status(400).json(crearError('Indica `contratos` con una lista de identificadores'));
  }

  // Los que no tienen forma de UUID se descartan aqui y no en la consulta:
  // PostgreSQL rechazaria el tipo y saldria un 500 por una entrada mala.
  const ids = contratos
    .split(',')
    .map((valor) => valor.trim())
    .filter(esUuid);

  if (ids.length === 0) {
    return res.json({ cuentas_cobro: [] });
  }

  // El tope existe porque la lista viaja en la URL y un propietario con miles de
  // contratos la desbordaria. Se rechaza en vez de truncar: truncar devolveria
  // un dashboard con cifras que parecen correctas y no lo son. Si algun dia se
  // alcanza, la salida es paginar; hoy no.
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

    // `saldo_pendiente` va derivado: es lo unico de esta respuesta que el
    // gateway no podria calcular por su cuenta, porque necesitaria las
    // transacciones.
    return res.json({ cuentas_cobro: await conSaldos(cuentas) });
  } catch (error) {
    console.error('Error al listar cuentas de cobro:', (error as Error).message);
    return res.status(500).json(crearError('No se pudieron obtener las cuentas de cobro'));
  }
};
