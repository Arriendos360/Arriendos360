/**
 * MS-Identidad como productor: `RecuperacionSolicitada` y
 * `ContrasenaTemporalEmitida`, anotados en la transacción del cambio de dominio.
 */

import {
  comoConexion,
  crearAlmacenSalidaSql,
  crearEntregaHttp,
  crearPublicador,
  crearSobre,
  enteroOpcionalDeEntorno,
  leerEntorno,
  textoDeEntorno,
  TIPO_CONTRASENA_TEMPORAL_EMITIDA,
  TIPO_RECUPERACION_SOLICITADA,
  type AlmacenSalida,
  type Publicador,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';

/** Tabla de salida de este productor. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,

  // Lleva el token de recuperación en claro: su payload se borra al entregarlo.
  tiposRedactados: [TIPO_RECUPERACION_SOLICITADA],
});

/** Quién escucha cada tipo. La URL se lee del entorno en cada entrega. */
const SUSCRIPCIONES: Record<string, Array<{ nombre: string; variable: string }>> = {
  [TIPO_RECUPERACION_SOLICITADA]: [
    { nombre: 'ms-notificaciones', variable: 'MS_NOTIFICACIONES_URL' },
  ],
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: [
    { nombre: 'ms-notificaciones', variable: 'MS_NOTIFICACIONES_URL' },
  ],
};

export const suscriptoresDe = (tipo: string): Array<{ nombre: string; url: string }> =>
  (SUSCRIPCIONES[tipo] ?? [])
    .map(({ nombre, variable }) => ({ nombre, url: leerEntorno(variable) ?? '' }))
    .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
  suscriptores: suscriptoresDe,
  emisor: () => textoDeEntorno('SERVICIO_NOMBRE', 'ms-identidad'),
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

/**
 * Anota `RecuperacionSolicitada` dentro de la transacción que guarda el token.
 * `expira_en` viaja tal cual.
 */
export const registrarRecuperacionSolicitada = (
  datos: { idUsuario: string; token: string; expiraEn: Date },
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_RECUPERACION_SOLICITADA, {
      id_usuario: datos.idUsuario,
      token: datos.token,
      expira_en: datos.expiraEn.toISOString(),
    }),
    // Ordenados por usuario: cada solicitud invalida el enlace anterior.
    { transaccion: transaccion as never, claveOrden: datos.idUsuario },
  );

/** Anota `ContrasenaTemporalEmitida`. No lleva la contraseña. */
export const registrarContrasenaTemporalEmitida = (
  datos: { idUsuario: string; motivo: 'ALTA' | 'REEMISION' },
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_CONTRASENA_TEMPORAL_EMITIDA, {
      id_usuario: datos.idUsuario,
      motivo: datos.motivo,
    }),
    { transaccion: transaccion as never, claveOrden: datos.idUsuario },
  );
