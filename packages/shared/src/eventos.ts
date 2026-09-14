/**
 * Tipos de evento del bus.
 *
 * CLAUDE.md los ubica aqui —«Los tipos de evento viven en packages/shared»— y
 * el motivo no es la comodidad: un evento es un contrato entre dos servicios
 * que no se llaman, y por tanto no hay ninguna peticion HTTP cuyo fallo revele
 * que se han separado. Si el productor y el consumidor declararan cada uno su
 * propia forma del evento, la divergencia solo se veria en produccion y en
 * forma de dato que no llega.
 *
 * EL SOBRE Y LA CARGA SON COSAS DISTINTAS. `SobreEvento` es infraestructura:
 * identificador, tipo, version, momento de ocurrencia. Lo entiende el
 * publicador y lo entiende el consumidor, y ninguno de los dos necesita saber
 * que hay dentro. La carga es dominio, y cada tipo tiene la suya.
 *
 * LA VERSION VA DESDE EL PRIMER EVENTO. Hoy todos son `1` y no aporta nada;
 * ponerla despues, cuando aporte, exige que el consumidor trate como version 1
 * los eventos que no la traen —es decir, exige exactamente el codigo que se
 * queria ahorrar, mas la duda de si un sobre sin version es viejo o esta roto.
 * Cuesta un campo ahora y evita una migracion de datos historicos luego.
 */

import crypto from 'crypto';

/** Nombre de cada tipo. Como constante para que un typo no compile. */
export const TIPO_CONTRATO_FORMALIZADO = 'ContratoFormalizado';
export const TIPO_CONTRATO_FINALIZADO = 'ContratoFinalizado';

// Los cinco del paso 7. Los dos primeros los emite ms-identidad; los tres
// ultimos, ms-financiero. Los cinco tienen UN consumidor: ms-notificaciones.
export const TIPO_RECUPERACION_SOLICITADA = 'RecuperacionSolicitada';
export const TIPO_CONTRASENA_TEMPORAL_EMITIDA = 'ContrasenaTemporalEmitida';
export const TIPO_CUENTA_COBRO_GENERADA = 'CuentaCobroGenerada';
export const TIPO_CUENTA_COBRO_POR_VENCER = 'CuentaCobroPorVencer';
export const TIPO_CUENTA_COBRO_EN_MORA = 'CuentaCobroEnMora';

/**
 * NINGUN EVENTO LLEVA UNA DIRECCION DE CORREO, Y ESO ES REGLA, NO OLVIDO.
 *
 * Los cinco tipos del paso 7 existen para avisar a una persona, asi que la
 * tentacion evidente es meter su correo en el sobre y ahorrarle una consulta al
 * consumidor. No se hace. Un correo es un dato de contacto que pertenece a
 * `identidad.usuarios` y a nadie mas; copiarlo en un evento convierte a cada
 * emisor en responsable de mantenerlo al dia, y deja copias viejas en la tabla
 * de salida de dos servicios que no tienen forma de enterarse de que cambio.
 *
 * Lo que viaja es el `id_usuario`. `ms-notificaciones` resuelve el destinatario
 * preguntandoselo a ms-identidad al manejar el evento, que es el unico momento
 * en el que la respuesta es actual.
 *
 * LO QUE SI VIAJA ES EL ASUNTO DEL MENSAJE: la direccion del inmueble, el valor,
 * el periodo. No son datos de contacto sino el hecho que se anuncia, el emisor
 * los tiene en la mano, y son ciertos en el instante de `ocurrido_en` — que es
 * justo lo que un aviso tiene que contar. Es el mismo criterio que puso `canon`
 * en `ContratoFormalizado`.
 */

/**
 * `ContratoFormalizado` — se firmo un contrato sobre un inmueble.
 *
 * Fuente: Capitulo 2, seccion Comunicacion entre servicios. El documento lo
 * describe como el disparador de la creacion en cadena: MS-Contratos lo emite,
 * MS-Financiero lo consume y crea la primera cuenta de cobro.
 *
 * `canon` y `fecha_inicio_corte` viajan aunque hoy no los use nadie: son
 * exactamente lo que MS-Financiero necesitara en el paso 6, y el emisor es el
 * unico que los tiene a mano en el momento de emitir. Pedirlos despues por HTTP
 * convertiria la coreografia en una orquestacion disfrazada.
 *
 * ── VERSION 2 DESDE EL PASO 7: VIAJA TAMBIEN `id_inquilino` ────────────────
 *
 * El mismo argumento, una vuelta mas. MS-Financiero crea la primera cuenta de
 * cobro al recibir este evento y, desde el paso 7, anuncia esa creacion con
 * `CuentaCobroGenerada` — que necesita saber a quien se le factura. Dentro de la
 * transaccion del consumidor ese dato no esta en ninguna parte: la cuenta de
 * cobro no guarda el inquilino, lo guarda el contrato, que es de otro servicio.
 *
 * Pedirlo por HTTP ahi seria exactamente la orquestacion disfrazada que el
 * parrafo anterior descarta, y ademas con una transaccion abierta. Lo tiene el
 * emisor, asi que viaja.
 *
 * COMPATIBILIDAD. La version sube a 2, pero el campo se declara OPCIONAL a
 * proposito: en el despliegue del paso 7 puede haber sobres version 1 esperando
 * en `contratos.eventos_salida`, y esos tienen que seguir creando su cuenta de
 * cobro. El consumidor los acepta y se limita a no notificar — ver
 * `services/ms-financiero/src/eventos/index.ts`. Un evento viejo que factura y
 * no avisa es una degradacion aceptable; uno que acaba apartado y deja un
 * contrato sin facturar, no.
 */
export interface ContratoFormalizado {
  id_contrato: string;
  id_inmueble: string;
  /** Pesos colombianos. Viaja como numero, no como texto formateado. */
  canon: number;
  /** `YYYY-MM-DD`. Primera fecha de corte del ciclo de facturacion. */
  fecha_inicio_corte: string;
  /** Version 2. Opcional por compatibilidad: ver la cabecera. */
  id_inquilino?: string;
}

/**
 * `ContratoFinalizado` — un contrato dejo de estar vigente.
 *
 * NO esta en el Capitulo 2. El documento da un ejemplo de la comunicacion
 * asincrona, no la lista cerrada de eventos del sistema; usar un evento para
 * ocupar el inmueble y una llamada sincrona para liberarlo dejaria la mitad del
 * ciclo de vida con garantia de entrega y la otra mitad sin ella. Ver
 * `docs/adr/0013`.
 *
 * Lleva `id_inmueble` y no solo `id_contrato` a proposito: el consumidor tiene
 * que poder actuar sin volver a preguntar. Un evento que obliga a llamar al
 * emisor para entenderse no desacopla nada.
 */
export interface ContratoFinalizado {
  id_contrato: string;
  id_inmueble: string;
}

// ── Los cinco del paso 7: lo que hoy es un correo enviado a mano ────────────
//
// Los cinco sustituyen un `sendMail` directo desde un servicio que no deberia
// saber que existe SMTP. Ver `docs/adr/0019`.

/**
 * `RecuperacionSolicitada` — alguien pidio restablecer su contrasena.
 *
 * ── EL TOKEN VIAJA EN CLARO, Y ESO TIENE UN PRECIO QUE HAY QUE CONOCER ─────
 *
 * `identidad.tokens_recuperacion` guarda solo el SHA-256 del token: quien lea
 * esa tabla no puede restablecer la contrasena de nadie. Este evento rompe a
 * medias esa propiedad, porque el token en claro se escribe en
 * `identidad.eventos_salida.payload` hasta que se entrega.
 *
 * No hay forma de evitarlo sin algo peor: la alternativa era que Notificaciones
 * acuñara el token llamando a ms-identidad al enviar, y eso convierte a un
 * servicio Generico en causa de un cambio de estado de Soporte, y deja
 * «pedir recuperacion invalida el enlace anterior» dependiendo del orden de
 * entrega.
 *
 * Lo que si se hace es ACOTAR la ventana: el `payload` se borra EN LA MISMA
 * SENTENCIA que marca la fila como entregada, no en una segunda operacion. Ver
 * `tiposRedactados` en `salida.ts`.
 *
 * NO LLEVA EL ENLACE, SOLO EL TOKEN. Construirlo es cosa del canal, y el canal
 * es Notificaciones: `URL_APP` vive alli. Un evento que llevara la URL ya armada
 * estaria decidiendo por el consumidor como se presenta el aviso.
 *
 * `expira_en` VIAJA Y NO SE RECALCULA. Los 30 minutos empiezan cuando el token
 * se crea, no cuando el correo sale: si la entrega se reintenta, el enlace llega
 * con menos vida de la que tenia. Que la fecha viaje es lo que permite que el
 * correo diga la verdad en vez de prometer media hora que ya no existe.
 */
export interface RecuperacionSolicitada {
  id_usuario: string;
  /** El token EN CLARO. Ver la cabecera. */
  token: string;
  /** ISO 8601 en UTC. Cuando deja de valer el enlace. */
  expira_en: string;
}

/**
 * `ContrasenaTemporalEmitida` — se le creo o reemitio un acceso a alguien.
 *
 * ── NO LLEVA LA CONTRASEÑA, Y ESE ES EL PUNTO ──────────────────────────────
 *
 * El ADR 0007 decide que la temporal se entrega EN MANO y no por correo, y ese
 * ADR no se toca: meterla aqui la escribiria en dos tablas y la mandaria por un
 * canal que aquel declaro inadecuado para una credencial.
 *
 * Entonces, ¿para que existe el evento? Para que la persona se entere de que
 * existe una cuenta a su nombre. Un inquilino dado de alta por su arrendador no
 * pidio nada y hoy no recibe ningun aviso; el correo le dice que la cuenta
 * existe y que la contrasena se la dara quien lo dio de alta. Es un aviso, no un
 * canal de entrega de credenciales.
 */
export interface ContrasenaTemporalEmitida {
  id_usuario: string;
  /** `ALTA` la creo; `REEMISION` la regenero. Cambia el texto, no el canal. */
  motivo: 'ALTA' | 'REEMISION';
}

/**
 * `CuentaCobroGenerada` — se emitio una factura contra un contrato.
 *
 * La emiten los TRES caminos que crean una cuenta de cobro: el consumidor de
 * `ContratoFormalizado` (la primera), el barrido del motor (las siguientes) y el
 * alta manual del propietario. El hecho es el mismo en los tres, asi que el
 * evento es el mismo — y eso hace que el alta manual pase a avisar al inquilino,
 * que es comportamiento nuevo. Ver `docs/adr/0019`.
 *
 * NO LLEVA la direccion del inmueble, a diferencia de los dos siguientes, y no
 * es un descuido: la primera cuenta nace dentro de la transaccion del consumidor
 * de `ContratoFormalizado`, que no trae la direccion. Un campo que dos de los
 * tres emisores pueden llenar y el tercero no es peor que no tenerlo.
 *
 * Un hecho IRREVERSIBLE: una cuenta de cobro no se anula ni se borra —lo
 * anulable es la transaccion, ADR 0016— asi que no hay ningun evento de
 * retractacion que lo acompañe.
 */
export interface CuentaCobroGenerada {
  id_cuenta_cobro: string;
  id_contrato: string;
  /** A quien se le factura. El destinatario del aviso. */
  id_inquilino: string;
  /** Pesos colombianos, como numero. */
  valor: number;
  /** El periodo facturado, `YYYY-MM-DD`. Ver `periodoDeCorte()`. */
  inicio: string;
  fin: string;
}

/**
 * `CuentaCobroPorVencer` — a una cuenta pendiente se le acaba el plazo.
 *
 * ── EL NOMBRE NO ES UN PARTICIPIO PASADO, Y ES DELIBERADO ──────────────────
 *
 * Los dos eventos del paso 5 son `ContratoFormalizado` y `ContratoFinalizado`.
 * La alternativa que respetaba el patron era `VencimientoProximoDetectado`, que
 * describe el barrido que lo encontro en vez del hecho que se anuncia. La
 * convencion existe para que el nombre describa el hecho, no al contrario.
 *
 * DOS DESTINATARIOS, UN EVENTO. Avisa al inquilino y al propietario, y decidir
 * eso es de Notificaciones: el emisor anuncia un hecho, no una lista de correos.
 * De ahi que viajen los dos identificadores.
 *
 * `entra_en_mora_el` ES UNA FECHA Y NO «MAÑANA». El correo que esto sustituye
 * decia «tienes hasta mañana», que era cierto en el instante del `sendMail`
 * porque el envio iba dentro del barrido. Con el bus hay una ventana entre el
 * hecho y el correo, y los reintentos la estiran: una frase relativa se vuelve
 * falsa sola. Una fecha sigue siendo cierta cuando llega.
 *
 * `valor` Y NO `saldo_pendiente`: este evento solo se emite sobre cuentas
 * `PENDIENTE` —el barrido excluye `PARCIAL`— asi que ahi los dos numeros son el
 * mismo. Derivar el saldo costaria una consulta por fila dentro del bucle, y la
 * garantia del motor es que su numero de viajes no dependa de cuantos contratos
 * haya.
 */
export interface CuentaCobroPorVencer {
  id_cuenta_cobro: string;
  id_contrato: string;
  id_inquilino: string;
  /** Dueño del inmueble EN EL MOMENTO DEL HECHO. Ver `docs/adr/0019`. */
  id_propietario: string;
  valor: number;
  inicio: string;
  fin: string;
  /** `YYYY-MM-DD`. El dia en que la cuenta pasaria a EN_MORA. */
  entra_en_mora_el: string;
  /** El asunto del mensaje, no un dato de contacto. Ver la cabecera del modulo. */
  direccion_inmueble: string;
}

/**
 * `CuentaCobroEnMora` — una cuenta paso el periodo de gracia sin pagarse.
 *
 * Mismo reparto que el anterior: un evento, dos destinatarios. La diferencia es
 * que este acompaña un cambio de estado real en la base —`PENDIENTE` a
 * `EN_MORA`— asi que se registra en la misma transaccion que ese cambio: no
 * puede haber un aviso de mora sin mora, ni una mora sin aviso.
 */
export interface CuentaCobroEnMora {
  id_cuenta_cobro: string;
  id_contrato: string;
  id_inquilino: string;
  id_propietario: string;
  valor: number;
  inicio: string;
  fin: string;
  /** Dias de calendario en `America/Bogota` desde el corte. */
  dias_de_mora: number;
  direccion_inmueble: string;
}

/** Carga que corresponde a cada tipo. Es lo que ata el nombre con su forma. */
export interface CargaPorTipo {
  [TIPO_CONTRATO_FORMALIZADO]: ContratoFormalizado;
  [TIPO_CONTRATO_FINALIZADO]: ContratoFinalizado;
  [TIPO_RECUPERACION_SOLICITADA]: RecuperacionSolicitada;
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: ContrasenaTemporalEmitida;
  [TIPO_CUENTA_COBRO_GENERADA]: CuentaCobroGenerada;
  [TIPO_CUENTA_COBRO_POR_VENCER]: CuentaCobroPorVencer;
  [TIPO_CUENTA_COBRO_EN_MORA]: CuentaCobroEnMora;
}

export type TipoEvento = keyof CargaPorTipo;

/**
 * El sobre: lo que se guarda en la tabla de salida y lo que viaja por la red.
 *
 * `id_evento` es la pieza sobre la que descansa todo el mecanismo. La entrega
 * es al-menos-una-vez, asi que el consumidor recibira repetidos; sin un
 * identificador estable del EVENTO —no de la entrega— no hay forma de
 * distinguir «me lo mandaron dos veces» de «pasaron dos cosas iguales».
 */
export interface SobreEvento<T extends TipoEvento = TipoEvento> {
  id_evento: string;
  tipo: T;
  version: number;
  /** ISO 8601 en UTC. Cuando OCURRIO el hecho, no cuando se entrego. */
  ocurrido_en: string;
  payload: CargaPorTipo[T];
}

/**
 * El sobre tal como lo ve la INFRAESTRUCTURA: con la carga opaca.
 *
 * El publicador, el transporte y el consumidor mueven sobres sin abrirlos, y
 * ademas manejan tipos que este paquete quiza ya no conozca —un evento viejo
 * que sigue en la tabla de salida despues de un despliegue. Por eso `tipo` es
 * `string` y `payload` es `unknown`: quien tiene que entender la carga es el
 * manejador, que es el unico que sabe que espera.
 */
export interface SobreOpaco {
  id_evento: string;
  tipo: string;
  version: number;
  ocurrido_en: string;
  payload: unknown;
}

/** Alias historico de {@link SobreOpaco}. */
export type SobreDesconocido = SobreOpaco;

/**
 * Version vigente de cada tipo. Sube cuando cambia la forma de su carga.
 *
 * `ContratoFormalizado` va por la 2 desde el paso 7, cuando gano
 * `id_inquilino`. Es la primera vez que este numero sirve para algo, y lo que
 * demuestra es lo que decia la cabecera del modulo: ponerlo desde el primer
 * evento costo un campo, y no haberlo puesto habria costado distinguir un sobre
 * viejo de uno roto.
 */
export const VERSION_EVENTO: Record<TipoEvento, number> = {
  [TIPO_CONTRATO_FORMALIZADO]: 2,
  [TIPO_CONTRATO_FINALIZADO]: 1,
  [TIPO_RECUPERACION_SOLICITADA]: 1,
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: 1,
  [TIPO_CUENTA_COBRO_GENERADA]: 1,
  [TIPO_CUENTA_COBRO_POR_VENCER]: 1,
  [TIPO_CUENTA_COBRO_EN_MORA]: 1,
};

/**
 * Mete una carga en su sobre.
 *
 * El `id_evento` se genera aqui, en la aplicacion, por la misma razon que los
 * UUID de las tablas: el emisor tiene que conocerlo antes de que la fila
 * exista, porque lo escribe DENTRO de su transaccion de dominio.
 */
export function crearSobre<T extends TipoEvento>(
  tipo: T,
  payload: CargaPorTipo[T],
  opciones: { id_evento?: string; ocurrido_en?: Date } = {},
): SobreEvento<T> {
  return {
    id_evento: opciones.id_evento ?? crypto.randomUUID(),
    tipo,
    version: VERSION_EVENTO[tipo],
    ocurrido_en: (opciones.ocurrido_en ?? new Date()).toISOString(),
    payload,
  };
}

/**
 * Valida la forma del sobre que llega por la red.
 *
 * Confianza cero tambien aqui: el que entrega es otro servicio, pero eso ya no
 * hace confiable lo que manda (regla dura 7). Se comprueba la estructura, no la
 * carga: de la carga responde el manejador, que es quien sabe que espera.
 */
export function esSobreEvento(valor: unknown): valor is SobreOpaco {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }

  const sobre = valor as Record<string, unknown>;

  return (
    typeof sobre['id_evento'] === 'string' &&
    sobre['id_evento'].length > 0 &&
    typeof sobre['tipo'] === 'string' &&
    sobre['tipo'].length > 0 &&
    typeof sobre['version'] === 'number' &&
    typeof sobre['ocurrido_en'] === 'string' &&
    typeof sobre['payload'] === 'object' &&
    sobre['payload'] !== null
  );
}
