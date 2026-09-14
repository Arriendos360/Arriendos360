/**
 * Emision de cuentas de cobro. El UNICO sitio que las crea.
 *
 * ── POR QUE EXISTE ESTE ARCHIVO ─────────────────────────────────────────────
 *
 * Porque hay TRES caminos que crean una cuenta de cobro, y desde el paso 7 los tres
 * tienen que hacer una segunda cosa —anotar `CuentaCobroGenerada`— en la misma
 * transaccion:
 *
 *   1. el consumidor de `ContratoFormalizado`, que crea la PRIMERA;
 *   2. el barrido del motor, que crea las de los meses siguientes;
 *   3. `POST /api/pagos/cuentas-cobro`, el alta manual del propietario.
 *
 * Tres sitios que tienen que acordarse de lo mismo son tres sitios donde uno puede
 * olvidarse, y el olvido no se notaria: la cuenta se crearia igual y simplemente no
 * saldria el correo. Un fallo silencioso, que es la clase que este proyecto trata
 * con mas cuidado.
 *
 * Asi que el INSERT vive aqui y los tres llaman a esta funcion. Es el mismo
 * razonamiento que puso la pertenencia de un contrato en un solo sitio en el paso 6d
 * —«se contestaba CUATRO veces, con cuatro formas distintas»— aplicado a una
 * escritura en vez de a una consulta.
 *
 * ── EL ALTA MANUAL PASA A NOTIFICAR, Y ESO ES NUEVO ─────────────────────────
 *
 * Antes del paso 7 solo el motor mandaba el correo de «recibo generado»; el alta
 * manual creaba la cuenta en silencio. Unificar los tres caminos le añade el aviso.
 *
 * Es deliberado y esta documentado en `docs/adr/0019`: el hecho es el mismo —se le
 * emitio una factura a alguien— y quien la recibe tiene el mismo derecho a
 * enterarse la haya generado un barrido o una persona. La alternativa era un
 * parametro `avisar: false` para ese camino, es decir, exactamente la puerta por la
 * que se cuelan los tres-sitios-que-hacen-cosas-distintas que este archivo existe
 * para cerrar.
 */

import crypto from 'crypto';
import type { Transaction } from 'sequelize';

import { sequelize } from '../config/database';
import { CuentaCobro } from '../models/CuentaCobro';
import { ESTADO_CUENTA_PENDIENTE } from '../models/constantes';
import { registrarCuentaCobroGenerada } from '../eventos/salida';

/** Lo que hace falta para emitir una cuenta de cobro. */
export interface DatosEmision {
  id_contrato: string;
  /**
   * A quien se le factura.
   *
   * NO es una columna de `Cuentas_cobro` y no se guarda: la cuenta cuelga del
   * contrato, y el inquilino es del contrato. Se pide aqui porque el EVENTO lo
   * necesita —ms-notificaciones tiene que saber a quien avisar— y quien llama lo
   * tiene a mano en los tres casos: el sobre de `ContratoFormalizado` lo trae desde
   * su version 2, y los otros dos caminos ya piden el contrato a ms-contratos.
   *
   * Puede faltar, y el unico caso real es un `ContratoFormalizado` version 1 que
   * estuviera en la tabla de salida durante el despliegue del paso 7. Entonces la
   * cuenta se crea y el aviso se omite, con un registro alto: facturar sin avisar es
   * una degradacion aceptable; no facturar, no.
   */
  id_inquilino?: string | undefined;
  valor: number | string;
  inicio: string;
  fin: string;
  detalle: string;
  /** Quien queda en las columnas de auditoria. Ausente = USUARIO_SISTEMA. */
  auditor?: string | undefined;
}

/** Una emision hecha: la fila y si se anuncio. */
export interface Emision {
  cuenta: CuentaCobro;
  /** `false` si no habia a quien avisar. Ver `id_inquilino`. */
  anunciada: boolean;
}

/**
 * Crea la cuenta de cobro y anota su evento, en la MISMA transaccion.
 *
 * @param transaccion la del llamante, si ya tiene una abierta. El consumidor del bus
 *   SIEMPRE la pasa —la suya es la que lleva la marca del `id_evento`, y escribir
 *   fuera de ella perderia la atomicidad que da sentido a todo el mecanismo—. Los
 *   otros dos caminos no tienen ninguna, asi que esto abre una.
 */
export const emitirCuentaCobro = async (
  datos: DatosEmision,
  transaccion?: unknown,
): Promise<Emision> => {
  const dentroDe = async (tx: Transaction): Promise<Emision> => {
    // El UUID se genera aqui, antes del INSERT, porque el evento lo necesita: es la
    // razon por la que este proyecto no usa `DEFAULT gen_random_uuid()`.
    const idCuentaCobro = crypto.randomUUID();

    const cuenta = await CuentaCobro.create(
      {
        id_cuenta_cobro: idCuentaCobro,
        id_contrato: datos.id_contrato,
        detalle: datos.detalle,
        valor: datos.valor,
        inicio: datos.inicio,
        fin: datos.fin,
        estado: ESTADO_CUENTA_PENDIENTE,
      },
      // `usuarioAuditor` ausente cae en USUARIO_SISTEMA, que es lo correcto para el
      // motor y para el consumidor del evento: el sobre no lleva actor, asi que la
      // persona que firmo el contrato no esta disponible aqui. Ver `docs/adr/0011`.
      { transaction: tx, ...(datos.auditor ? { usuarioAuditor: datos.auditor } : {}) } as never,
    );

    if (!datos.id_inquilino) {
      console.warn(
        `⚠️  ms-financiero: cuenta de cobro ${idCuentaCobro} creada SIN aviso — no se ` +
          'conoce el inquilino del contrato ' +
          `${datos.id_contrato}. Probablemente un ContratoFormalizado versión 1.`,
      );
      return { cuenta, anunciada: false };
    }

    await registrarCuentaCobroGenerada(
      {
        id_cuenta_cobro: idCuentaCobro,
        id_contrato: datos.id_contrato,
        id_inquilino: datos.id_inquilino,
        // `valor` puede llegar como texto: Sequelize devuelve los DECIMAL como
        // cadena para no perder precision. El evento lleva un numero.
        valor: Number(datos.valor),
        inicio: datos.inicio,
        fin: datos.fin,
      },
      tx,
    );

    return { cuenta, anunciada: true };
  };

  return transaccion
    ? dentroDe(transaccion as Transaction)
    : sequelize.transaction((tx) => dentroDe(tx));
};
