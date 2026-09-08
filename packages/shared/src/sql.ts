/**
 * La forma minima de una conexion SQL, para que este paquete no dependa de
 * Sequelize.
 *
 * Es el mismo recurso que ya usa `exigirServicio` con `req`/`res`: tipos
 * ESTRUCTURALES. `packages/shared` lo consumen el gateway (JavaScript), dos
 * servicios en TypeScript y sus pruebas; declarar aqui una dependencia de
 * Sequelize obligaria a instalarlo tambien donde no hace falta y ataria el bus
 * a un ORM que no tiene nada que ver con el.
 *
 * Lo que se pide encaja con `sequelize.query()` y `sequelize.transaction()` tal
 * cual, sin adaptador de por medio.
 */

/** Opciones de una consulta. `transaccion` es opaca: solo se reenvia. */
export interface OpcionesSql {
  replacements?: Record<string, unknown>;
  transaction?: unknown;
}

/**
 * Lo que el bus necesita de una conexion.
 *
 * `query` devuelve la tupla `[filas, metadatos]` de Sequelize. Solo se usa el
 * primer elemento, y solo en los SELECT.
 */
export interface ConexionSql {
  query(sql: string, opciones?: OpcionesSql): Promise<unknown>;
  transaction<T>(callback: (transaccion: unknown) => Promise<T>): Promise<T>;
}

/**
 * Adapta una instancia de Sequelize —o cualquier cosa con la misma forma— a
 * {@link ConexionSql}.
 *
 * Hace falta un `as` y conviene explicar por que, para que nadie lo lea como
 * pereza. `sequelize.query` esta declarado con una docena de SOBRECARGAS, una
 * por cada `QueryTypes`, y TypeScript no considera ese conjunto asignable a una
 * firma simple aunque en la practica lo sea: la incompatibilidad esta en los
 * tipos de las OPCIONES de las sobrecargas que este paquete no usa, no en la
 * llamada que hace.
 *
 * La alternativa —importar Sequelize en `packages/shared`— es peor: lo
 * instalaria tambien donde no hace falta y ataria el bus de eventos a un ORM que
 * no tiene nada que ver con el. El `as` se paga una vez, aqui, con este
 * comentario al lado.
 */
export function comoConexion(conexion: object): ConexionSql {
  return conexion as unknown as ConexionSql;
}

/** Extrae las filas de lo que devuelve `query`, tolerando ambas formas. */
export function filasDe<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado) && Array.isArray(resultado[0])) {
    return resultado[0] as T[];
  }
  return Array.isArray(resultado) ? (resultado as T[]) : [];
}

/**
 * Comprueba que un nombre de tabla sea un identificador simple o cualificado.
 *
 * El nombre de la tabla se INTERPOLA en el SQL —no puede ir como parametro— asi
 * que hay que garantizar que solo llegue lo que es: una constante de
 * configuracion del servicio, nunca algo derivado de una peticion. Esta guarda
 * no sustituye a esa regla, la hace explicita y ruidosa si alguien la olvida.
 */
export function validarNombreDeTabla(tabla: string): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(tabla)) {
    throw new Error(
      `Nombre de tabla no valido: "${tabla}". Debe ser \`esquema.tabla\` en minusculas, ` +
        'y siempre una constante del servicio, nunca un dato de entrada.',
    );
  }
  return tabla;
}
