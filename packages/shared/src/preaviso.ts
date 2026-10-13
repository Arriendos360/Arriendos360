/**
 * Preaviso de no renovar un contrato de vivienda urbana (Ley 820 de 2003): sin aviso escrito
 * con la anticipación legal, el contrato se prorroga por el mismo término inicial (art. 6).
 */

import { comoISO, diaEnMes, diasEntre, partesDeISO, soloFecha, sumarDias } from './fechas';
import type { FechaISO } from './fechas';

/** Lo que el cálculo lee de un contrato. Las fechas pueden venir como `Date` o texto. */
export interface ContratoPreavisable {
  inicio: unknown;
  fin: unknown;
  /** El vencimiento al que se refiere el preaviso registrado, si lo hay. */
  preaviso_vencimiento?: unknown;
}

/** Los plazos del catálogo de `arriendos360-contracts`. */
export interface PlazosPreaviso {
  meses: number;
  diasRecordatorio: number;
}

export interface Preaviso {
  vencimiento: FechaISO;
  fecha_limite: FechaISO;
  recordatorio_desde: FechaISO;
  en_ventana: boolean;
  dentro_de_plazo: boolean;
  /** Pasó `fin` y corre una prórroga. */
  prorrogado: boolean;
  /** Hay preaviso y llegó su vencimiento: espera a que el propietario lo finalice. */
  vencido: boolean;
}

/** `meses` después de `fecha`, con el día recortado si el mes no lo tiene. Negativo resta. */
const sumarMeses = (fecha: FechaISO, meses: number): FechaISO => {
  const { anio, mes, dia } = partesDeISO(fecha);
  const total = anio * 12 + mes + meses;
  const anioNuevo = Math.floor(total / 12);
  const mesNuevo = total - anioNuevo * 12;
  return comoISO(anioNuevo, mesNuevo, diaEnMes(anioNuevo, mesNuevo, dia));
};

/** Meses del término si `fin` es la víspera del día de `inicio` N meses después; si no, `null`. */
const terminoEnMeses = (inicio: FechaISO, fin: FechaISO): number | null => {
  const siguiente = sumarDias(fin, 1);
  const a = partesDeISO(inicio);
  const b = partesDeISO(siguiente);
  const meses = (b.anio - a.anio) * 12 + (b.mes - a.mes);
  return meses > 0 && sumarMeses(inicio, meses) === siguiente ? meses : null;
};

/** El vencimiento vigente: `fin`, o el final de la prórroga en curso si hoy ya lo pasó. */
const vencimientoVigente = (inicio: FechaISO, fin: FechaISO, hoy: FechaISO): FechaISO | null => {
  const meses = terminoEnMeses(inicio, fin);
  if (meses !== null) {
    // Desde `inicio` y no encadenado desde `fin`, para que el recorte de un mes no se acumule.
    let vencimiento = fin;
    for (let k = 2; vencimiento < hoy; k++) {
      vencimiento = sumarDias(sumarMeses(inicio, k * meses), -1);
    }
    return vencimiento;
  }

  const dias = diasEntre(inicio, fin) + 1;
  if (dias < 1) {
    return null;
  }
  let vencimiento = fin;
  while (vencimiento < hoy) {
    vencimiento = sumarDias(vencimiento, dias);
  }
  return vencimiento;
};

/**
 * El preaviso de un contrato activo visto desde `hoy`, o `null` si no tiene `inicio` o `fin`.
 * Con un preaviso registrado no hay prórroga: el vencimiento es el suyo aunque haya pasado.
 */
export const preavisoDe = (
  contrato: ContratoPreavisable,
  hoy: FechaISO,
  plazos: PlazosPreaviso,
): Preaviso | null => {
  const inicio = soloFecha(contrato.inicio);
  const fin = soloFecha(contrato.fin);
  if (inicio === null || fin === null) {
    return null;
  }

  const registrado = soloFecha(contrato.preaviso_vencimiento);
  const vencimiento = registrado ?? vencimientoVigente(inicio, fin, hoy);
  if (vencimiento === null) {
    return null;
  }

  const fechaLimite = sumarMeses(vencimiento, -plazos.meses);
  const recordatorioDesde = sumarDias(fechaLimite, -plazos.diasRecordatorio);

  return {
    vencimiento,
    fecha_limite: fechaLimite,
    recordatorio_desde: recordatorioDesde,
    en_ventana: hoy >= recordatorioDesde && hoy <= fechaLimite,
    dentro_de_plazo: hoy <= fechaLimite,
    prorrogado: vencimiento !== fin,
    vencido: registrado !== null && hoy >= vencimiento,
  };
};

/** La clave de la causal de plena voluntad en `CAUSALES_PREAVISO_ARRENDADOR`. */
const PLENA_VOLUNTAD = 'plena_voluntad';

/**
 * Las causales que el arrendador puede invocar para ese vencimiento: la de plena voluntad
 * exige `aniosPlenaVoluntad` años de ejecución a esa fecha (art. 22 num. 8 lit. d).
 */
export const causalesDisponibles = <C extends string>(
  causales: readonly C[],
  inicio: unknown,
  vencimiento: FechaISO,
  aniosPlenaVoluntad: number,
): C[] => {
  const desde = soloFecha(inicio);
  const cumple = desde !== null && sumarMeses(desde, aniosPlenaVoluntad * 12) <= sumarDias(vencimiento, 1);
  return causales.filter((causal) => causal !== PLENA_VOLUNTAD || cumple);
};
