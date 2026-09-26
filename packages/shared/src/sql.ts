/** Forma mínima de una conexión SQL, compatible con Sequelize sin depender de él. */

/** Opciones de una consulta. `transaccion` es opaca: solo se reenvia. */
export interface OpcionesSql {
  replacements?: Record<string, unknown>;
  transaction?: unknown;
}

/** Lo que el bus necesita de una conexión. `query` devuelve `[filas, metadatos]`. */
export interface ConexionSql {
  query(sql: string, opciones?: OpcionesSql): Promise<unknown>;
  transaction<T>(callback: (transaccion: unknown) => Promise<T>): Promise<T>;
}

/**
 * Adapta una instancia de Sequelize a {@link ConexionSql}. El `as` salva las
 * sobrecargas de `sequelize.query`.
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
 * Valida un nombre de tabla que se interpolará en el SQL. Debe ser siempre una
 * constante del servicio, nunca un dato de entrada.
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
