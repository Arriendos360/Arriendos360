/**
 * MS-Contratos como productor: `ContratoFormalizado` y `ContratoFinalizado`,
 * anotados en la misma transacción que el cambio del contrato.
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
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  type AlmacenSalida,
  type Publicador,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import type { Contrato } from '../models/Contrato';

/** Tabla de salida de este productor. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,
});

/**
 * Quién escucha cada tipo. La URL se lee del entorno en cada entrega. Un evento
 * con dos suscriptores se marca entregado cuando aceptan los dos.
 */
const SUSCRIPCIONES: Record<string, Array<{ nombre: string; variable: string }>> = {
  [TIPO_CONTRATO_FORMALIZADO]: [
    { nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' },
    { nombre: 'ms-financiero', variable: 'MS_FINANCIERO_URL' },
  ],
  [TIPO_CONTRATO_FINALIZADO]: [{ nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' }],
};

export const suscriptoresDe = (tipo: string): Array<{ nombre: string; url: string }> =>
  (SUSCRIPCIONES[tipo] ?? [])
    .map(({ nombre, variable }) => ({ nombre, url: leerEntorno(variable) ?? '' }))
    .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
  suscriptores: suscriptoresDe,
  emisor: () => textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
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

/** Anota `ContratoFormalizado`. Debe ir dentro de la transacción que guarda el contrato. */
export const registrarContratoFormalizado = (
  contrato: Contrato,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: contrato.id_contrato,
      id_inmueble: contrato.id_inmueble,
      // Sequelize devuelve los DECIMAL como texto; el evento lleva un número.
      canon: Number(contrato.canon),
      // De la columna, tal cual. `DATEONLY` ya viene como `YYYY-MM-DD`.
      fecha_inicio_corte: contrato.fecha_inicio_corte,
      // Versión 2: ms-financiero lo usa para notificar la primera cuenta de cobro.
      id_inquilino: contrato.id_inquilino,
    }),
    // Ordenados por inmueble, para que un `Finalizado` no adelante a su `Formalizado`.
    { transaccion: transaccion as never, claveOrden: contrato.id_inmueble },
  );

/** Anota `ContratoFinalizado`. Mismas condiciones que el anterior. */
export const registrarContratoFinalizado = (
  contrato: Contrato,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_CONTRATO_FINALIZADO, {
      id_contrato: contrato.id_contrato,
      id_inmueble: contrato.id_inmueble,
    }),
    { transaccion: transaccion as never, claveOrden: contrato.id_inmueble },
  );
