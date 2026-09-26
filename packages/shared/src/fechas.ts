/**
 * Calendario del arrendamiento, en UTC.
 *
 * - Un día pactado que el mes no tiene (31 en febrero) se recorta al último día
 *   del mes al resolverlo; el día guardado no se toca.
 * - El periodo de una cuenta de cobro va de la fecha de corte al día ANTERIOR al
 *   siguiente corte, de modo que los periodos teselan el calendario.
 */

/** Milisegundos de un dia. Sale de sumar y restar fechas de calendario en UTC. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días de cada mes; febrero depende del bisiesto. */
const DIAS_POR_MES: Array<number | null> = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Una fecha de calendario en `YYYY-MM-DD`. */
export type FechaISO = string;

/** El periodo que cubre una cuenta de cobro. */
export interface Periodo {
  inicio: FechaISO;
  fin: FechaISO;
}

/** ¿Es bisiesto? */
export const esBisiesto = (anio: number): boolean =>
  (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** Ultimo dia del mes. `mes` es 0-11, como en `Date`. */
export const ultimoDiaDelMes = (anio: number, mes: number): number =>
  DIAS_POR_MES[mes] ?? (esBisiesto(anio) ? 29 : 28);

/** El día `dia` dentro de ese mes, recortado si no existe. */
export const diaEnMes = (anio: number, mes: number, dia: number): number =>
  Math.min(dia, ultimoDiaDelMes(anio, mes));

/** La fecha del día `dia` en ese mes, recortado si no existe. */
export const fechaEnMes = (anio: number, mes: number, dia: number): Date =>
  new Date(anio, mes, diaEnMes(anio, mes, dia));

/**
 * `YYYY-MM-DD` en UTC. Acepta `Date`, cadena ISO o `YYYY-MM-DD`; `null` si no es
 * una fecha válida.
 */
export const soloFecha = (valor: unknown): FechaISO | null => {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor as string);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
};

/** Primera fecha de corte de un contrato: la de su inicio. */
export const fechaInicioCorteDesde = (inicio: unknown): FechaISO | null => soloFecha(inicio);

/** Día del mes en que vence el pago: el día de inicio del contrato. `null` si no es fecha. */
export const diaLimiteDesde = (inicio: unknown): number | null => {
  const fecha = fechaInicioCorteDesde(inicio);
  return fecha === null ? null : Number(fecha.slice(8, 10));
};

/** El día del mes de una `fecha_inicio_corte` guardada, leído del texto. */
export const diaDeCorte = (fechaInicioCorte: unknown): number | null => {
  const fecha = soloFecha(fechaInicioCorte);
  return fecha === null ? null : Number(fecha.slice(8, 10));
};

/** `YYYY-MM-DD` a partir de sus tres componentes. `mes` es 0-11, como en `Date`. */
export const comoISO = (anio: number, mes: number, dia: number): FechaISO =>
  `${String(anio).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Los tres componentes de un `YYYY-MM-DD`. `mes` sale 0-11, como en `Date`. */
export const partesDeISO = (fechaISO: FechaISO): { anio: number; mes: number; dia: number } => {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return { anio: anio as number, mes: (mes as number) - 1, dia: dia as number };
};

/** El mes siguiente a uno dado, con el cambio de año resuelto. `mes` es 0-11. */
export const mesSiguiente = (anio: number, mes: number): { anio: number; mes: number } =>
  mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 };

/**
 * El periodo de facturación que empieza en el corte de `mes`/`anio`: del corte al
 * día anterior al siguiente corte. Única forma de construir un periodo.
 *
 * @param diaCorte dia del mes pactado, 1-31, SIN recortar
 * @param anio     año del periodo
 * @param mes      mes del periodo, 0-11
 */
export const periodoDeCorte = (diaCorte: number, anio: number, mes: number): Periodo => {
  const siguiente = mesSiguiente(anio, mes);
  const proximoCorte = Date.UTC(
    siguiente.anio,
    siguiente.mes,
    diaEnMes(siguiente.anio, siguiente.mes, diaCorte),
  );

  return {
    inicio: comoISO(anio, mes, diaEnMes(anio, mes, diaCorte)),
    fin: new Date(proximoCorte - MS_POR_DIA).toISOString().slice(0, 10),
  };
};

/** El periodo cuyo corte cae en el mes de `fechaISO`. */
export const periodoQueEmpiezaEn = (fechaISO: FechaISO, diaCorte: number): Periodo => {
  const { anio, mes } = partesDeISO(fechaISO);
  return periodoDeCorte(diaCorte, anio, mes);
};

/** Zona horaria del negocio, independiente de la del servidor. */
export const ZONA_NEGOCIO = 'America/Bogota';

/** Hoy, en la zona del negocio y como `YYYY-MM-DD`. */
export const hoyEnZonaNegocio = (): FechaISO =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Días de calendario de `desdeISO` a `hastaISO`. Negativo si `hasta` es anterior. */
export const diasEntre = (desdeISO: FechaISO, hastaISO: FechaISO): number =>
  Math.round(
    (Date.parse(`${hastaISO}T00:00:00Z`) - Date.parse(`${desdeISO}T00:00:00Z`)) / MS_POR_DIA,
  );

/** La fecha `dias` días de calendario después de `fechaISO`. Inversa de `diasEntre`. */
export const sumarDias = (fechaISO: FechaISO, dias: number): FechaISO => {
  const instante = new Date(Date.parse(`${fechaISO}T00:00:00Z`) + dias * MS_POR_DIA);

  return comoISO(
    instante.getUTCFullYear(),
    // `comoISO` espera el mes 0-11, como `Date`.
    instante.getUTCMonth(),
    instante.getUTCDate(),
  );
};
