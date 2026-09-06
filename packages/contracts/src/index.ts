/**
 * DTOs compartidos de Arriendos360.
 *
 * Traduccion literal de los contratos de interfaz del Documento Principal
 * (Capitulo 2). Es un paquete de solo tipos: no emite JavaScript ejecutable ni
 * valida nada en runtime. Cuando cada microservicio se extraiga, estos tipos son
 * la referencia unica de la forma de cada payload.
 *
 * Nadie los consume todavia (paso 2 de la migracion).
 */

export type {
  DiaDelMes,
  FechaHoraISO,
  FechaISO,
  MontoCOP,
  UUID,
} from './comunes';

export type { RegistroUsuarioRequest } from './identidad';

export type { CrearInmuebleRequest } from './inmuebles';

export type {
  CrearAnexoFormData,
  CrearContratoRequest,
  TipoAnexo,
} from './contratos';

export type {
  MedioPago,
  RegistrarPagoRequest,
  TipoTransaccion,
} from './financiero';
