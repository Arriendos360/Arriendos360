/**
 * MS-Identidad: autenticación y recuperación de la contraseña.
 *
 * Devuelve lo que responde la API; guardar el token en memoria es de quien llama
 * (`guardarSesion` de `auth/sesion.js`), no de esta capa. Los reintentos del login
 * mientras Azure despierta los servicios también quedan en la pantalla, porque lo
 * que hacen es explicarle a la persona que espere (docs/adr/0022).
 */

import api from '../../services/api';
import { cuerpo, soloCampos } from '../comun';

/** Campos de `POST /api/auth/registro`. El rol no viaja: lo asigna el servicio. */
export const CAMPOS_REGISTRO = ['nombres', 'apellidos', 'email', 'contrasena', 'telefono', 'documento'];

/**
 * `POST /api/auth/login`.
 * @returns `{ token, tipo_token, expiracion, usuario: { id, rol, ... } }`
 */
export const iniciarSesion = ({ email, contrasena }) =>
    cuerpo(api.post('/auth/login', { email: email.trim(), contrasena }));

/** `POST /api/auth/logout`: revoca el `jti` del token actual. */
export const cerrarSesion = () => cuerpo(api.post('/auth/logout'));

/** `POST /api/auth/registro`. Siempre crea un PROPIETARIO. */
export const registrarse = (datos) => cuerpo(api.post('/auth/registro', soloCampos(datos, CAMPOS_REGISTRO)));

/**
 * `POST /api/auth/cambiar-contrasena`. El servicio revoca el token viejo y
 * devuelve otro (`{ token, usuario }`) que hay que guardar en su lugar: el viejo
 * aún afirma que el cambio está pendiente (docs/adr/0007).
 */
export const cambiarContrasena = ({ contrasena_actual, contrasena_nueva }) =>
    cuerpo(api.post('/auth/cambiar-contrasena', { contrasena_actual, contrasena_nueva }));

/** `POST /api/auth/recuperar`. Responde lo mismo exista o no la cuenta (docs/adr/0010). */
export const solicitarRecuperacion = ({ email }) => cuerpo(api.post('/auth/recuperar', { email: email.trim() }));

/** `POST /api/auth/restablecer` con el token de un solo uso que llegó por correo. */
export const restablecerContrasena = ({ token, contrasena_nueva }) =>
    cuerpo(api.post('/auth/restablecer', { token, contrasena_nueva }));
