/** Filtros de la consulta de contratos (RF-08). Lógica pura: la página sólo la pinta. */

import { fechaDeContrato } from './api';

/** El estado que ve el usuario: la situación de un contrato activo, o su estado guardado. */
export const etiquetaDeEstado = (contrato) => contrato.situacion ?? contrato.estado;

/** Hasta cuándo está vigente: el de un activo incluye la prórroga en curso; el de uno terminado es su `fin`. */
const vencimientoDe = (contrato) => contrato.preaviso?.vencimiento ?? fechaDeContrato(contrato.fin);

/**
 * Los contratos que cumplen todos los filtros. El periodo es por traslape (vigentes en algún
 * momento entre `desde` y `hasta`); un extremo vacío no restringe.
 */
// shortcut: filtra en memoria lo que trae la API; si un portafolio pasa de unos miles de contratos, mover los filtros a parámetros del servidor.
export const filtrarContratos = (contratos, { inmueble, estado, desde, hasta }) =>
    contratos.filter((contrato) =>
        (!inmueble || contrato.id_inmueble === inmueble) &&
        (!estado || etiquetaDeEstado(contrato) === estado) &&
        (!hasta || fechaDeContrato(contrato.inicio) <= hasta) &&
        (!desde || vencimientoDe(contrato) >= desde));
