/**
 * MS-Financiero como CONSUMIDOR de eventos.
 *
 * ── ESTE ES EL CASO QUE EL CAPITULO 2 ESCRIBE TEXTUALMENTE ─────────────────
 *
 * «MS-Contratos guarda el contrato y emite `ContratoFormalizado`. MS-Financiero
 * consume el evento, extrae `id_contrato`, `canon` y `fecha_inicio_corte`, e
 * inserta la primera `Cuenta_cobro`.» El bus existe desde el paso 5 y este es el
 * consumidor para el que se diseño; hasta ahora solo lo usaba ms-inmuebles para
 * mover un estado.
 *
 * Coreografia, no orquestacion: Contratos no llama a Financiero ni sabe que
 * existe. Anuncia un hecho de SU dominio —«se formalizo un contrato»— y este
 * servicio decide por su cuenta que significa eso aqui. Que ahora haya DOS
 * consumidores del mismo evento es justo lo que el diseño anticipaba, y es
 * tambien lo que hace que la bitacora de procesados tenga que ser de cada uno:
 * ms-inmuebles y este servicio procesan el mismo `id_evento` cada uno por su
 * lado, sin enterarse el uno del otro.
 *
 * ── LA IDEMPOTENCIA AQUI NO ES OPCIONAL ────────────────────────────────────
 *
 * `database/inmuebles/003` lo avisaba: poner un inmueble en `arrendado` dos
 * veces no hace daño, pero insertar una cuenta de cobro dos veces es facturarle
 * al inquilino el mismo mes dos veces. La entrega es al-menos-una-vez, asi que
 * la reentrega no es una posibilidad remota sino una certeza.
 *
 * QUIEN LA PONE ES `crearConsumidor`, no este archivo: anota el `id_evento` en
 * `financiero.eventos_procesados` y aplica el manejador en la MISMA transaccion,
 * asi que una segunda entrega no vuelve a ejecutar nada. Este archivo solo dice
 * que significa cada evento aqui.
 *
 * Y hay una SEGUNDA red debajo, que no sustituye a la primera: el indice unico
 * `(id_contrato, inicio)` de `database/financiero/001`. La bitacora evita que el
 * intento se produzca; el indice evita el duplicado aunque alguien se salte la
 * bitacora. La primera protege el flujo, el segundo protege la contabilidad.
 *
 * ── `ContratoFinalizado` NO TIENE MANEJADOR, Y ES DELIBERADO ───────────────
 *
 * Llegara igualmente —el publicador entrega a todos los suscriptores— y el
 * consumidor lo ignorara con un 200, que es lo correcto en una coreografia: un
 * tipo sin manejador significa que la suscripcion sobra, no que la entrega haya
 * fallado.
 *
 * Que no haya manejador es una decision de negocio, no un olvido. Finalizar un
 * contrato NO cancela lo que se le debe: las cuentas de cobro emitidas siguen
 * emitidas y las que estan en mora siguen en mora. Un inquilino que se va
 * debiendo dos meses los sigue debiendo, y borrarle la deuda al firmar la salida
 * seria un fallo contable, no una limpieza. Lo unico que cambia es que dejan de
 * generarse cuentas nuevas, y eso ya pasa solo: `procesarContratos` barre los
 * contratos con estado `activo`.
 *
 * ── LA AUDITORIA REGISTRA AL SISTEMA ───────────────────────────────────────
 *
 * El sobre no lleva actor, asi que la primera cuenta de cobro queda a nombre de
 * USUARIO_SISTEMA y no del propietario que firmo. El rastro NO se pierde,
 * cambia de forma: quien firmo esta en `contratos.contratos.creado_por`, y el
 * evento es el eslabon que une las dos filas. Ver `docs/adr/0011`.
 *
 * ── DESDE EL PASO 7, MANEJAR UN EVENTO PRODUCE OTRO ────────────────────────
 *
 * Crear la primera cuenta de cobro es a su vez un hecho que alguien quiere conocer,
 * asi que el manejador de abajo anota `CuentaCobroGenerada` en
 * `financiero.eventos_salida`. Este servicio es el primero del sistema que consume y
 * produce.
 *
 * Y las TRES escrituras caben en la misma transaccion: la marca del `id_evento` que
 * pone `crearConsumidor`, el INSERT de la cuenta y el del evento nuevo. Mismo
 * esquema, misma base. No puede haber una cuenta sin su aviso, ni un aviso sin su
 * cuenta, ni ninguna de las dos si el evento resulta ser repetido.
 *
 * El INSERT no se hace aqui sino en `services/cuentas.ts`, que es el unico sitio que
 * crea cuentas de cobro — los otros dos caminos que tambien las crean tienen que
 * anotar el mismo evento, y tres sitios que han de acordarse de lo mismo son tres
 * sitios donde uno puede olvidarse.
 */

import {
  TIPO_CONTRATO_FORMALIZADO,
  type ContratoFormalizado,
  type Consumidor,
  type Manejador,
  comoConexion,
  crearConsumidor,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import { esUuid } from '../models/uuid';
import { emitirCuentaCobro } from '../services/cuentas';
import { detalleDelPeriodo, primerPeriodoDe } from '../services/motor';

/** La bitacora de este consumidor. Ver `database/financiero/003`. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/**
 * Lee la carga de `ContratoFormalizado` y comprueba que sirve.
 *
 * CONFIANZA CERO (regla dura 7): que lo entregue otro servicio con credencial
 * valida no hace confiable lo que hay dentro del sobre. Una carga incompleta
 * LANZA a proposito, en vez de ignorarse: es un error de programacion del
 * emisor, no un caso de negocio, y el mecanismo ya sabe que hacer con un evento
 * que falla siempre — lo aparta tras diez intentos y lo deja a la vista.
 * Tragarselo en silencio dejaria un contrato sin facturar y sin rastro.
 *
 * `canon` se comprueba ademas de leerse: es el importe que se va a cobrar, y un
 * `undefined` ahi acabaria en una cuenta de cobro con `valor` nulo que revienta
 * en la base con un mensaje que no menciona el evento.
 *
 * ── `id_inquilino` ES LA EXCEPCION: SI FALTA, NO SE LANZA ──────────────────
 *
 * Llego con la version 2 del evento, en el paso 7, y lo necesita el aviso —no la
 * cuenta de cobro, que no guarda el inquilino en ninguna columna. Un sobre version 1
 * que estuviera esperando en `contratos.eventos_salida` durante el despliegue no lo
 * trae, y lanzar ahi seria apartar el evento tras diez intentos y dejar un contrato
 * SIN FACTURAR por no poder mandar un correo.
 *
 * Asi que se deja pasar y `emitirCuentaCobro` registra que la cuenta se creo sin
 * aviso. Facturar sin avisar es una degradacion aceptable; no facturar, no.
 */
const cargaDeFormalizado = (payload: unknown): ContratoFormalizado => {
  const carga = payload as Partial<ContratoFormalizado>;

  if (!esUuid(carga?.id_contrato)) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} sin un id_contrato valido: ${JSON.stringify(payload)}`,
    );
  }

  const canon = Number(carga.canon);
  if (!Number.isFinite(canon) || canon <= 0) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} ${carga.id_contrato} con un canon invalido: ${String(carga.canon)}`,
    );
  }

  if (primerPeriodoDe(carga.fecha_inicio_corte) === null) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} ${carga.id_contrato} sin fecha_inicio_corte valida: ` +
        `${String(carga.fecha_inicio_corte)}`,
    );
  }

  return { ...(carga as ContratoFormalizado), canon };
};

/**
 * Un manejador por tipo. Hoy uno solo.
 *
 * El periodo se calcula con `primerPeriodoDe()`, que es la MISMA funcion que el
 * motor usa para saber cual es el primero y saltarselo. Que las dos mitades
 * compartan la funcion es lo que garantiza que no puedan discrepar: si una usara
 * el dia pactado y la otra el recortado, un contrato con corte el 31 firmado en
 * enero tendria dos «primeros periodos» distintos y se facturaria dos veces.
 */
export const manejadores: Record<string, Manejador> = {
  [TIPO_CONTRATO_FORMALIZADO]: async (payload, { transaccion }) => {
    const carga = cargaDeFormalizado(payload);
    // No puede ser null: `cargaDeFormalizado` ya lo comprobo y lanzo si no.
    const periodo = primerPeriodoDe(carga.fecha_inicio_corte)!;

    // DENTRO de la transaccion del consumidor, que es la misma en la que quedo
    // anotado el `id_evento`. Escribir fuera perderia la atomicidad que da todo
    // el sentido a esto: o queda la cuenta y la marca, o no queda nada y el
    // productor lo reintenta.
    //
    // Y por el UNICO camino que crea cuentas de cobro, que desde el paso 7 hace dos
    // cosas: el INSERT y el registro de `CuentaCobroGenerada`. Ver
    // `services/cuentas.ts`.
    const { anunciada } = await emitirCuentaCobro(
      {
        id_contrato: carga.id_contrato,
        id_inquilino: carga.id_inquilino,
        detalle: detalleDelPeriodo(periodo),
        valor: carga.canon,
        inicio: periodo.inicio,
        fin: periodo.fin,
      },
      transaccion,
    );

    console.log(
      `🧾 ms-financiero: primera cuenta de cobro del contrato ${carga.id_contrato}` +
        ` — periodo ${periodo.inicio} a ${periodo.fin}, valor ${carga.canon}` +
        `${anunciada ? '' : ' (SIN aviso: el sobre no trae id_inquilino)'}`,
    );
  },
};

/**
 * El consumidor del servicio.
 *
 * `crearConsumidor` es quien pone la idempotencia. Este archivo solo dice que
 * significa cada evento aqui.
 */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
