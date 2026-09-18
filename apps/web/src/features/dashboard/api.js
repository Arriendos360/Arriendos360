/**
 * Dashboard: lo compone el gateway (regla dura 5), sólo para el propietario.
 *
 * Nada de `.catch(() => [])` aquí. Si un servicio no responde, el gateway da 502
 * a propósito: un «$0 en mora» sería creíble y falso. El error sube a la pantalla.
 *
 * Lo que devuelve cada ruta (apps/gateway/src/controllers/dashboard.controller.js):
 *
 * - `/resumen`: `{ ingresos_totales, contratos: { activos, finalizados },
 *   inmuebles: { disponibles, arrendados }, pagos_pendientes }`.
 *   `ingresos_totales` es la suma del `valor` de las cuentas `PAGADA`, y
 *   `pagos_pendientes` cuenta sólo `PENDIENTE`: las `PARCIAL` no entran.
 * - `/ingresos`: `{ total_ingresos, cantidad_pagos }`, las mismas cuentas `PAGADA`.
 * - `/mora`: `{ cantidad_en_mora, total_mora, detalle }`. OJO: además de las
 *   `EN_MORA` cuenta toda `PENDIENTE` o `PARCIAL` cuyo periodo ya empezó
 *   (`inicio < hoy`), así que incluye el cobro del mes en curso aunque no haya
 *   vencido. No es la mora de docs/adr/0018; la pantalla no la usa.
 * - `/contratos-activos`: `{ cantidad_activos, contratos }`, con su `Inmueble`.
 *
 * No hay ruta de ingresos por mes.
 */

import api from '../../services/api';
import { cuerpo } from '../comun';

export const obtenerResumen = () => cuerpo(api.get('/dashboard/resumen'));

export const obtenerIngresos = () => cuerpo(api.get('/dashboard/ingresos'));

export const obtenerMora = () => cuerpo(api.get('/dashboard/mora'));

export const obtenerContratosActivos = () => cuerpo(api.get('/dashboard/contratos-activos'));
