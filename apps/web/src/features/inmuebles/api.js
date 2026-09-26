/**
 * MS-Inmuebles, sólo para el propietario. El cuerpo usa los campos de la tabla
 * (`departamento`, `municipio`, `barrio`, ficha física). `id_propietario` y
 * `estado` no se envían.
 */

import api from '../../services/api';
import { cuerpo, soloCampos } from '../comun';

/** Obligatorios: la tabla los declara `NOT NULL`. */
const CAMPOS_OBLIGATORIOS = ['direccion', 'tipo'];

const CAMPOS_TEXTO = ['departamento', 'municipio', 'barrio'];

/** `INTEGER` en la tabla. */
export const CAMPOS_ENTEROS = ['habitaciones', 'banos', 'deposito', 'parqueaderos', 'estrato'];

/** `area_m2` es `NUMERIC(10,2)`: viaja como texto decimal, sin pasar por float. */
export const CAMPOS_INMUEBLE = [...CAMPOS_OBLIGATORIOS, ...CAMPOS_TEXTO, 'area_m2', ...CAMPOS_ENTEROS];

/** Los enteros del formulario llegan como texto; lo que no es entero se deja para que el servicio lo rechace. */
const conEnteros = (datos) =>
    Object.fromEntries(
        Object.entries(datos).map(([campo, valor]) =>
            CAMPOS_ENTEROS.includes(campo) && /^\d+$/.test(String(valor)) ? [campo, Number(valor)] : [campo, valor]
        )
    );

/** `GET /api/inmuebles`: los del propietario autenticado. */
export const listarInmuebles = () => cuerpo(api.get('/inmuebles'));

/** @returns `{ mensaje, inmueble }` */
export const crearInmueble = (datos) =>
    cuerpo(api.post('/inmuebles', conEnteros(soloCampos(datos, CAMPOS_INMUEBLE))));

/**
 * `PUT /api/inmuebles/:id`. Un opcional vacío se manda `null` para borrarlo; los
 * obligatorios nunca se vacían.
 *
 * @returns `{ mensaje, inmueble }`
 */
export const actualizarInmueble = (id, datos) => {
    const vaciados = CAMPOS_INMUEBLE.filter(
        (campo) => !CAMPOS_OBLIGATORIOS.includes(campo) && typeof datos?.[campo] === 'string' && datos[campo].trim() === ''
    );
    const cambios = {
        ...conEnteros(soloCampos(datos, CAMPOS_INMUEBLE)),
        ...Object.fromEntries(vaciados.map((campo) => [campo, null]))
    };
    return cuerpo(api.put(`/inmuebles/${id}`, cambios));
};

/** `DELETE /api/inmuebles/:id`. Con un contrato activo responde 409. */
export const eliminarInmueble = (id) => cuerpo(api.delete(`/inmuebles/${id}`));
