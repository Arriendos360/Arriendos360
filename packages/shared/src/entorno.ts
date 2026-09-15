/**
 * Lectura de variables de entorno.
 *
 * ── LA CADENA VACIA ES AUSENCIA ────────────────────────────────────────────
 *
 * Compose pasa `VAR=` cuando la variable del host no esta definida, y `dotenv` hace
 * lo mismo con cada linea de un `.env` copiado de `.env.example` —que por regla dura
 * lleva TODOS los valores vacios—. En los dos casos `process.env.VAR` es `''`, no
 * `undefined`, y un `process.env.VAR ?? defecto` deja pasar la cadena vacia:
 *
 *   - `Number('' ?? 15000)` es `0`, y un intervalo de 0 ms es un bucle;
 *   - `Number('' ?? 3013)` es `0`, y `listen(0)` escucha en un puerto al azar;
 *   - `'' ?? 'ms-contratos'` firma las llamadas `/interno` con un emisor vacio, y el
 *     destinatario las rechaza todas.
 *
 * Mordio tres veces antes de centralizarse: el intervalo de revocados, el usuario
 * SMTP del mailer y el remitente de los correos. Las dos ultimas se arreglaron con
 * un helper local cada una; esto es ese helper, una sola vez.
 *
 * ── Y UN VALOR MAL FORMADO NO CAE AL DEFECTO ───────────────────────────────
 *
 * `Number(x) || defecto` convertia `abc` y `0` en el defecto sin decir nada. Aqui un
 * entero que no lo es LANZA: una variable escrita mal es un error de configuracion,
 * y descubrirlo al arrancar es mejor que descubrir que el refresco va cada 15 s
 * cuando se pidio otra cosa.
 *
 * ── LAS QUE NO TIENEN DEFECTO RAZONABLE SE EXIGEN AL ARRANCAR ──────────────
 *
 * Secretos, la contrasena de la base y las URL de los servicios de los que depende
 * cada uno. Con ellas vacias el proceso no fallaba al levantar: fallaba despues, en
 * cada peticion, o no fallaba nunca —un evento sin suscriptor se da por entregado—.
 * `validarEntorno` se llama al principio del arranque y NO en las pruebas, que
 * importan la `app` sin pasar por el servidor.
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

/**
 * El valor configurado, o `undefined` si no hay ninguno.
 *
 * Una variable vacia o con solo espacios cuenta como ausente. Por eso a partir de aqui
 * `??` SI es seguro: esta funcion nunca devuelve `''`.
 */
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

/**
 * Un entero positivo, o `undefined` si la variable esta ausente o vacia.
 *
 * LANZA si tiene valor y no es un entero mayor que cero. Puertos, intervalos y tiempos
 * limite: en ninguno tiene sentido el 0, y en dos de ellos el 0 es un bucle.
 */
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
 * Un si/no: `si` o `no`, y nada mas. `true`, `1` o `yes` LANZAN, para que no haya dos
 * formas de escribir lo mismo en dos entornos.
 *
 * Sin `porDefecto` la variable es obligatoria, y ausente tambien LANZA. Es lo que se
 * quiere para diferencias entre entornos que tienen que estar escritas, como
 * `MIGRACIONES_AL_ARRANCAR`.
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

/**
 * Exige que todas las variables de la lista tengan valor. LANZA con TODAS las que
 * faltan, no solo la primera: arreglar un despliegue de una en una es un rato perdido
 * por variable.
 */
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
