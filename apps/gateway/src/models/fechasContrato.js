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
 */

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

module.exports = {
    diaDeCorte,
    diaEnMes,
    diaLimiteDesde,
    esBisiesto,
    fechaEnMes,
    fechaInicioCorteDesde,
    soloFecha,
    ultimoDiaDelMes
};
