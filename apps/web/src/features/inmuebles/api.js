/**
 * MS-Inmuebles. Todo el recurso es del propietario (la matriz se lo niega al
 * inquilino).
 *
 * El cuerpo es el del Capítulo 2 y nada más: `alias`, `direccion`, `ciudad`,
 * `tipo`, `descripcion`. El formulario viejo mandaba `departamento`, `municipio`,
 * `barrio`, `area_m2`, `precio`…, columnas que ya no existen. `id_propietario` sale
 * del token y `estado` lo mueven los eventos de contrato: ninguno se envía.
 */

import api from '../../services/api';
import { cuerpo, soloCampos } from '../comun';

export const CAMPOS_INMUEBLE = ['alias', 'direccion', 'ciudad', 'tipo', 'descripcion'];

/** `GET /api/inmuebles`: los del propietario autenticado. */
export const listarInmuebles = () => cuerpo(api.get('/inmuebles'));

export const obtenerInmueble = (id) => cuerpo(api.get(`/inmuebles/${id}`));

/** @returns `{ mensaje, inmueble }` */
export const crearInmueble = (datos) => cuerpo(api.post('/inmuebles', soloCampos(datos, CAMPOS_INMUEBLE)));

/** @returns `{ mensaje, inmueble }` */
export const actualizarInmueble = (id, datos) =>
    cuerpo(api.put(`/inmuebles/${id}`, soloCampos(datos, CAMPOS_INMUEBLE)));

/**
 * `DELETE /api/inmuebles/:id`. Con un contrato activo el guardia del gateway
 * responde 409 —el inmueble no está en condiciones—, no 403.
 */
export const eliminarInmueble = (id) => cuerpo(api.delete(`/inmuebles/${id}`));
