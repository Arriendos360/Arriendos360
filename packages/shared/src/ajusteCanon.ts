/**
 * Ajuste anual del canon por IPC (Ley 820 de 2003, art. 20): cada 12 meses de ejecución,
 * como máximo el IPC del año calendario anterior.
 */

import {
  DIAS_ANTICIPACION_FACTURA,
  comoISO,
  diaDeCorte,
  diaEnMes,
  diasEntre,
  mesSiguiente,
  partesDeISO,
  periodoDeCorte,
  soloFecha,
} from './fechas';
import type { FechaISO } from './fechas';

/** Lo que el cálculo lee de un contrato. Las fechas pueden venir como `Date` o texto. */
export interface ContratoAjustable {
  inicio: unknown;
  fecha_inicio_corte: unknown;
  fecha_ultimo_ajuste?: unknown;
  canon: number | string;
}

export interface AjusteCanon {
  fecha_ajuste: FechaISO;
  /** Corte anterior a `fecha_ajuste`: desde ahí un cambio de canon ya no toca periodos anteriores. */
  ventana_desde: FechaISO;
  en_ventana: boolean;
  anio_ipc: number;
  /** `null` si el año no está en el catálogo: entonces no hay sugerido ni ventana. */
  ipc: number | null;
  canon_sugerido: number | null;
  /** Primer corte cuya cuenta aún no se ha generado: desde ahí rige un ajuste aplicado hoy. */
  rige_desde: FechaISO;
}

const mesAnterior = (anio: number, mes: number): { anio: number; mes: number } =>
  mes === 0 ? { anio: anio - 1, mes: 11 } : { anio, mes: mes - 1 };

const corteSiguiente = (corte: FechaISO, diaCorte: number): FechaISO => {
  const { anio, mes } = partesDeISO(corte);
  const siguiente = mesSiguiente(anio, mes);
  return periodoDeCorte(diaCorte, siguiente.anio, siguiente.mes).inicio;
};

/** El tope en pesos, redondeado hacia abajo. En enteros: con flotantes 1500000 × 1.052 pierde un peso. */
const tope = (canon: number | string, ipc: number): number => {
  const centavos = BigInt(Math.round(Number(canon) * 100));
  const factor = BigInt(10000 + Math.round(ipc * 100));
  return Number((centavos * factor) / 1000000n);
};

/**
 * El ajuste que le toca a un contrato activo, visto desde `hoy`, o `null` si no tiene
 * inicio ni día de corte. `ipcAnual` es el catálogo `IPC_ANUAL` de `arriendos360-contracts`.
 */
export const ajusteDeCanon = (
  contrato: ContratoAjustable,
  hoy: FechaISO,
  ipcAnual: Readonly<Record<number, number>>,
): AjusteCanon | null => {
  const base = soloFecha(contrato.fecha_ultimo_ajuste) ?? soloFecha(contrato.inicio);
  const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
  if (base === null || diaCorte === null) {
    return null;
  }

  // 12 meses después de la base, recortado si el mes no tiene ese día (29 de febrero).
  const partes = partesDeISO(base);
  const anio = partes.anio + 1;
  const aniversario = comoISO(anio, partes.mes, diaEnMes(anio, partes.mes, partes.dia));

  const corteDelMes = periodoDeCorte(diaCorte, anio, partes.mes).inicio;
  const fechaAjuste = corteDelMes >= aniversario ? corteDelMes : corteSiguiente(corteDelMes, diaCorte);

  const delAjuste = partesDeISO(fechaAjuste);
  const previo = mesAnterior(delAjuste.anio, delAjuste.mes);
  const ventanaDesde = periodoDeCorte(diaCorte, previo.anio, previo.mes).inicio;

  const anioIpc = delAjuste.anio - 1;
  const ipc = ipcAnual[anioIpc] ?? null;
  const canonSugerido = ipc === null ? null : tope(contrato.canon, ipc);

  let rigeDesde = fechaAjuste;
  while (diasEntre(hoy, rigeDesde) <= DIAS_ANTICIPACION_FACTURA) {
    rigeDesde = corteSiguiente(rigeDesde, diaCorte);
  }

  return {
    fecha_ajuste: fechaAjuste,
    ventana_desde: ventanaDesde,
    en_ventana: canonSugerido !== null && hoy >= ventanaDesde,
    anio_ipc: anioIpc,
    ipc,
    canon_sugerido: canonSugerido,
    rige_desde: rigeDesde,
  };
};
