/**
 * Punto unico de importacion de los modelos de MS-Contratos.
 *
 * Son dos, y las dos viven en el esquema `contratos`. No hay ningun modelo de
 * inmuebles ni de usuarios: lo que este servicio necesita de ellos lo pide por
 * HTTP (`src/clientes/`).
 */

export { Anexo } from './Anexo';
export { Contrato } from './Contrato';
