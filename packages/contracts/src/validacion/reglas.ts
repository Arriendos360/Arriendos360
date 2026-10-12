/**
 * Reglas de forma de un campo, puras: las ejecutan igual los servicios y la SPA.
 * Reciben un valor ya presente y la etiqueta con su artículo, que encabeza el
 * mensaje: «El documento», «La dirección».
 */

export type Resultado<T> = { valor: T } | { error: string };

export type Regla<T> = (valor: unknown, etiqueta: string) => Resultado<T>;

/** Mínimo de la contraseña que elige la persona: registro, cambio y restablecimiento. */
export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Topes de columna. `NUMERIC(p,2)` admite hasta 10^(p-2) sin incluirlo. */
export const TOPE_NUMERIC_12_2 = 1e10;
export const TOPE_NUMERIC_10_2 = 1e8;
export const MAXIMO_INTEGER = 2147483647;

/** `contracts` no puede importar `shared`, que también la declara. */
const ZONA_NEGOCIO = 'America/Bogota';

/** Concordancia del adjetivo con la etiqueta: «El alias es obligatorio», «La dirección es obligatoria». */
const terminacion = (etiqueta: string): string => (etiqueta.startsWith('La ') ? 'a' : 'o');

export const mensajeObligatorio = (etiqueta: string): string =>
  `${etiqueta} es obligatori${terminacion(etiqueta)}`;

/** El texto recortado de un string o de un número; `null` si es de otro tipo. */
const texto = (valor: unknown): string | null =>
  typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : null;

const PATRON_NOMBRE = /^\p{L}[\p{L}\p{M}' ’-]*\p{L}$/u;

/** Letras de cualquier alfabeto, espacio, apóstrofe (recto o tipográfico) y guion; normalizado. */
export const nombrePersona =
  (max: number): Regla<string> =>
  (valor, etiqueta) => {
    const nombre = typeof valor === 'string' ? valor.normalize('NFC').trim().replace(/\s+/g, ' ') : '';

    if (nombre.length < 2 || nombre.length > max) {
      return { error: `${etiqueta} debe tener entre 2 y ${max} caracteres` };
    }

    return PATRON_NOMBRE.test(nombre)
      ? { valor: nombre }
      : {
          error: `${etiqueta} solo puede tener letras, espacios, apóstrofes y guiones, y empezar y terminar con letra`,
        };
  };

/** Cédula: de 6 a 10 dígitos, sin puntos ni espacios. */
export const cedula: Regla<string> = (valor, etiqueta) => {
  const documento = texto(valor);
  return documento !== null && /^\d{6,10}$/.test(documento)
    ? { valor: documento }
    : { error: `${etiqueta} debe tener de 6 a 10 dígitos, sin puntos ni espacios` };
};

/** Celular colombiano: admite `+57`, espacios, guiones y paréntesis, y se guarda en 10 dígitos. */
export const celular: Regla<string> = (valor, etiqueta) => {
  const numero = (texto(valor) ?? '').replace(/[\s()-]/g, '').replace(/^\+57/, '');
  return /^3\d{9}$/.test(numero)
    ? { valor: numero }
    : { error: `${etiqueta} debe tener 10 dígitos y empezar por 3` };
};

/** Una sola `@`, sin espacios y con punto en el dominio. Sin minúsculas: el login compara exacto. */
export const email: Regla<string> = (valor, etiqueta) => {
  const correo = texto(valor) ?? '';

  if (correo.length > 150) {
    return { error: `${etiqueta} no puede superar 150 caracteres` };
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
    ? { valor: correo }
    : { error: `${etiqueta} no es válid${terminacion(etiqueta)}` };
};

/** Sin recortar: los espacios de una contraseña son suyos. */
export const contrasena: Regla<string> = (valor, etiqueta) =>
  typeof valor === 'string' && valor.length >= LONGITUD_MINIMA_CONTRASENA
    ? { valor }
    : { error: `${etiqueta} debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres` };

/** Texto recortado que cabe en su `VARCHAR`. */
export const textoMax =
  (max: number): Regla<string> =>
  (valor, etiqueta) => {
    const recortado = texto(valor);

    if (recortado === null) {
      return { error: `${etiqueta} debe ser un texto` };
    }

    return recortado.length > max
      ? { error: `${etiqueta} no puede superar ${max} caracteres` }
      : { valor: recortado };
  };

/** Entero, como número o como texto de dígitos, entre `min` y `max`. */
export const entero =
  (min: number, max: number): Regla<number> =>
  (valor, etiqueta) => {
    const crudo = texto(valor);
    const numero =
      typeof valor === 'number' ? valor : crudo !== null && /^\d+$/.test(crudo) ? Number(crudo) : NaN;
    const sinTope = max === MAXIMO_INTEGER;
    const rango = sinTope
      ? `${etiqueta} debe ser un número entero mayor o igual a ${min}`
      : `${etiqueta} debe ser un número entero entre ${min} y ${max}`;

    if (!Number.isInteger(numero) || numero < min) {
      return { error: rango };
    }

    if (numero > max) {
      return { error: sinTope ? `${etiqueta} es demasiado grande` : rango };
    }

    return { valor: numero };
  };

/** Decimal mayor que cero, con punto, que cabe en su columna una vez redondeado a centavos. */
export const decimalPositivo =
  (tope: number): Regla<number> =>
  (valor, etiqueta) => {
    const crudo = texto(valor);
    const numero =
      typeof valor === 'number' ? valor : crudo !== null && /^\d+(\.\d+)?$/.test(crudo) ? Number(crudo) : NaN;

    // Se mide en centavos, como lo guarda la columna: 0.001 sería un 0.00.
    const centavos = Math.round(numero * 100) / 100;

    if (!Number.isFinite(numero) || centavos <= 0) {
      return { error: `${etiqueta} debe ser un número positivo` };
    }

    return centavos >= tope
      ? { error: `${etiqueta} es demasiado grande` }
      : { valor: numero };
  };

const PATRON_FECHA =
  /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Fecha de calendario real, `YYYY-MM-DD` o con hora ISO 8601. Ida y vuelta por
 * `Date.UTC`: `new Date('2026-02-30')` no falla, da el 1 de marzo.
 */
export const fechaCalendario: Regla<string> = (valor, etiqueta) => {
  const fecha = typeof valor === 'string' ? valor.trim() : '';
  const partes = PATRON_FECHA.exec(fecha);
  const invalida = { error: `${etiqueta} no es válid${terminacion(etiqueta)}` };

  if (!partes) {
    return invalida;
  }

  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const compuesta = new Date(Date.UTC(anio, mes - 1, dia));
  const existe =
    compuesta.getUTCFullYear() === anio && compuesta.getUTCMonth() === mes - 1 && compuesta.getUTCDate() === dia;

  return existe && !Number.isNaN(Date.parse(fecha)) ? { valor: fecha } : invalida;
};

/** El día de calendario en Bogotá. Una fecha sin hora es ya un día, no un instante. */
const diaEnBogota = (fecha: string): string =>
  fecha.length === 10
    ? fecha
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_NEGOCIO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(fecha));

/**
 * Fecha real cuyo día en Bogotá no es posterior a `hoy` (`YYYY-MM-DD`, que inyecta
 * quien llama). Se compara el día y no el instante: un pago de hoy entra a cualquier hora.
 */
export const fechaNoFutura =
  (hoy: string): Regla<string> =>
  (valor, etiqueta) => {
    const resultado = fechaCalendario(valor, etiqueta);

    if ('error' in resultado || diaEnBogota(resultado.valor) <= hoy) {
      return resultado;
    }

    return { error: `${etiqueta} no puede ser posterior a hoy` };
  };
