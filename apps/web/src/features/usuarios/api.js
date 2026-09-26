/**
 * MS-Identidad, para el propietario que va a firmar un contrato: busca al
 * inquilino por documento o lo da de alta.
 */

import api from '../../services/api';
import { cuerpo, soloCampos } from '../comun';

/**
 * Campos del alta de inquilino: los del registro sin `contrasena`.
 * El servicio exige `nombres`, `apellidos`, `email` y `documento`; `telefono` es
 * opcional. Un email o documento repetido responde 400, no 409.
 */
export const CAMPOS_INQUILINO = ['nombres', 'apellidos', 'email', 'telefono', 'documento'];

/**
 * `GET /api/usuarios?documento=`.
 * @returns `{ id, nombres, apellidos }`, o `null` si nadie tiene ese documento.
 *   No dice los roles: si la persona existe pero no es INQUILINO, el alta del
 *   contrato responde 404 `TENANT_NOT_FOUND`.
 */
export const buscarPorDocumento = async (documento) => {
    try {
        return await cuerpo(api.get('/usuarios', { params: { documento: String(documento).trim() } }));
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
};

/**
 * `POST /api/usuarios/inquilinos`. La contraseña la genera ms-identidad.
 * @returns `{ contrasena_temporal, usuario: { id, email, rol } }`. La contraseña
 *   viaja en claro SÓLO en esta respuesta: se muestra una vez y se entrega en mano.
 */
export const crearInquilino = (datos) =>
    cuerpo(api.post('/usuarios/inquilinos', soloCampos(datos, CAMPOS_INQUILINO)));
