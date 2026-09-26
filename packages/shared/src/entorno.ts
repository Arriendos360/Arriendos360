/**
 * Lectura de variables de entorno. Una variable vacía (`VAR=`) cuenta como ausente
 * y un valor mal formado lanza en vez de caer al defecto.
 */

/** Lo que se lee. Por defecto `process.env`; las pruebas inyectan el suyo. */
export type Entorno = Readonly<Record<string, string | undefined>>;

/** Configuracion ausente o mal formada. Lleva los nombres, nunca los valores de secretos. */
export class ErrorDeEntorno extends Error {
  override readonly name = 'ErrorDeEntorno';

  constructor(
    mensaje: string,
    readonly variables: readonly string[],
  ) {
    super(mensaje);
  }
}

/** El valor configurado, o `undefined` si está ausente o vacío. Nunca devuelve `''`. */
export const leerEntorno = (nombre: string, entorno: Entorno = process.env): string | undefined => {
  const valor = entorno[nombre]?.trim();
  return valor === undefined || valor === '' ? undefined : valor;
};

/** Un texto, o `porDefecto` si la variable esta ausente o vacia. */
export const textoDeEntorno = (
  nombre: string,
  porDefecto: string,
  entorno: Entorno = process.env,
): string => leerEntorno(nombre, entorno) ?? porDefecto;

/** Un entero mayor que cero, o `undefined` si está ausente. Lanza si está mal formado. */
export const enteroOpcionalDeEntorno = (
  nombre: string,
  entorno: Entorno = process.env,
): number | undefined => {
  const valor = leerEntorno(nombre, entorno);
  if (valor === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(valor) || Number(valor) < 1) {
    throw new ErrorDeEntorno(`${nombre}="${valor}" no es un entero mayor que cero.`, [nombre]);
  }

  return Number(valor);
};

/** Un entero positivo, o `porDefecto` si la variable esta ausente o vacia. LANZA si esta mal formado. */
export const enteroDeEntorno = (
  nombre: string,
  porDefecto: number,
  entorno: Entorno = process.env,
): number => enteroOpcionalDeEntorno(nombre, entorno) ?? porDefecto;

/**
 * `si` o `no`; cualquier otro valor lanza. Sin `porDefecto`, la variable es
 * obligatoria.
 */
export const siNoDeEntorno = (
  nombre: string,
  porDefecto?: boolean,
  entorno: Entorno = process.env,
): boolean => {
  const valor = leerEntorno(nombre, entorno)?.toLowerCase();
  if (valor === 'si' || valor === 'sí') {
    return true;
  }
  if (valor === 'no') {
    return false;
  }
  if (valor === undefined && porDefecto !== undefined) {
    return porDefecto;
  }

  throw new ErrorDeEntorno(
    `${nombre} debe ser «si» o «no»${valor === undefined ? '' : `, no «${valor}»`}.`,
    [nombre],
  );
};

/** Las variables de la lista que no tienen valor. */
export const faltantesDeEntorno = (
  nombres: readonly string[],
  entorno: Entorno = process.env,
): string[] => nombres.filter((nombre) => leerEntorno(nombre, entorno) === undefined);

/** Exige que todas las variables tengan valor; lanza con todas las que faltan. */
export const validarEntorno = (
  proceso: string,
  obligatorias: readonly string[],
  entorno: Entorno = process.env,
): void => {
  const faltan = faltantesDeEntorno(obligatorias, entorno);
  if (faltan.length === 0) {
    return;
  }

  throw new ErrorDeEntorno(
    `${proceso}: faltan variables de entorno obligatorias: ${faltan.join(', ')}. ` +
      'Una variable definida pero vacia (`VAR=`) cuenta como ausente.',
    faltan,
  );
};
