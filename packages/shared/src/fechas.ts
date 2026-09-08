/**
 * El calendario del arrendamiento: la regla del dia 31 y la regla del periodo.
 *
 * ── POR QUE ESTO SUBIO A `packages/shared` EN EL PASO 6d ─────────────────────
 *
 * Vivia en `apps/gateway/src/models/fechasContrato.js` y lo usaban dos cosas que
 * el paso 6d separa en servicios distintos:
 *
 *   - **Contratos** deriva `fecha_inicio_corte` y `fecha_limite_pago` del inicio
 *     del contrato, en el hook del modelo.
 *   - **Financiero** construye el periodo de cada cuenta de cobro y cuenta los
 *     dias de mora.
 *
 * Al irse Contratos, la alternativa era copiar el archivo. Y eso es exactamente
 * el problema que CLAUDE.md describe para los catalogos cerrados: dos copias que
 * nada sincroniza. Aqui seria peor que en un catalogo, porque el desvio no
 * saldria por pantalla sino en una fecha de cobro — el sintoma de una regla del
 * dia 31 mal copiada es un recibo que sale tres dias tarde en febrero, y nadie
 * relaciona eso con un archivo duplicado.
 *
 * No es logica de negocio de un contexto: es la aritmetica de calendario que los
 * dos contextos comparten, del mismo modo que los dos comparten el formato del
 * sobre de un evento. Por eso esta aqui y no en uno de los dos servicios.
 *
 * ── LAS DOS FECHAS QUE UN CONTRATO DERIVA DE SU INICIO ───────────────────────
 *
 * El modelo canonico exige `fecha_inicio_corte` y `fecha_limite_pago` como
 * COLUMNAS, no como calculo. Se derivan una vez, al crear el contrato, y se
 * guardan. Derivarlas en cada lectura seria mas corto y seria un error: el ciclo
 * de facturacion se puede renegociar sin mover la fecha de inicio del contrato,
 * y un valor calculado no se puede renegociar sin mentir sobre el inicio.
 *
 * ── POR QUE TODO ESTO SE HACE EN UTC ─────────────────────────────────────────
 *
 * `inicio` es `TIMESTAMPTZ` y el formulario manda `"2026-03-31"`, que JavaScript
 * interpreta como medianoche UTC. Leer de ahi el dia con `.getDate()` —hora
 * local— devuelve **30** en Bogota, porque medianoche UTC del 31 son las 19:00
 * del 30. El dia que el usuario escribio solo se recupera en UTC.
 *
 * ── LA REGLA DEL DIA QUE NO EXISTE ───────────────────────────────────────────
 *
 * `fecha_limite_pago` es un dia del mes, un entero de 1 a 31. Un contrato que
 * empieza el 31 de marzo tiene dia limite 31, y **febrero no tiene 31**. Hay que
 * decidir que pasa, y la decision no puede quedarse implicita en el
 * desbordamiento de `new Date()`: `new Date(2026, 1, 31)` no falla ni avisa,
 * devuelve el 3 de marzo. Un cobro que se genera tres dias tarde y nadie sabe
 * por que.
 *
 * **Se recorta al ultimo dia del mes.** Es lo habitual en arrendamiento y en
 * domiciliacion bancaria, y es la unica de las tres opciones que no perjudica a
 * nadie:
 *
 * - *Recortar* (28 de febrero): el inquilino paga como mucho tres dias antes de
 *   lo que esperaria. Cobra dentro del mes que corresponde.
 * - *Desbordar* (3 de marzo): el cobro de febrero cae en marzo, junto al de
 *   marzo. Dos cobros en un mes y ninguno en el otro.
 * - *Saltar el mes*: el arrendador pierde un canon. Impensable.
 *
 * El dia GUARDADO no se toca nunca: se guarda 31 y se recorta al resolverlo
 * contra cada mes. Guardar 28 haria que el contrato cobrara el 28 en abril, que
 * si tiene 31 — el recorte se perderia para siempre por un febrero.
 *
 * ── LA REGLA DEL PERIODO ─────────────────────────────────────────────────────
 *
 * `Cuentas_cobro` no guarda un mes suelto sino un periodo explicito, `inicio` y
 * `fin`, y la regla que los define es la del dia 31 aplicada dos veces:
 *
 *   inicio = la fecha de corte del mes que se factura
 *   fin    = el dia ANTERIOR a la siguiente fecha de corte
 *
 * Lo que hace correcta a esta definicion y no a la obvia —«inicio mas un mes
 * menos un dia»— es que los periodos TESELAN el calendario: cada dia pertenece a
 * un periodo y solo a uno, sin huecos ni solapes, sea cual sea el dia pactado.
 * Con un corte el 31: enero va del 31/01 al 27/02, febrero del 28/02 al 30/03,
 * marzo del 31/03 al 29/04. Los tres encajan sin dejar un dia fuera, y ninguno
 * dura lo mismo. Con la definicion obvia, febrero acabaria el 27/03 y los dias
 * 28, 29 y 30 de marzo no serian de nadie.
 *
 * `periodoDeCorte()` es la unica forma de construir esas dos fechas.
 */

/** Milisegundos de un dia. Sale de sumar y restar fechas de calendario en UTC. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Dias de cada mes. Febrero se resuelve aparte, que para eso esta el bisiesto. */
const DIAS_POR_MES: Array<number | null> = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Una fecha de calendario en `YYYY-MM-DD`. */
export type FechaISO = string;

/** El periodo que cubre una cuenta de cobro. */
export interface Periodo {
  inicio: FechaISO;
  fin: FechaISO;
}

/**
 * ¿Es bisiesto?
 *
 * La regla completa, no `anio % 4 === 0`: 2100 no es bisiesto y 2000 si. Sobra
 * para un contrato de arriendo, pero cuesta una linea y evita que alguien lo
 * mire dentro de setenta y cinco años y encuentre un error.
 */
export const esBisiesto = (anio: number): boolean =>
  (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** Ultimo dia del mes. `mes` es 0-11, como en `Date`. */
export const ultimoDiaDelMes = (anio: number, mes: number): number =>
  DIAS_POR_MES[mes] ?? (esBisiesto(anio) ? 29 : 28);

/**
 * El dia `dia` dentro de ese mes, recortado si no existe.
 *
 * Devuelve un numero, no una fecha, para que quien llame decida que construye
 * con el. Ver la regla en la cabecera.
 */
export const diaEnMes = (anio: number, mes: number, dia: number): number =>
  Math.min(dia, ultimoDiaDelMes(anio, mes));

/**
 * La fecha resultante de aplicar un dia del mes a un mes concreto.
 *
 * Sustituye a `new Date(anio, mes, dia)`, que para `dia = 31` en febrero se
 * desborda en silencio al mes siguiente. Aqui el 31 de febrero es el 28, y se ve.
 */
export const fechaEnMes = (anio: number, mes: number, dia: number): Date =>
  new Date(anio, mes, diaEnMes(anio, mes, dia));

/**
 * `YYYY-MM-DD` en UTC. La forma en que se guarda una fecha sin hora.
 *
 * Acepta `Date`, cadena ISO o ya-`YYYY-MM-DD`. Devuelve `null` si no hay fecha
 * valida, para que el llamante decida si eso es un error suyo o no.
 */
export const soloFecha = (valor: unknown): FechaISO | null => {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor as string);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
};

/**
 * La primera fecha de corte que le corresponde a un contrato que empieza en
 * `inicio`: la del propio inicio.
 *
 * El primer ciclo de facturacion arranca cuando arranca el contrato. Que sea una
 * columna y no esta cuenta es lo que permite cambiarlo despues sin tocar el
 * inicio.
 */
export const fechaInicioCorteDesde = (inicio: unknown): FechaISO | null => soloFecha(inicio);

/**
 * El dia del mes en que vence el pago: el dia en que empieza el contrato.
 *
 * Devuelve `null` si `inicio` no es una fecha valida.
 */
export const diaLimiteDesde = (inicio: unknown): number | null => {
  const fecha = fechaInicioCorteDesde(inicio);
  return fecha === null ? null : Number(fecha.slice(8, 10));
};

/**
 * El dia del mes que guarda una `fecha_inicio_corte` ya almacenada.
 *
 * Sequelize devuelve las columnas `DATEONLY` como `YYYY-MM-DD`, asi que aqui no
 * hay zona horaria que valga: se lee el dia del texto y punto. Es
 * deliberadamente distinto de `new Date(columna).getDate()`, que si la tendria.
 */
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
 * El periodo de facturacion que empieza en el corte de `mes`/`anio`.
 *
 * @param diaCorte dia del mes pactado, 1-31, SIN recortar
 * @param anio     año del periodo
 * @param mes      mes del periodo, 0-11
 *
 * Todo en UTC —`Date.UTC`, nunca el constructor local— porque el resultado es
 * una fecha de calendario que se guarda en una columna `DATE`. Construirla en
 * hora local haria que el dia dependiera de donde corra el proceso, que es
 * exactamente la trampa que documenta la cabecera de este archivo.
 *
 * Ver la regla del periodo, arriba: `fin` es el dia anterior al SIGUIENTE corte,
 * no «un mes menos un dia».
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

/**
 * El periodo cuyo corte cae en el mes de `fechaISO`.
 *
 * Atajo para cuando ya se tiene la fecha de inicio y hace falta el fin, que es
 * lo que necesita el alta manual de una cuenta de cobro.
 */
export const periodoQueEmpiezaEn = (fechaISO: FechaISO, diaCorte: number): Periodo => {
  const { anio, mes } = partesDeISO(fechaISO);
  return periodoDeCorte(diaCorte, anio, mes);
};

/**
 * La zona del NEGOCIO, que no es la del servidor ni UTC.
 *
 * Quien decide que un arriendo entro en mora al sexto dia lo hace en Bogota, y
 * en un contenedor configurado en UTC el corte se adelantaria cinco horas.
 * Colombia no tiene horario de verano, asi que el desplazamiento es constante,
 * pero se pide por nombre de zona y no como `-05:00` fijo para no tener que
 * revisarlo si algun dia lo tuviera.
 */
export const ZONA_NEGOCIO = 'America/Bogota';

/** Hoy, en la zona del negocio y como `YYYY-MM-DD`. */
export const hoyEnZonaNegocio = (): FechaISO =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Dias enteros de `desdeISO` a `hastaISO`. Negativo si `hasta` es anterior.
 *
 * Cuenta DIAS DE CALENDARIO, no intervalos de 24 horas: las dos fechas se
 * interpretan a medianoche UTC, asi que el resultado es siempre un entero y no
 * depende de la hora a la que se pregunte. Es lo que permite que «el sexto dia»
 * sea una afirmacion comprobable.
 */
export const diasEntre = (desdeISO: FechaISO, hastaISO: FechaISO): number =>
  Math.round(
    (Date.parse(`${hastaISO}T00:00:00Z`) - Date.parse(`${desdeISO}T00:00:00Z`)) / MS_POR_DIA,
  );
