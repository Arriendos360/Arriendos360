/**
 * Qué se le pregunta a un contrato que ya lleva tiempo corriendo al registrarlo. Lo usan
 * ms-contratos y la SPA. `contracts` no puede importar `shared`, así que replica lo poco de
 * su calendario que necesita; ms-financiero prueba que coincide con `periodosPendientes`.
 */

/** Espejo de `DIAS_ANTICIPACION_FACTURA`. */
const DIAS_ANTICIPACION = 2;

const dosDigitos = (numero: number): string => String(numero).padStart(2, '0');

const moverMes = (mes: string, meses: number): string => {
  const [anio, numero] = mes.split('-').map(Number) as [number, number];
  const total = anio * 12 + numero - 1 + meses;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${dosDigitos((total % 12) + 1)}`;
};

const sumarDias = (fecha: string, dias: number): string =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

/** El inicio del periodo de corte de ese mes `YYYY-MM`, con el día recortado si el mes no lo tiene. */
export const inicioDelPeriodo = (mes: string, diaCorte: number): string => {
  const [anio, numero] = mes.split('-').map(Number) as [number, number];
  const ultimoDia = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  return `${mes}-${dosDigitos(Math.min(diaCorte, ultimoDia))}`;
};

/** El periodo de corte de ese mes: de su corte a la víspera del siguiente. */
export const periodoDelMes = (mes: string, diaCorte: number): { inicio: string; fin: string } => ({
  inicio: inicioDelPeriodo(mes, diaCorte),
  fin: sumarDias(inicioDelPeriodo(moverMes(mes, 1), diaCorte), -1),
});

/** El mes que «no ha pagado ningún mes» guarda como último pagado: el anterior al primer corte. */
export const mesAnteriorAlPrimero = (primerCorte: string): string => moverMes(primerCorte.slice(0, 7), -1);

const sumarMeses = (fecha: string, meses: number): string =>
  inicioDelPeriodo(moverMes(fecha.slice(0, 7), meses), Number(fecha.slice(8, 10)));

/** El primer corte ya pasó: hay periodos que pudieron pagarse. Uno anterior al inicio es un error aparte. */
export const pideUltimoMesPagado = (inicio: string, primerCorte: string, hoy: string): boolean =>
  primerCorte >= inicio && primerCorte < hoy;

/** Ya cumplió 12 meses: pudo haber un ajuste por IPC. */
export const pideUltimoAjuste = (inicio: string, hoy: string): boolean => hoy >= sumarMeses(inicio, 12);

/** Los meses `YYYY-MM` que se pueden elegir: del primer corte al periodo que toca facturar hoy. */
export const rangoDeMesPagado = (primerCorte: string, hoy: string): { desde: string; hasta: string } => {
  const diaCorte = Number(primerCorte.slice(8, 10));
  const mes = hoy.slice(0, 7);
  return { desde: primerCorte.slice(0, 7), hasta: Number(hoy.slice(8, 10)) > diaCorte + 2 ? moverMes(mes, 1) : mes };
};

/** Los periodos elegibles, del más reciente al primero, con el mes que los identifica. */
export const mesesElegibles = (
  primerCorte: string,
  hoy: string,
): Array<{ mes: string; inicio: string; fin: string }> => {
  const { desde, hasta } = rangoDeMesPagado(primerCorte, hoy);
  const diaCorte = Number(primerCorte.slice(8, 10));
  const meses = [];
  for (let mes = hasta; mes >= desde; mes = moverMes(mes, -1)) {
    meses.push({ mes, ...periodoDelMes(mes, diaCorte) });
  }
  return meses;
};

/** Las cuentas que se crearán al formalizar con ese último mes pagado. */
export const cuentasPendientes = (
  diaCorte: number,
  ultimoMes: string,
  hoy: string,
): Array<{ inicio: string; fin: string }> => {
  const tope = sumarDias(hoy, DIAS_ANTICIPACION);
  const cuentas = [];
  for (let mes = moverMes(ultimoMes, 1); inicioDelPeriodo(mes, diaCorte) <= tope; mes = moverMes(mes, 1)) {
    cuentas.push(periodoDelMes(mes, diaCorte));
  }
  return cuentas;
};
