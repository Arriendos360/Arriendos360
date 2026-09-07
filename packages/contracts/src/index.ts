/**
 * DTOs compartidos de Arriendos360.
 *
 * Traduccion literal de los contratos de interfaz del Documento Principal
 * (Capitulo 2). Es un paquete de solo tipos: no emite JavaScript ejecutable ni
 * valida nada en runtime. Cuando cada microservicio se extraiga, estos tipos son
 * la referencia unica de la forma de cada payload.
 *
 * Nadie los consume todavia: el Dockerfile del gateway construye con contexto
 * `apps/gateway`, asi que `packages/` no entra en la imagen. Se conectan en el
 * paso 3b, que ya tiene que tocar los Dockerfiles para extraer ms-identidad.
 */

export type {
  DiaDelMes,
  FechaHoraISO,
  FechaISO,
  MontoCOP,
  UUID,
} from './comunes';

export type {
  ClaimsToken,
  LoginRequest,
  LoginResponse,
  RegistroUsuarioRequest,
  TokenRevocado,
  UsuarioLogin,
} from './identidad';

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
