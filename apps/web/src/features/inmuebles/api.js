/**
 * MS-Inmuebles. Todo el recurso es del propietario (la matriz se lo niega al
 * inquilino).
 *
 * El cuerpo es el que acepta el endpoint, no el del Capítulo 2. El documento
 * lista `alias`, `ciudad` y `descripcion`, pero la tabla de ms-inmuebles tiene
 * `departamento`, `municipio`, `barrio` y la ficha física (`area_m2`,
 * `habitaciones`…); Sequelize descarta en silencio lo que no conoce, así que
 * mandar los nombres del documento guardaba un inmueble sin ubicación. La
 * divergencia está anotada en `packages/contracts/src/inmuebles.ts`.
 * `id_propietario` sale del token y `estado` lo mueven los eventos de contrato:
 * ninguno se envía.
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

export const obtenerInmueble = (id) => cuerpo(api.get(`/inmuebles/${id}`));

/** @returns `{ mensaje, inmueble }` */
export const crearInmueble = (datos) =>
    cuerpo(api.post('/inmuebles', conEnteros(soloCampos(datos, CAMPOS_INMUEBLE))));

/**
 * `PUT /api/inmuebles/:id`. A diferencia del alta, un campo opcional que el
 * formulario trae vacío se manda `null`: es alguien borrando el barrio, y
 * omitirlo lo dejaría como estaba. Los obligatorios nunca se vacían.
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

/**
 * `DELETE /api/inmuebles/:id`. Con un contrato activo el guardia del gateway
 * responde 409 —el inmueble no está en condiciones—, no 403.
 */
export const eliminarInmueble = (id) => cuerpo(api.delete(`/inmuebles/${id}`));
