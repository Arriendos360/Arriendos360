/**
 * Dashboard: lo compone el gateway (regla dura 5), sólo para el propietario.
 *
 * Nada de `.catch(() => [])` aquí. Si Financiero no responde, el gateway da 502 a
 * propósito: un «$0 en mora» sería creíble y falso. El error sube a la pantalla.
 */

import api from '../../services/api';
import { cuerpo } from '../comun';

export const obtenerResumen = () => cuerpo(api.get('/dashboard/resumen'));

export const obtenerIngresos = () => cuerpo(api.get('/dashboard/ingresos'));

export const obtenerMora = () => cuerpo(api.get('/dashboard/mora'));

export const obtenerContratosActivos = () => cuerpo(api.get('/dashboard/contratos-activos'));
