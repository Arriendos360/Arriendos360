/**
 * Contratos de interfaz de MS-Inmuebles.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 */

/**
 * Cuerpo de `POST /api/inmuebles`.
 *
 * `id_propietario` NO aparece aqui a proposito: se inyecta desde los claims del
 * JWT. Es la regla dura 4 del proyecto — aceptarlo en el cuerpo permitiria
 * registrar inmuebles a nombre de otro usuario.
 *
 * En el modelo canonico `Inmuebles.id_propietario` es una referencia logica a
 * `Usuarios`, sin clave foranea fisica, porque cruza la frontera entre
 * MS-Inmuebles y MS-Identidad (regla dura 1).
 */
export interface CrearInmuebleRequest {
  alias: string;
  direccion: string;
  ciudad: string;
  tipo: string;
  descripcion: string;
}
