/**
 * MS-Contratos como PRODUCTOR de eventos.
 *
 * EL PRODUCTOR SE MUDA CON LO QUE PRODUCE. Este archivo estaba en
 * `apps/gateway/src/eventos/`, y su propia cabecera decia por que: el gateway
 * emitia `ContratoFormalizado` porque `contratos` todavia era suya, y la regla
 * que se respetaba era la que importa —**lo emite quien escribe el contrato**—.
 * El paso 6d mueve la tabla, asi que mueve tambien la bandeja de salida y estas
 * lineas. El Capitulo 2 dice que lo emite MS-Contratos, y a partir de aqui es
 * literalmente cierto.
 *
 * LO QUE NO CAMBIA, y es lo que hace que el traslado sea seguro: el evento se
 * anota en la MISMA transaccion que el cambio de dominio. Antes las dos
 * escrituras iban a `public`; ahora van a `contratos`. Siguen siendo la misma
 * base y la misma transaccion, asi que la atomicidad del patron outbox se
 * conserva intacta. Si algun dia este servicio tiene su propia base, seguira
 * siendo la suya.
 *
 * Ver `packages/shared/src/salida.ts` y `docs/adr/0012`.
 */

import {
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  type AlmacenSalida,
  type Publicador,
  comoConexion,
  crearAlmacenSalidaSql,
  crearEntregaHttp,
  crearPublicador,
  crearSobre,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import type { Contrato } from '../models/Contrato';

/** La bandeja de este productor. Ver `database/contratos/001`. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,
});

/**
 * Quien escucha cada tipo.
 *
 * Se configura, no se descubre: nada de service discovery (CLAUDE.md, «Que no
 * hacer»). Se lee del entorno EN CADA ENTREGA, igual que hace la costura del
 * gateway con `MS_*_URL`, y por el mismo motivo practico: las pruebas apuntan el
 * destino a un doble despues de haber cargado este modulo.
 *
 * Hoy los dos eventos van al mismo sitio. En el paso 6e `ContratoFormalizado`
 * gana un segundo suscriptor —ms-financiero, que crea la primera cuenta de
 * cobro— y esto es lo unico que cambia.
 */
const SUSCRIPCIONES: Record<string, Array<{ nombre: string; variable: string }>> = {
  [TIPO_CONTRATO_FORMALIZADO]: [{ nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' }],
  [TIPO_CONTRATO_FINALIZADO]: [{ nombre: 'ms-inmuebles', variable: 'MS_INMUEBLES_URL' }],
};

export const suscriptoresDe = (tipo: string): Array<{ nombre: string; url: string }> =>
  (SUSCRIPCIONES[tipo] ?? [])
    .map(({ nombre, variable }) => ({ nombre, url: (process.env[variable] ?? '').trim() }))
    .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
  suscriptores: suscriptoresDe,
  emisor: () => process.env['SERVICIO_NOMBRE'] ?? 'ms-contratos',
  secreto: () => process.env['SERVICIO_JWT_SECRET'],
});

/**
 * Un publicador sobre esta tabla de salida y este transporte.
 *
 * Se expone la fabrica y no solo la instancia para que las pruebas puedan
 * ajustar lo unico que les estorba —la espera entre reintentos, el limite de
 * intentos— sin sustituir el almacen ni la entrega, que son justo las dos piezas
 * que interesa ejercitar de verdad.
 */
export const crearPublicadorDeSalida = (opciones: Record<string, unknown> = {}): Publicador =>
  crearPublicador({
    almacen,
    entregar,
    intervaloMs: Number(process.env['EVENTOS_INTERVALO_MS']) || undefined,
    ...opciones,
  });

/**
 * El publicador del proceso.
 *
 * Uno solo, creado al cargar el modulo pero SIN arrancar: `server.ts` lo pone en
 * marcha cuando el servidor arranca de verdad, y las pruebas llaman a `ciclo()`
 * a mano. Un temporizador corriendo durante una suite haria que las entregas
 * ocurrieran en momentos que la prueba no controla, que es la forma mas facil de
 * escribir una prueba que falla un dia de cada veinte.
 */
export const publicador: Publicador = crearPublicadorDeSalida();

/**
 * Anota `ContratoFormalizado` en la tabla de salida.
 *
 * **Tiene que ir dentro de la transaccion que guarda el contrato.** Es todo el
 * sentido del patron: las dos escrituras van a la misma base, asi que o quedan
 * las dos o no queda ninguna. Registrarlo fuera reintroduce exactamente el
 * problema del ADR 0011, solo que con mas codigo.
 */
export const registrarContratoFormalizado = (
  contrato: Contrato,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(
    crearSobre(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: contrato.id_contrato,
      id_inmueble: contrato.id_inmueble,
      // `canon` es DECIMAL, y Sequelize devuelve los DECIMAL como texto para no
      // perder precision. El evento lleva un numero.
      canon: Number(contrato.canon),
      // De la columna, tal cual. `DATEONLY` ya viene como `YYYY-MM-DD`.
      fecha_inicio_corte: contrato.fecha_inicio_corte,
    }),
    // El inmueble ordena: sus eventos se entregan en el orden en que se
    // registraron. Sin esto, un `Finalizado` podria adelantar a su
    // `Formalizado` y dejar el inmueble arrendado para siempre.
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
