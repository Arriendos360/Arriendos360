/**
 * MS-Inmuebles como CONSUMIDOR de eventos.
 *
 * El estado de ocupacion de un inmueble no lo decide este servicio: lo decide el
 * ciclo de vida del contrato, que vive en otro contexto. Hasta el paso 4 eso se
 * resolvia con un `POST /interno/inmuebles/:id/estado` que el gateway llamaba
 * despues de guardar el contrato; el paso 5 lo sustituye por estos dos
 * manejadores, y aquel endpoint se retiro.
 *
 * QUE CAMBIA DE VERDAD. No es «lo mismo pero por otro canal». Antes, si la
 * llamada fallaba, el cambio de estado se perdia y el contrato quedaba con un
 * inmueble marcado como libre; el aviso al usuario era todo lo que habia. Ahora
 * el evento esta en disco antes de que nadie intente entregarlo, asi que el
 * fallo solo retrasa la convergencia. La garantia pasa de «ojala salga bien» a
 * «acabara pasando».
 *
 * Y CAMBIA LA DIRECCION DEL ACOPLAMIENTO, que es lo que interesa a la defensa.
 * Con la llamada sincrona, quien firmaba un contrato tenia que saber que existe
 * ms-inmuebles y que hay que decirle algo. Con el evento, el productor anuncia
 * un hecho de SU dominio —«se formalizo un contrato»— y este servicio decide por
 * su cuenta que significa eso para el. Es la coreografia del Capitulo 2: nadie
 * ordena, cada uno reacciona.
 *
 * LA AUDITORIA REGISTRA AL SISTEMA, y es un cambio respecto del ADR 0011. Aquel
 * endpoint recibia `solicitado_por` con el `sub` del propietario. El sobre del
 * evento no lleva actor —lleva identificador, tipo, version, momento y carga— y
 * no se le añade uno: un evento describe un hecho del dominio del emisor, no una
 * peticion de una persona a este servicio. Quien firmo el contrato queda
 * registrado donde corresponde, en `contratos.creado_por`; lo que esta fila
 * registra es que el cambio lo hizo un proceso automatico al enterarse, que es
 * exactamente lo que ocurrio.
 */

import {
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  type ContratoFinalizado,
  type ContratoFormalizado,
  type Consumidor,
  type Manejador,
  comoConexion,
  crearConsumidor,
} from 'arriendos360-shared';
import type { EstadoInmueble } from 'arriendos360-contracts';

import { ESQUEMA, sequelize } from '../config/database';
import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/** La bitacora de este consumidor. Ver `database/inmuebles/003`. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/**
 * Mueve el estado dentro de la transaccion del consumidor.
 *
 * La instancia se carga y se actualiza en vez de hacer un `update` con `where`
 * porque los hooks de auditoria son de instancia: un `update` masivo se los
 * saltaria y dejaria `ultima_actualizacion` sin tocar.
 *
 * UN INMUEBLE QUE NO EXISTE NO ES UN FALLO. Se registra y se da por procesado.
 * Reintentar no lo va a hacer aparecer —lo mas probable es que lo hayan
 * borrado— y dejar el evento reintentandose hasta apartarlo solo conseguiria
 * frenar los siguientes de ese mismo inmueble por algo que nadie puede arreglar.
 */
const moverEstado = async (
  idInmueble: string,
  estado: EstadoInmueble,
  transaccion: unknown,
): Promise<void> => {
  const inmueble = await Inmueble.findByPk(idInmueble, {
    transaction: transaccion as never,
  });

  if (!inmueble) {
    console.warn(
      `Evento sobre el inmueble ${idInmueble}, que no existe en este servicio: se ignora.`,
    );
    return;
  }

  await inmueble.update({ estado }, { transaction: transaccion as never });
};

/**
 * Lee el `id_inmueble` de una carga que viene de la red.
 *
 * Confianza cero (regla dura 7): que lo entregue otro servicio con credencial
 * valida no hace confiable lo que hay dentro del sobre. Una carga sin
 * `id_inmueble` con forma de UUID LANZA a proposito, en vez de ignorarse: es un
 * error de programacion del emisor, no un caso de negocio, y el mecanismo ya
 * sabe que hacer con un evento que falla siempre — lo aparta tras varios
 * intentos y lo deja a la vista. Tragarselo en silencio lo escondería.
 */
const inmuebleDe = (payload: unknown, tipo: string): string => {
  const carga = payload as Partial<ContratoFormalizado & ContratoFinalizado>;

  if (!esUuid(carga?.id_inmueble)) {
    throw new Error(`${tipo} sin un id_inmueble valido: ${JSON.stringify(payload)}`);
  }

  return carga.id_inmueble as string;
};

/**
 * Un manejador por tipo.
 *
 * Los dos son la misma operacion en sentidos opuestos, y por eso van juntos:
 * usar un evento para ocupar y una llamada sincrona para liberar dejaria la
 * mitad del ciclo con garantia de entrega y la otra mitad sin ella. Ver
 * `docs/adr/0013`.
 */
export const manejadores: Record<string, Manejador> = {
  [TIPO_CONTRATO_FORMALIZADO]: async (payload, { transaccion }) => {
    await moverEstado(inmuebleDe(payload, TIPO_CONTRATO_FORMALIZADO), 'arrendado', transaccion);
  },

  [TIPO_CONTRATO_FINALIZADO]: async (payload, { transaccion }) => {
    await moverEstado(inmuebleDe(payload, TIPO_CONTRATO_FINALIZADO), 'disponible', transaccion);
  },
};

/**
 * El consumidor del servicio.
 *
 * `crearConsumidor` es quien pone la idempotencia: anota el `id_evento` y aplica
 * el manejador en la MISMA transaccion, asi que una segunda entrega del mismo
 * evento no vuelve a ejecutar nada. Este archivo solo dice que significa cada
 * evento aqui.
 */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
