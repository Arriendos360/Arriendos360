/**
 * MS-Financiero como PRODUCTOR de eventos.
 *
 * ── ES EL PRIMER SERVICIO QUE ES LAS DOS COSAS ──────────────────────────────
 *
 * Consumidor —`eventos/index.ts`, que recibe `ContratoFormalizado` y crea con el la
 * primera cuenta de cobro— y productor, desde el paso 7. No es una rareza: la
 * creacion de esa cuenta es a su vez un hecho de su dominio que otro servicio quiere
 * conocer, y no hay ninguna razon por la que un eslabon de una cadena no pueda tener
 * otro detras.
 *
 * Lo bueno es que las dos mitades caben en la MISMA transaccion. El consumidor abre
 * una, anota el `id_evento` en `financiero.eventos_procesados`, y dentro el manejador
 * inserta la cuenta de cobro y anota `CuentaCobroGenerada` aqui. Tres escrituras al
 * mismo esquema de la misma base: o quedan las tres o no queda ninguna. No puede
 * haber una cuenta de cobro sin su aviso ni un aviso sin su cuenta.
 *
 * ── ESTO ES LO QUE EL ADR 0018 DEJO ANOTADO PARA EL PASO 7 ─────────────────
 *
 * «El motor pasara a publicar eventos —cuenta proxima a vencer, cuenta en mora— y
 * Notificaciones decide a quien avisar. Eso convierte a ms-financiero en productor
 * del bus, con su propia tabla de salida.» Esta es esa tabla.
 *
 * Y hay un efecto lateral que se buscaba: el barrido pierde una dependencia HTTP.
 * Hasta aqui `procesarContratos` y `procesarPagos` llamaban a ms-identidad para
 * conseguir direcciones de correo; ahora no lo llaman para nada. El motor habla con
 * ms-contratos y con nadie mas.
 *
 * ── SIN SECRETOS EN EL SOBRE, ASI QUE SIN `tiposRedactados` ────────────────
 *
 * A diferencia de `identidad.eventos_salida`, ninguno de los tres tipos lleva algo
 * que no pueda quedarse escrito: identificadores, importes, fechas y una direccion.
 * Las filas entregadas conservan su payload, que es lo que permite mirar un aviso
 * cuando alguien discute un cobro.
 *
 * Ver `packages/shared/src/salida.ts` y `docs/adr/0019`.
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

/** La bandeja de este productor. Ver `database/financiero/004`. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,
});

/**
 * Quien escucha cada tipo.
 *
 * Se configura, no se descubre: nada de service discovery (CLAUDE.md, «Que no
 * hacer»). Se lee del entorno EN CADA ENTREGA, igual que en ms-contratos y
 * ms-identidad, para que las pruebas puedan apuntar a un doble despues de haber
 * cargado este modulo.
 *
 * Los tres avisos van al mismo sitio, y probablemente siempre: son avisos a personas.
 */
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

/** Igual que en los otros dos productores: la fabrica se expone para las pruebas. */
export const crearPublicadorDeSalida = (opciones: Record<string, unknown> = {}): Publicador =>
  crearPublicador({
    almacen,
    entregar,
    intervaloMs: enteroOpcionalDeEntorno('EVENTOS_INTERVALO_MS'),
    ...opciones,
  });

/**
 * El publicador del proceso. Creado al cargar el modulo pero SIN arrancar:
 * `server.ts` lo pone en marcha y las pruebas llaman a `ciclo()` a mano.
 */
export const publicador: Publicador = crearPublicadorDeSalida();

/**
 * La clave de orden de los tres tipos es la CUENTA DE COBRO.
 *
 * Los avisos de una misma cuenta cuentan una historia y el orden es parte de ella:
 * «se generó», «está por vencer», «entró en mora». Entregarlos al reves le diria a
 * alguien que su cuenta entro en mora y despues que acaba de emitirse.
 *
 * No es el contrato, aunque fuera lo primero que uno piensa: dos cuentas distintas
 * del mismo contrato no tienen ninguna relacion de orden entre si, y compartir clave
 * haria que un aviso atascado de la de marzo frenara el de abril sin motivo. La clave
 * debe ser lo mas fina que la regla permita.
 */
const claveDe = (idCuentaCobro: string): { claveOrden: string } => ({
  claveOrden: idCuentaCobro,
});

/**
 * Anota `CuentaCobroGenerada`.
 *
 * **Tiene que ir dentro de la transaccion que crea la cuenta de cobro.** Lo llaman
 * los TRES caminos que la crean, a traves de `services/cuentas.ts`, que es lo que
 * garantiza que ninguno se olvide.
 */
export const registrarCuentaCobroGenerada = (
  carga: CuentaCobroGenerada,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(crearSobre(TIPO_CUENTA_COBRO_GENERADA, carga), {
    transaccion: transaccion as never,
    ...claveDe(carga.id_cuenta_cobro),
  });

/**
 * Anota `CuentaCobroPorVencer`.
 *
 * ESTE ES EL UNICO DE LOS TRES QUE NO ACOMPAÑA A UN CAMBIO EN LA BASE, y conviene
 * saberlo. Los otros dos van con un INSERT o un UPDATE; este es un aviso puro — el
 * motor detecta que a una cuenta le quedan dos dias y no escribe nada sobre ella.
 *
 * Asi que la idempotencia de ESTE aviso no la protege ninguna fila de dominio, y el
 * motor ya no corre «una vez al dia» por construccion: en Container Apps lo ejecuta un
 * trabajo programado que se reintenta si falla y que no garantiza no solaparse
 * (`docs/adr/0021`). Con `id_evento` aleatorio, cada ejecucion anotaria su aviso y
 * ms-notificaciones mandaria un correo por cada una.
 *
 * Por eso el `id_evento` sale del HECHO —tipo y cuenta de cobro—, y la segunda
 * anotacion choca con la primera en la clave primaria y no se escribe
 * (`ignorarSiExiste`). Una cuenta solo tiene un dia de aviso previo, asi que un aviso
 * por cuenta es exactamente lo correcto.
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

/**
 * Anota `CuentaCobroEnMora`.
 *
 * Va en la misma transaccion que el `UPDATE` que pone la cuenta en `EN_MORA`, y eso
 * cierra el caso por los dos lados: no puede haber una mora sin su aviso ni un aviso
 * sin la mora. Ademas, como la condicion del motor exige que la cuenta venga de
 * `PENDIENTE`, una segunda pasada no vuelve a cambiar el estado y por tanto tampoco
 * vuelve a anotar el evento. El estado de la cuenta hace de bitacora.
 */
export const registrarCuentaCobroEnMora = (
  carga: CuentaCobroEnMora,
  transaccion: unknown,
): Promise<void> =>
  almacen.registrar(crearSobre(TIPO_CUENTA_COBRO_EN_MORA, carga), {
    transaccion: transaccion as never,
    ...claveDe(carga.id_cuenta_cobro),
  });
