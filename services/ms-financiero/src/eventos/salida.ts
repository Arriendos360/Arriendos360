/**
 * MS-Financiero como productor: `CuentaCobroGenerada`, `CuentaCobroPorVencer` y
 * `CuentaCobroEnMora`, anotados en su tabla de salida.
 */

import {
  comoConexion,
  crearAlmacenSalidaSql,
  crearEntregaHttp,
  crearPublicador,
  crearSobre,
  enteroOpcionalDeEntorno,
  idDeEventoDeterminista,
  leerEntorno,
  textoDeEntorno,
  TIPO_CUENTA_COBRO_EN_MORA,
  TIPO_CUENTA_COBRO_GENERADA,
  TIPO_CUENTA_COBRO_POR_VENCER,
  type AlmacenSalida,
  type CuentaCobroEnMora,
  type CuentaCobroGenerada,
  type CuentaCobroPorVencer,
  type Publicador,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';

/** Tabla de salida de este productor. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,
});

/** Quién escucha cada tipo. La URL se lee del entorno en cada entrega. */
const SUSCRIPCIONES: Record<string, Array<{ nombre: string; variable: string }>> = {
  [TIPO_CUENTA_COBRO_GENERADA]: [
    { nombre: 'ms-notificaciones', variable: 'MS_NOTIFICACIONES_URL' },
  ],
  [TIPO_CUENTA_COBRO_POR_VENCER]: [
    { nombre: 'ms-notificaciones', variable: 'MS_NOTIFICACIONES_URL' },
  ],
  [TIPO_CUENTA_COBRO_EN_MORA]: [
    { nombre: 'ms-notificaciones', variable: 'MS_NOTIFICACIONES_URL' },
  ],
};

export const suscriptoresDe = (tipo: string): Array<{ nombre: string; url: string }> =>
  (SUSCRIPCIONES[tipo] ?? [])
    .map(({ nombre, variable }) => ({ nombre, url: leerEntorno(variable) ?? '' }))
    .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
  suscriptores: suscriptoresDe,
  emisor: () => textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
  secreto: () => process.env['SERVICIO_JWT_SECRET'],
});

/** Crea un publicador sobre esta tabla de salida; las pruebas ajustan sus opciones. */
export const crearPublicadorDeSalida = (opciones: Record<string, unknown> = {}): Publicador =>
  crearPublicador({
    almacen,
    entregar,
    intervaloMs: enteroOpcionalDeEntorno('EVENTOS_INTERVALO_MS'),
    ...opciones,
  });

/** El publicador del proceso, sin arrancar: lo arranca `server.ts`. */
export const publicador: Publicador = crearPublicadorDeSalida();

/** Los avisos de una misma cuenta de cobro se entregan en orden. */
const claveDe = (idCuentaCobro: string): { claveOrden: string } => ({
  claveOrden: idCuentaCobro,
});

/** Anota `CuentaCobroGenerada`. Debe ir en la transacción que crea la cuenta. */
export const registrarCuentaCobroGenerada = (
  carga: CuentaCobroGenerada,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(crearSobre(TIPO_CUENTA_COBRO_GENERADA, carga), {
    transaccion: transaccion as never,
    ...claveDe(carga.id_cuenta_cobro),
  });

/**
 * Anota `CuentaCobroPorVencer` con un `id_evento` derivado de la cuenta, para que
 * un motor que corre dos veces no lo anote dos veces.
 */
export const registrarCuentaCobroPorVencer = (
  carga: CuentaCobroPorVencer,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_CUENTA_COBRO_POR_VENCER, carga, {
      id_evento: idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, carga.id_cuenta_cobro),
    }),
    {
      transaccion: transaccion as never,
      ignorarSiExiste: true,
      ...claveDe(carga.id_cuenta_cobro),
    },
  );

/** Anota `CuentaCobroEnMora`. Debe ir en la transacción que pone la cuenta en EN_MORA. */
export const registrarCuentaCobroEnMora = (
  carga: CuentaCobroEnMora,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(crearSobre(TIPO_CUENTA_COBRO_EN_MORA, carga), {
    transaccion: transaccion as never,
    ...claveDe(carga.id_cuenta_cobro),
  });
