/**
 * Motor financiero: genera las cuentas de cobro de los meses siguientes al primero
 * y aplica los vencimientos (aviso previo y mora). Los avisos se anotan como
 * eventos en la misma transacción que el cambio.
 *
 * - La primera cuenta de cada contrato la crea el consumidor de
 *   `ContratoFormalizado`; este barrido salta SIEMPRE el primer periodo.
 * - Las fechas son de `America/Bogota` (`hoyEnZonaNegocio`, `diasEntre`).
 * - Hace un número fijo de peticiones a ms-contratos, sin importar cuántos
 *   contratos haya. No pidas el contrato dentro del bucle.
 * - Es idempotente: puede correr dos veces el mismo día, seguidas o a la vez, sin
 *   duplicar cuentas ni avisos. Devuelve los fallos para que el Job reintente.
 */

import cron from 'node-cron';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  diaDeCorte,
  diasEntre,
  hoyEnZonaNegocio,
  mesSiguiente,
  partesDeISO,
  periodoDeCorte,
  periodoQueEmpiezaEn,
  soloFecha,
  sumarDias,
  ErrorDeEntorno,
  leerEntorno,
  ZONA_NEGOCIO,
} from 'arriendos360-shared';
import type { Entorno, Periodo } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { contratosConEstado, porIds as contratosPorIds } from '../clientes/contratos';
import { CuentaCobro } from '../models/CuentaCobro';
import {
  ESTADO_CONTRATO_ACTIVO,
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
} from '../models/constantes';
import {
  registrarCuentaCobroEnMora,
  registrarCuentaCobroPorVencer,
} from '../eventos/salida';
import { emitirCuentaCobro } from './cuentas';

/** Días desde el corte a partir de los cuales una cuenta entra en mora. Lo usa también `verificarMora`. */
export const DIAS_PARA_MORA = 6;

/** Días desde el corte en que se avisa de que el plazo se acaba. */
export const DIAS_AVISO_PREVIO = DIAS_PARA_MORA - 2;

/** El día en que una cuenta con este corte pasaría a EN_MORA. */
export const diaDeMora = (inicio: string): string => sumarDias(inicio, DIAS_PARA_MORA);

/** El concepto que se imprime en la cuenta de cobro. */
export const detalleDelPeriodo = (periodo: Periodo): string =>
  `Canon de arrendamiento del ${periodo.inicio} al ${periodo.fin}`;

/**
 * El periodo que le toca facturar hoy a un contrato con este día de corte: el de
 * este mes o, si hoy pasó del corte por más de dos días, el del mes siguiente.
 *
 * @param diaCorte dia pactado, 1-31
 * @param hoy `YYYY-MM-DD` en la zona del negocio
 */
export const periodoAFacturar = (diaCorte: number, hoy: string): Periodo => {
  const { anio, mes, dia } = partesDeISO(hoy);

  if (dia > diaCorte + 2) {
    const siguiente = mesSiguiente(anio, mes);
    return periodoDeCorte(diaCorte, siguiente.anio, siguiente.mes);
  }

  return periodoDeCorte(diaCorte, anio, mes);
};

/**
 * El primer periodo del contrato, calculado igual que en el consumidor de
 * `ContratoFormalizado` para que los dos coincidan.
 */
export const primerPeriodoDe = (fechaInicioCorte: unknown): Periodo | null => {
  const fecha = soloFecha(fechaInicioCorte);
  const dia = diaDeCorte(fecha);

  return fecha === null || dia === null ? null : periodoQueEmpiezaEn(fecha, dia);
};

/** Lo que deja un barrido de generacion. */
export interface ResultadoGeneracion {
  generadas: number;
  /** Lo que fallo. Vacio = todo bien; si no, `scripts/motor.ts` sale con 1. */
  fallos: string[];
}

/**
 * Genera las cuentas de cobro de los contratos activos, desde 2 días antes del
 * corte. Si ms-contratos no responde, no genera nada.
 */
export const procesarContratos = async (): Promise<ResultadoGeneracion> => {
  const resultado: ResultadoGeneracion = { generadas: 0, fallos: [] };
  const hoy = hoyEnZonaNegocio();

  // Una petición para todos los contratos activos, con su inmueble.
  let contratos: Awaited<ReturnType<typeof contratosConEstado>>;
  try {
    contratos = await contratosConEstado(ESTADO_CONTRATO_ACTIVO, { conInmueble: true });
  } catch (error) {
    console.error('❌ Error en procesarContratos: no se pudieron pedir los contratos:', error);
    resultado.fallos.push(`contratos activos: ${(error as Error).message}`);
    return resultado;
  }

  // Un contrato que falla se anota y no detiene a los demás.
  for (const contrato of contratos) {
    try {
      const fechaInicioCorte = contrato.fecha_inicio_corte;

      // El día de corte sale de su columna.
      const diaCorte = diaDeCorte(fechaInicioCorte);
      if (diaCorte === null) {
        continue;
      }

      const periodo = periodoAFacturar(diaCorte, hoy);

      // Sólo dentro de los 2 días previos al corte, o con el corte ya llegado.
      if (diasEntre(hoy, periodo.inicio) > 2) {
        continue;
      }

      // El primer periodo es del consumidor del evento: se salta siempre.
      const primero = primerPeriodoDe(fechaInicioCorte);
      if (primero && primero.inicio === periodo.inicio) {
        continue;
      }

      const yaExiste = await CuentaCobro.findOne({
        where: { id_contrato: contrato.id_contrato, inicio: periodo.inicio },
      });

      if (yaExiste) {
        continue;
      }

      // La cuenta y su `CuentaCobroGenerada`, en una transacción.
      try {
        await emitirCuentaCobro({
          id_contrato: contrato.id_contrato,
          id_inquilino: contrato.id_inquilino,
          detalle: detalleDelPeriodo(periodo),
          valor: contrato.canon,
          inicio: periodo.inicio,
          fin: periodo.fin,
        });
      } catch (error) {
        // Otra ejecución la creó a la vez: el índice único la frenó y ya está hecha.
        if (error instanceof UniqueConstraintError) {
          continue;
        }
        throw error;
      }

      resultado.generadas += 1;
      console.log(
        `✅ Cuenta de cobro generada para contrato ${contrato.id_contrato}` +
          ` — periodo ${periodo.inicio} a ${periodo.fin}`,
      );
    } catch (error) {
      console.error(`❌ Error al facturar el contrato ${contrato.id_contrato}:`, error);
      resultado.fallos.push(`contrato ${contrato.id_contrato}: ${(error as Error).message}`);
    }
  }

  return resultado;
};

/**
 * Estados de una cuenta que puede entrar en mora. Saldo mayor que cero y corte
 * vencido es mora, haya abonos o no. Lo usa también `verificarMora`.
 */
export const ESTADOS_QUE_ENTRAN_EN_MORA: readonly string[] = [
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_CUENTA_PARCIAL,
];

const puedeEntrarEnMora = (estado: string): boolean => ESTADOS_QUE_ENTRAN_EN_MORA.includes(estado);

/** Lo que deja un barrido de vencimientos. */
export interface ResultadoVencimientos {
  /** Cuentas que ESTA ejecucion paso a EN_MORA. */
  moras: number;
  /** Lo que fallo. Vacio = todo bien; si no, `scripts/motor.ts` sale con 1. */
  fallos: string[];
}

/**
 * Vencimientos: el día `DIAS_AVISO_PREVIO` anota `CuentaCobroPorVencer` y desde
 * `DIAS_PARA_MORA` pasa la cuenta a EN_MORA y anota `CuentaCobroEnMora`.
 */
export const procesarPagos = async (): Promise<ResultadoVencimientos> => {
  const resultado: ResultadoVencimientos = { moras: 0, fallos: [] };
  const hoy = hoyEnZonaNegocio();

  let cuentasPendientes: CuentaCobro[];
  let contratos: Awaited<ReturnType<typeof contratosPorIds>>;
  try {
    cuentasPendientes = await CuentaCobro.findAll({
      where: {
        estado: { [Op.in]: [...ESTADOS_QUE_ENTRAN_EN_MORA, ESTADO_CUENTA_EN_MORA] },
      },
    });

    // Los contratos de todas las cuentas en una petición, con su inmueble.
    contratos = await contratosPorIds(
      cuentasPendientes.map((cuenta) => cuenta.id_contrato),
      { conInmueble: true },
    );
  } catch (error) {
    console.error('❌ Error en procesarPagos:', error);
    resultado.fallos.push(`vencimientos: ${(error as Error).message}`);
    return resultado;
  }

  for (const cuenta of cuentasPendientes) {
    try {
      const contrato = contratos.get(cuenta.id_contrato);
      if (!contrato) {
        continue;
      }

      const idInquilino = contrato.id_inquilino;
      const inmueble = contrato.Inmueble ?? null;

      const diasDesdeCorte = diasEntre(cuenta.inicio, hoy);

      // Sin inquilino o sin propietario no se anota el aviso; la mora sí se evalúa.
      const puedeAvisar = Boolean(idInquilino && inmueble?.id_propietario);

      if (!puedeAvisar) {
        console.warn(
          `⚠️  ms-financiero: cuenta ${cuenta.id_cuenta_cobro} sin inquilino o sin inmueble ` +
            'compuesto: no se anuncia su aviso. Se sigue evaluando la mora.',
        );
      }

      const partes = {
        id_cuenta_cobro: cuenta.id_cuenta_cobro,
        id_contrato: cuenta.id_contrato,
        id_inquilino: idInquilino as string,
        // Foto del dueño en el momento del aviso.
        id_propietario: inmueble?.id_propietario as string,
        valor: Number(cuenta.valor),
        inicio: cuenta.inicio,
        fin: cuenta.fin,
        direccion_inmueble: inmueble?.direccion ?? 'Inmueble sin dirección registrada',
      };

      // Aviso previo, sólo el día exacto. Su `id_evento` determinista evita repetirlo.
      if (diasDesdeCorte === DIAS_AVISO_PREVIO && puedeEntrarEnMora(cuenta.estado)) {
        if (puedeAvisar) {
          await sequelize.transaction((transaccion) =>
            registrarCuentaCobroPorVencer(
              { ...partes, entra_en_mora_el: diaDeMora(cuenta.inicio) },
              transaccion,
            ),
          );
        }
      }

      // Mora: la cuenta se relee bloqueada y con el estado en el filtro, para que
      // una ejecución simultánea no la marque ni avise dos veces.
      if (diasDesdeCorte >= DIAS_PARA_MORA && puedeEntrarEnMora(cuenta.estado)) {
        const marcada = await sequelize.transaction(async (transaccion) => {
          const vigente = await CuentaCobro.findOne({
            where: {
              id_cuenta_cobro: cuenta.id_cuenta_cobro,
              estado: { [Op.in]: [...ESTADOS_QUE_ENTRAN_EN_MORA] },
            },
            transaction: transaccion,
            lock: transaccion.LOCK.UPDATE,
          });

          if (!vigente) {
            return false;
          }

          await vigente.update(
            { estado: ESTADO_CUENTA_EN_MORA },
            { transaction: transaccion } as never,
          );

          if (puedeAvisar) {
            await registrarCuentaCobroEnMora(
              { ...partes, dias_de_mora: diasDesdeCorte },
              transaccion,
            );
          }

          return true;
        });

        if (marcada) {
          resultado.moras += 1;
          console.log(`🚫 Cuenta de cobro ${cuenta.id_cuenta_cobro} marcada como EN MORA`);
        }
      }
    } catch (error) {
      console.error(`❌ Error al revisar la cuenta ${cuenta.id_cuenta_cobro}:`, error);
      resultado.fallos.push(`cuenta ${cuenta.id_cuenta_cobro}: ${(error as Error).message}`);
    }
  }

  return resultado;
};

/** Lo que deja una ejecucion completa del motor. */
export interface ResultadoMotor {
  generadas: number;
  moras: number;
  /** Vacio = todo bien. Si no, `scripts/motor.ts` sale con 1 y el Job reintenta. */
  fallos: string[];
}

/** Una ejecución completa: generación y vencimientos. */
export const ejecutarMotor = async (): Promise<ResultadoMotor> => {
  const generacion = await procesarContratos();
  const vencimientos = await procesarPagos();

  return {
    generadas: generacion.generadas,
    moras: vencimientos.moras,
    fallos: [...generacion.fallos, ...vencimientos.fallos],
  };
};

/** Como se programa el motor en este despliegue. */
export type ModoProgramacion = 'cron' | 'trabajo';

/** El modo, de `MOTOR_PROGRAMACION`. Lanza si falta o no es uno de los dos. */
export const modoDeProgramacion = (entorno: Entorno = process.env): ModoProgramacion => {
  const valor = leerEntorno('MOTOR_PROGRAMACION', entorno);
  if (valor === 'cron' || valor === 'trabajo') {
    return valor;
  }

  throw new ErrorDeEntorno(
    `MOTOR_PROGRAMACION debe ser «cron» (Compose y local) o «trabajo» (Container Apps)` +
      `${valor === undefined ? '' : `, no «${valor}»`}. Ver docs/adr/0021.`,
    ['MOTOR_PROGRAMACION'],
  );
};

/** 00:01, en la zona del negocio. El Job lo expresa en UTC: `1 5 * * *`. */
export const HORARIO_CRON = '1 0 * * *';

/**
 * Programa el barrido diario con node-cron a las 00:01 de Bogotá, sólo si
 * `MOTOR_PROGRAMACION=cron`. Con `trabajo` no programa nada: lo ejecuta el Job
 * `motor-financiero`.
 */
export const iniciarMotorFinanciero = (entorno: Entorno = process.env): void => {
  const modo = modoDeProgramacion(entorno);

  if (modo === 'trabajo') {
    console.log(
      '🗓️  ms-financiero: MOTOR_PROGRAMACION=trabajo — el motor NO se programa en este ' +
        'proceso: lo ejecuta el Job programado motor-financiero con `node dist/scripts/motor.js`.',
    );
    return;
  }

  cron.schedule(
    HORARIO_CRON,
    () => {
      void (async () => {
        console.log('⏳ Iniciando proceso diario del Motor Financiero...');
        const resultado = await ejecutarMotor();
        if (resultado.fallos.length > 0) {
          console.error(
            `❌ Motor Financiero: ${resultado.fallos.length} fallo(s). Se puede repetir con ` +
              '`npm run motor` sin riesgo de duplicar.',
          );
        }
      })();
    },
    { timezone: ZONA_NEGOCIO, noOverlap: true },
  );

  console.log(
    `🗓️  ms-financiero: MOTOR_PROGRAMACION=cron — motor programado en este proceso a las 00:01 ` +
      `(${ZONA_NEGOCIO}). Sólo para Compose y local: con scale-to-zero no dispararía.`,
  );
};
