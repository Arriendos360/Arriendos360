/**
 * MS-Identidad: personas, desde el lado del propietario que va a firmar un
 * contrato. `Contratos.id_inquilino` es un UUID que nadie teclea, así que antes de
 * firmar se traduce la cédula al usuario, o se da de alta al inquilino.
 */

import api from '../../services/api';
import { cuerpo, soloCampos } from '../comun';

/** Campos del alta de inquilino: los del registro sin `contrasena` (docs/adr/0007). */
export const CAMPOS_INQUILINO = ['nombres', 'apellidos', 'email', 'telefono', 'documento'];

/**
 * `GET /api/usuarios?documento=`.
 * @returns `{ id, nombres, apellidos }`, o `null` si nadie tiene ese documento.
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
