/**
 * MS-Identidad como PRODUCTOR de eventos.
 *
 * ── ESTO ES LO QUE EL ADR 0010 DEJO PREPARADO, Y AHORA SE COBRA ─────────────
 *
 * `services/notificador.ts` existia para esto y ya no existe. Su cabecera decia
 * textualmente cual era el plan: «el paso 7 sera sustituir la implementacion —de
 * SMTP a `publicar('RecuperacionSolicitada', ...)`— sin tocar una linea de la
 * logica de recuperacion». Este archivo es esa sustitucion.
 *
 * Y la interfaz se retira con ella, en vez de quedarse con una implementacion
 * nueva detras. Tenia un metodo `notificar({ para, asunto, cuerpoHtml })`, y esos
 * tres campos son justamente los que un evento NO lleva: no hay direccion de
 * correo, no hay asunto y no hay HTML. Quien decide todo eso es ms-notificaciones.
 * Conservar la interfaz habria significado conservar la idea de que este servicio
 * sabe lo que es un correo, que es exactamente de lo que se le libera.
 *
 * Con esto el ADR 0010 queda SALDADO y no incorporado al documento: su desviacion
 * era el envio directo desde ms-identidad, y el envio directo desaparece.
 *
 * ── LOS DOS EVENTOS VAN EN LA TRANSACCION DEL CAMBIO DE DOMINIO ────────────
 *
 * Es todo el sentido del patron outbox, y aqui compra algo concreto en cada caso:
 *
 *   * `RecuperacionSolicitada` se anota junto al INSERT del token. Si el token se
 *     guarda y el evento no, hay un enlace vivo que nadie recibio; si el evento se
 *     anota y el token no, llega un correo con un enlace que no existe. Las dos
 *     escrituras van a `identidad`, asi que caben en una transaccion y ninguno de
 *     los dos casos es posible.
 *
 *   * `ContrasenaTemporalEmitida` se anota junto al alta del usuario o junto al
 *     UPDATE que regenera su contrasena. Un correo que dice «se creo tu cuenta»
 *     sobre una cuenta que no se creo seria peor que no mandarlo.
 *
 * Ver `packages/shared/src/salida.ts` y `docs/adr/0012`.
 */

import {
  TIPO_CONTRASENA_TEMPORAL_EMITIDA,
  TIPO_RECUPERACION_SOLICITADA,
  type AlmacenSalida,
  type Publicador,
  comoConexion,
  crearAlmacenSalidaSql,
  crearEntregaHttp,
  crearPublicador,
  crearSobre,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';

/** La bandeja de este productor. Ver `database/identidad/006`. */
export const TABLA_SALIDA = `${ESQUEMA}.eventos_salida`;

export const almacen: AlmacenSalida = crearAlmacenSalidaSql({
  conexion: comoConexion(sequelize),
  tabla: TABLA_SALIDA,

  /**
   * EL PAYLOAD DE ESTE TIPO SE BORRA AL ENTREGARLO, y es la unica tabla de salida
   * del sistema que lo necesita.
   *
   * El sobre de `RecuperacionSolicitada` lleva el token de restablecimiento EN
   * CLARO, porque el consumidor construye con el el enlace del correo. Mientras
   * `identidad.tokens_recuperacion` guarda solo su SHA-256 —precisamente para que
   * leer esa tabla no permita restablecer la contrasena de nadie— dejarlo legible
   * aqui para siempre anularia esa precaucion por la puerta de atras.
   *
   * El borrado va DENTRO del mismo UPDATE que marca la fila como entregada. No es
   * un detalle de implementacion: si fueran dos operaciones, una caida entre ellas
   * dejaria el token en claro indefinidamente, que es justo el estado que se quiere
   * evitar. Ver `tiposRedactados` en `packages/shared/src/salida.ts`.
   *
   * `ContrasenaTemporalEmitida` NO esta en la lista, y no por descuido: no lleva la
   * contrasena. Solo un `id_usuario` y un motivo, que no son secretos.
   */
  tiposRedactados: [TIPO_RECUPERACION_SOLICITADA],
});

/**
 * Quien escucha cada tipo.
 *
 * Se configura, no se descubre: nada de service discovery (CLAUDE.md, «Que no
 * hacer»). Se lee del entorno EN CADA ENTREGA, igual que hace ms-contratos y por el
 * mismo motivo practico: las pruebas apuntan el destino a un doble despues de haber
 * cargado este modulo.
 *
 * UN SOLO SUSCRIPTOR para los dos tipos, y probablemente para siempre: los dos son
 * avisos a una persona, y avisar a personas es de un unico servicio.
 */
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
    .map(({ nombre, variable }) => ({ nombre, url: (process.env[variable] ?? '').trim() }))
    .filter((destino) => destino.url !== '');

const entregar = crearEntregaHttp({
  suscriptores: suscriptoresDe,
  emisor: () => process.env['SERVICIO_NOMBRE'] ?? 'ms-identidad',
  secreto: () => process.env['SERVICIO_JWT_SECRET'],
});

/**
 * Un publicador sobre esta tabla de salida y este transporte.
 *
 * Se expone la fabrica y no solo la instancia para que las pruebas puedan ajustar lo
 * unico que les estorba —la espera entre reintentos, el limite de intentos— sin
 * sustituir el almacen ni la entrega, que son las dos piezas que interesa ejercitar
 * de verdad.
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
 * marcha cuando el servidor arranca de verdad, y las pruebas llaman a `ciclo()` a
 * mano. Un temporizador corriendo durante una suite haria que las entregas
 * ocurrieran en momentos que la prueba no controla.
 */
export const publicador: Publicador = crearPublicadorDeSalida();

/**
 * Anota `RecuperacionSolicitada`.
 *
 * **Tiene que ir dentro de la transaccion que guarda el token.** Ver la cabecera.
 *
 * `expira_en` viaja tal cual y NO se recalcula en el consumidor. Los 30 minutos
 * empiezan a contar aqui, cuando el token se crea, no cuando el correo sale: si la
 * entrega se retrasa o se reintenta, el enlace llega con menos vida de la que tuvo.
 * Que la fecha viaje es lo que permite que el correo diga la hora de verdad en vez
 * de prometer media hora que ya no existe. Ver `docs/adr/0019`.
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
    // El usuario ordena: pedir recuperacion dos veces invalida el enlace anterior,
    // asi que entregar los dos avisos al reves le mandaria primero el enlace que
    // sirve y despues el que ya no. Es el mismo razonamiento que pone el
    // `id_inmueble` como clave en ms-contratos.
    { transaccion: transaccion as never, claveOrden: datos.idUsuario },
  );

/**
 * Anota `ContrasenaTemporalEmitida`.
 *
 * NO LLEVA LA CONTRASENA, y eso no es una omision: el ADR 0007 decide que la
 * temporal se entrega en mano porque el sistema no puede garantizar que un correo
 * llegue, y ese ADR sigue en pie. El evento avisa de que la cuenta existe; no la
 * abre. Ver la cabecera del tipo en `packages/shared/src/eventos.ts`.
 */
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
