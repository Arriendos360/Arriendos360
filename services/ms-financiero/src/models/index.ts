/**
 * Punto unico de importacion de los modelos de MS-Financiero.
 *
 * Son DOS, y son todas las que el servicio tiene. Importar de aqui tiene ademas
 * un efecto secundario que importa: registra la asociacion entre ellas, que es
 * la unica del proyecto junto a la de anexos y la unica que no cruza frontera de
 * servicio.
 *
 * Lo que NO hay aqui es ningun modelo de contrato, inmueble o usuario. Todo eso
 * se pide por HTTP y se compone (`clientes/`, `services/composicion.ts`).
 */

import { CuentaCobro } from './CuentaCobro';
import { Transaccion } from './Transaccion';

export { CuentaCobro, Transaccion };
