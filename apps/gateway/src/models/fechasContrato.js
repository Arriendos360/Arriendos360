/**
 * Las dos fechas que el contrato deriva de su inicio, y la regla del día 31.
 *
 * El modelo canónico exige `fecha_inicio_corte` y `fecha_limite_pago` como
 * COLUMNAS, no como cálculo. Se derivan una vez, al crear el contrato, y se
 * guardan. Derivarlas en cada lectura sería más corto y sería un error: el ciclo
 * de facturación se puede renegociar sin mover la fecha de inicio del contrato,
 * y un valor calculado no se puede renegociar sin mentir sobre el inicio.
 *
 * ── POR QUÉ TODO ESTO SE HACE EN UTC ──────────────────────────────────────────
 *
 * `inicio` es `TIMESTAMPTZ` y el formulario manda `"2026-03-31"`, que JavaScript
 * interpreta como medianoche UTC. Leer de ahí el día con `.getDate()` —hora
 * local— devuelve **30** en Bogotá, porque medianoche UTC del 31 son las 19:00
 * del 30. El día que el usuario escribió sólo se recupera en UTC.
 *
 * Es la trampa que CLAUDE.md anota en Convenciones («guardar en UTC, presentar
 * en America/Bogota... hoy usa `new Date()` local, que es una fuente latente de
 * errores»). Aquí se cierra para estas dos columnas: la derivación es UTC y la
 * migración que rellena las filas viejas usa `AT TIME ZONE 'UTC'`, así que las
 * dos coinciden. Lo demás sigue en hora local y se arreglará en el paso 6.
 *
 * ── LA REGLA DEL DÍA QUE NO EXISTE ────────────────────────────────────────────
 *
 * `fecha_limite_pago` es un día del mes, un entero de 1 a 31. Un contrato que
 * empieza el 31 de marzo tiene día límite 31, y **febrero no tiene 31**. Hay que
 * decidir qué pasa, y la decisión no puede quedarse implícita en el
 * desbordamiento de `new Date()`, que es lo que hay hoy: `new Date(2026, 1, 31)`
 * no falla ni avisa, devuelve el 3 de marzo. Un cobro que se genera tres días
 * tarde y nadie sabe por qué.
 *
 * **Se recorta al último día del mes.** Es lo habitual en arrendamiento y en
 * domiciliación bancaria, y es la única de las tres opciones que no perjudica a
 * nadie:
 *
 * - *Recortar* (28 de febrero): el inquilino paga como mucho tres días antes de
 *   lo que esperaría. Cobra dentro del mes que corresponde.
 * - *Desbordar* (3 de marzo, lo actual): el cobro de febrero cae en marzo, junto
 *   al de marzo. Dos cobros en un mes y ninguno en el otro.
 * - *Saltar el mes*: el arrendador pierde un canon. Impensable.
 *
 * El día GUARDADO no se toca nunca: se guarda 31 y se recorta al resolverlo
 * contra cada mes. Guardar 28 haría que el contrato cobrara el 28 en abril, que
 * sí tiene 31 — el recorte se perdería para siempre por un febrero.
 *
 * ── LA REGLA DEL PERIODO (paso 6c) ────────────────────────────────────────────
 *
 * `Cuentas_cobro` ya no guarda un `mes_correspondiente` suelto sino un periodo
 * explícito, `inicio` y `fin`, y la regla que los define vive aquí porque es la
 * regla del día 31 aplicada dos veces:
 *
 *   inicio = la fecha de corte del mes que se factura
 *   fin    = el día ANTERIOR a la siguiente fecha de corte
 *
 * Lo que hace correcta a esta definición y no a la obvia —«inicio más un mes
 * menos un día»— es que los periodos TESELAN el calendario: cada día pertenece a
 * un periodo y sólo a uno, sin huecos ni solapes, sea cual sea el día pactado.
 * Con un corte el 31: enero va del 31/01 al 27/02, febrero del 28/02 al 30/03,
 * marzo del 31/03 al 29/04. Los tres encajan sin dejar un día fuera, y ninguno
 * dura lo mismo. Con la definición obvia, febrero acabaría el 27/03 y los días
 * 28, 29 y 30 de marzo no serían de nadie.
 *
 * `periodoDeCorte()` es la única forma de construir esas dos fechas. No hay una
 * segunda cuenta en el motor ni en el controlador: los dos la llaman.
 */

/** Milisegundos de un día. Sale de sumar y restar fechas de calendario en UTC. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días de cada mes. Febrero se resuelve aparte, que para eso está el bisiesto. */
const DIAS_POR_MES = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * ¿Es bisiesto?
 *
 * La regla completa, no `anio % 4 === 0`: 2100 no es bisiesto y 2000 sí. Sobra
 * para un contrato de arriendo, pero cuesta una línea y evita que alguien lo
 * mire dentro de setenta y cinco años y encuentre un error.
 */
const esBisiesto = (anio) => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** Último día del mes. `mes` es 0-11, como en `Date`. */
const ultimoDiaDelMes = (anio, mes) => DIAS_POR_MES[mes] ?? (esBisiesto(anio) ? 29 : 28);

/**
 * El día `dia` dentro de ese mes, recortado si no existe.
 *
 * Devuelve un número, no una fecha, para que quien llame decida qué construye
 * con él. Ver la regla en la cabecera.
 */
const diaEnMes = (anio, mes, dia) => Math.min(dia, ultimoDiaDelMes(anio, mes));

/**
 * La fecha resultante de aplicar un día del mes a un mes concreto.
 *
 * Sustituye a `new Date(anio, mes, dia)`, que para `dia = 31` en febrero se
 * desborda en silencio al mes siguiente. Aquí el 31 de febrero es el 28, y se
 * ve.
 */
const fechaEnMes = (anio, mes, dia) => new Date(anio, mes, diaEnMes(anio, mes, dia));

/**
 * `YYYY-MM-DD` en UTC. La forma en que se guarda una fecha sin hora.
 *
 * Acepta `Date`, cadena ISO o ya-`YYYY-MM-DD`. Devuelve `null` si no hay fecha
 * válida, para que el llamante decida si eso es un error suyo o no.
 */
const soloFecha = (valor) => {
    if (valor === null || valor === undefined || valor === '') {
        return null;
    }

    const fecha = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
};

/**
 * La primera fecha de corte que le corresponde a un contrato que empieza en
 * `inicio`: la del propio inicio.
 *
 * El primer ciclo de facturación arranca cuando arranca el contrato. Que sea
 * una columna y no esta cuenta es lo que permite cambiarlo después sin tocar el
 * inicio.
 */
const fechaInicioCorteDesde = (inicio) => soloFecha(inicio);

/**
 * El día del mes en que vence el pago: el día en que empieza el contrato.
 *
 * Devuelve `null` si `inicio` no es una fecha válida.
 */
const diaLimiteDesde = (inicio) => {
    const fecha = fechaInicioCorteDesde(inicio);
    return fecha === null ? null : Number(fecha.slice(8, 10));
};

/**
 * El día del mes que guarda una `fecha_inicio_corte` ya almacenada.
 *
 * Sequelize devuelve las columnas `DATEONLY` como `YYYY-MM-DD`, así que aquí no
 * hay zona horaria que valga: se lee el día del texto y punto. Es
 * deliberadamente distinto de `new Date(columna).getDate()`, que sí la tendría.
 */
const diaDeCorte = (fechaInicioCorte) => {
    const fecha = soloFecha(fechaInicioCorte);
    return fecha === null ? null : Number(fecha.slice(8, 10));
};

/** `YYYY-MM-DD` a partir de sus tres componentes. `mes` es 0-11, como en `Date`. */
const comoISO = (anio, mes, dia) =>
    `${String(anio).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Los tres componentes de un `YYYY-MM-DD`. `mes` sale 0-11, como en `Date`. */
const partesDeISO = (fechaISO) => {
    const [anio, mes, dia] = fechaISO.split('-').map(Number);
    return { anio, mes: mes - 1, dia };
};

/** El mes siguiente a uno dado, con el cambio de año resuelto. `mes` es 0-11. */
const mesSiguiente = (anio, mes) => (mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 });

/**
 * El periodo de facturación que empieza en el corte de `mes`/`anio`.
 *
 * @param {number} diaCorte día del mes pactado, 1-31, SIN recortar
 * @param {number} anio     año del periodo
 * @param {number} mes      mes del periodo, 0-11
 * @returns {{inicio: string, fin: string}} las dos fechas en `YYYY-MM-DD`
 *
 * Todo en UTC —`Date.UTC`, nunca el constructor local— porque el resultado es
 * una fecha de calendario que se guarda en una columna `DATE`. Construirla en
 * hora local haría que el día dependiera de dónde corra el proceso, que es
 * exactamente la trampa que documenta la cabecera de este archivo.
 *
 * Ver la regla del periodo, arriba: `fin` es el día anterior al SIGUIENTE corte,
 * no «un mes menos un día».
 */
const periodoDeCorte = (diaCorte, anio, mes) => {
    const siguiente = mesSiguiente(anio, mes);
    const proximoCorte = Date.UTC(
        siguiente.anio,
        siguiente.mes,
        diaEnMes(siguiente.anio, siguiente.mes, diaCorte)
    );

    return {
        inicio: comoISO(anio, mes, diaEnMes(anio, mes, diaCorte)),
        fin: new Date(proximoCorte - MS_POR_DIA).toISOString().slice(0, 10)
    };
};

/**
 * El periodo cuyo corte cae en el mes de `fechaISO`.
 *
 * Atajo para cuando ya se tiene la fecha de inicio y hace falta el fin, que es
 * lo que necesita el alta manual de una cuenta de cobro.
 */
const periodoQueEmpiezaEn = (fechaISO, diaCorte) => {
    const { anio, mes } = partesDeISO(fechaISO);
    return periodoDeCorte(diaCorte, anio, mes);
};

/**
 * Hoy, en `America/Bogota` y como `YYYY-MM-DD`.
 *
 * POR QUÉ NO `new Date()` A SECAS. El motor financiero compara «hoy» contra
 * fechas de calendario guardadas en columnas `DATE`, y una fecha de calendario
 * no significa nada sin decir en qué zona se lee. Hasta el paso 6c la
 * comparación mezclaba las dos convenciones —columnas en UTC contra `new Date()`
 * local— y CLAUDE.md lo tenía anotado como pendiente en Convenciones.
 *
 * La zona es la del negocio, no la del servidor ni UTC: quien decide que un
 * arriendo entró en mora al sexto día lo hace en Bogotá, y en un contenedor
 * configurado en UTC el corte se adelantaría cinco horas. Colombia no tiene
 * horario de verano, así que el desplazamiento es constante, pero se pide por
 * nombre de zona y no como `-05:00` fijo para no tener que revisarlo si algún
 * día lo tuviera.
 */
const ZONA_NEGOCIO = 'America/Bogota';

const hoyEnZonaNegocio = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_NEGOCIO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

/**
 * Días enteros de `desdeISO` a `hastaISO`. Negativo si `hasta` es anterior.
 *
 * Cuenta DÍAS DE CALENDARIO, no intervalos de 24 horas: las dos fechas se
 * interpretan a medianoche UTC, así que el resultado es siempre un entero y no
 * depende de la hora a la que se pregunte. Es lo que permite que «el sexto día»
 * sea una afirmación comprobable.
 */
const diasEntre = (desdeISO, hastaISO) =>
    Math.round((Date.parse(`${hastaISO}T00:00:00Z`) - Date.parse(`${desdeISO}T00:00:00Z`)) / MS_POR_DIA);

module.exports = {
    ZONA_NEGOCIO,
    comoISO,
    diaDeCorte,
    diaEnMes,
    diasEntre,
    diaLimiteDesde,
    esBisiesto,
    fechaEnMes,
    fechaInicioCorteDesde,
    hoyEnZonaNegocio,
    mesSiguiente,
    partesDeISO,
    periodoDeCorte,
    periodoQueEmpiezaEn,
    soloFecha,
    ultimoDiaDelMes
};
