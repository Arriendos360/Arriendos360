/**
 * MS-Contratos: contratos, anexos y reemisión de la contraseña del inquilino.
 *
 * El alta va en JSON, como fija el Capítulo 2. El formulario viejo la mandaba
 * como `multipart/form-data`, y ms-contratos sólo lee JSON en esa ruta (multer
 * sólo está en la de anexos): llegaba un cuerpo vacío.
 */

import api from '../../services/api';
import { abrirPdf, descargarPdf } from '../../services/descargas';
import { cuerpo, montoParaEnviar, soloCampos } from '../comun';

export const CAMPOS_CONTRATO = [
    'id_inmueble',
    'id_inquilino',
    'inicio',
    'fin',
    'fecha_inicio_corte',
    'fecha_limite_pago',
    'canon',
    'info_contrato',
    'nombre_deudor_solidario',
    'documento_deudor_solidario'
];

/** Lo que se puede cambiar de un contrato firmado: nunca sus partes ni su estado. */
export const CAMPOS_CONTRATO_EDITABLES = [
    'fin',
    'fecha_limite_pago',
    'canon',
    'info_contrato',
    'nombre_deudor_solidario',
    'documento_deudor_solidario'
];

/**
 * `fecha_limite_pago` es un DÍA DEL MES (entero 1–31), no una fecha, y `canon`
 * viaja como número. Vacíos, se omiten: el servicio deriva el día límite y el
 * corte de la fecha de inicio.
 */
const normalizarContrato = (datos, campos) => {
    const limpio = soloCampos(datos, campos);
    if (limpio.fecha_limite_pago !== undefined) limpio.fecha_limite_pago = Number.parseInt(limpio.fecha_limite_pago, 10);
    if (limpio.canon !== undefined) limpio.canon = montoParaEnviar(limpio.canon);
    return limpio;
};

/**
 * `GET /api/contratos`: donde el usuario es parte, como propietario o como
 * inquilino. Cada contrato llega decorado con sus partes; lo que no se pudo
 * decorar llega `null` y se pinta «—», no se inventa.
 */
export const listarContratos = () => cuerpo(api.get('/contratos'));

export const obtenerContrato = (id) => cuerpo(api.get(`/contratos/${id}`));

/** @returns `{ mensaje, contrato }` */
export const crearContrato = (datos) => cuerpo(api.post('/contratos', normalizarContrato(datos, CAMPOS_CONTRATO)));

/** @returns `{ mensaje, contrato }` */
export const actualizarContrato = (id, datos) =>
    cuerpo(api.put(`/contratos/${id}`, normalizarContrato(datos, CAMPOS_CONTRATO_EDITABLES)));

/**
 * `PUT /api/contratos/:id/finalizar`. El inmueble vuelve a `disponible` cuando
 * ms-inmuebles consume el evento, unos segundos después: no afirmarlo en la
 * pantalla justo al volver (regla dura 9).
 */
export const finalizarContrato = (id) => cuerpo(api.put(`/contratos/${id}/finalizar`));

/**
 * `POST /api/contratos/:id/contrasena-inquilino` (docs/adr/0007).
 * @returns `{ mensaje, contrasena_temporal, inquilino }`: la contraseña sale en
 *   claro sólo aquí.
 */
export const reemitirContrasenaInquilino = (id) => cuerpo(api.post(`/contratos/${id}/contrasena-inquilino`));

// ── Anexos ────────────────────────────────────────────────────────────────

export const listarAnexos = (idContrato) => cuerpo(api.get(`/contratos/${idContrato}/anexos`));

/**
 * `POST /api/contratos/:id/anexos`, `multipart/form-data` con `file` (PDF) y
 * `tipo`. El tipo es un catálogo abierto (`TIPOS_ANEXO_CONOCIDOS` sólo sugiere).
 * El `Content-Type` lo pone el navegador con su `boundary`; fijarlo a mano lo rompe.
 * @returns `{ mensaje, anexo }`
 */
export const subirAnexo = (idContrato, { archivo, tipo }) => {
    const formulario = new FormData();
    formulario.append('file', archivo);
    formulario.append('tipo', String(tipo).trim());
    return cuerpo(api.post(`/contratos/${idContrato}/anexos`, formulario));
};

/** Los anexos sólo salen por la API autenticada, como blob (docs/adr/0014). */
export const descargarAnexo = (idContrato, anexo) =>
    descargarPdf(`/contratos/${idContrato}/anexos/${anexo.id_anexo}`, `${anexo.tipo || 'anexo'}_${anexo.id_anexo}.pdf`);

export const abrirAnexo = (idContrato, anexo) =>
    abrirPdf(`/contratos/${idContrato}/anexos/${anexo.id_anexo}`, `${anexo.tipo || 'anexo'}_${anexo.id_anexo}.pdf`);

export const eliminarAnexo = (idContrato, idAnexo) => cuerpo(api.delete(`/contratos/${idContrato}/anexos/${idAnexo}`));
