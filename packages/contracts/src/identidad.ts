/**
 * Contratos de interfaz de MS-Identidad.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 * Los nombres de campo son los del documento, sin traducir ni normalizar.
 */

/**
 * Cuerpo de `POST /api/auth/registro`.
 *
 * Ojo con dos cosas al implementar el servicio:
 *
 * - El campo es `email`, no `correo`. El monolito actual usa `correo` en el
 *   modelo `Usuario`; el contrato del documento manda `email`.
 * - El rol NO viaja en el cuerpo. La asignacion en `RolesUsuario` se maneja
 *   internamente, porque aceptarlo del cliente seria un agujero de
 *   autorizacion.
 */
export interface RegistroUsuarioRequest {
  nombres: string;
  apellidos: string;
  email: string;
  contrasena: string;
  telefono: string;
  documento: string;
}
