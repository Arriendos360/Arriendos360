/**
 * MS-Contratos: contratos, anexos y reemisión de la contraseña del inquilino.
 *
 * - El alta va en JSON.
 * - `inicio` y `fin` vuelven como instante a medianoche UTC: se leen con
 *   `fechaDeContrato`.
 * - `fecha_inicio_corte` y `fecha_limite_pago` son opcionales al crear: si no
 *   vienen, el servicio los deriva de `inicio`.
 * - `PUT /contratos/:id` no valida: el recorte de campos y la validación son de aquí.
 */

import api from '../../services/api';
import { descargarPdf } from '../../services/descargas';
import { cuerpo, montoParaEnviar, soloCampos } from '../comun';

/**
 * `inicio`/`fin` como día de calendario `YYYY-MM-DD`, tomando la fecha UTC tal
 * cual. `null` si no es una fecha.
 */
export const fechaDeContrato = (valor) => {
    const texto = typeof valor === 'string' ? valor : valor instanceof Date ? valor.toISOString() : '';
    return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null;
};

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
 * `fecha_limite_pago` es un día del mes (entero 1–31) y `canon` viaja como
 * número. Vacíos, se omiten.
 */
const normalizarContrato = (datos, campos) => {
    const limpio = soloCampos(datos, campos);
    if (limpio.fecha_limite_pago !== undefined) limpio.fecha_limite_pago = Number.parseInt(limpio.fecha_limite_pago, 10);
    if (limpio.canon !== undefined) limpio.canon = montoParaEnviar(limpio.canon);
    return limpio;
};

/**
 * `GET /api/contratos`: donde el usuario es propietario o inquilino. Cada
 * contrato llega con sus partes, o `null` en las que no se pudieron componer.
 */
export const listarContratos = () => cuerpo(api.get('/contratos'));

export const obtenerContrato = (id) => cuerpo(api.get(`/contratos/${id}`));

/** @returns `{ mensaje, contrato }` */
export const crearContrato = (datos) => cuerpo(api.post('/contratos', normalizarContrato(datos, CAMPOS_CONTRATO)));

/** Los opcionales de texto: vaciarlos al editar es borrarlos, y se manda `null`. */
const CAMPOS_CONTRATO_BORRABLES = ['info_contrato', 'nombre_deudor_solidario', 'documento_deudor_solidario'];

/** @returns `{ mensaje, contrato }` */
export const actualizarContrato = (id, datos) => {
    const vaciados = CAMPOS_CONTRATO_BORRABLES.filter(
        (campo) => typeof datos?.[campo] === 'string' && datos[campo].trim() === ''
    );
    return cuerpo(api.put(`/contratos/${id}`, {
        ...normalizarContrato(datos, CAMPOS_CONTRATO_EDITABLES),
        ...Object.fromEntries(vaciados.map((campo) => [campo, null]))
    }));
};

/**
 * `PUT /api/contratos/:id/finalizar`. El inmueble vuelve a `disponible` unos
 * segundos después: no afirmarlo en pantalla justo al volver.
 */
export const finalizarContrato = (id) => cuerpo(api.put(`/contratos/${id}/finalizar`));

/**
 * `POST /api/contratos/:id/contrasena-inquilino`.
 * @returns `{ mensaje, contrasena_temporal, inquilino }`: la contraseña sale en
 *   claro sólo aquí.
 */
export const reemitirContrasenaInquilino = (id) => cuerpo(api.post(`/contratos/${id}/contrasena-inquilino`));

// ── Anexos ────────────────────────────────────────────────────────────────

export const listarAnexos = (idContrato) => cuerpo(api.get(`/contratos/${idContrato}/anexos`));

/**
 * `POST /api/contratos/:id/anexos`, `multipart/form-data` con `file` (PDF) y
 * `tipo`. El `Content-Type` lo pone el navegador con su `boundary`; fijarlo a
 * mano lo rompe.
 * @returns `{ mensaje, anexo }`
 */
export const subirAnexo = (idContrato, { archivo, tipo }) => {
    const formulario = new FormData();
    formulario.append('file', archivo);
    formulario.append('tipo', String(tipo).trim());
    return cuerpo(api.post(`/contratos/${idContrato}/anexos`, formulario));
};

/** Descarga un anexo por la API autenticada, como blob. */
export const descargarAnexo = (idContrato, anexo) =>
    descargarPdf(`/contratos/${idContrato}/anexos/${anexo.id_anexo}`, `${anexo.tipo || 'anexo'}_${anexo.id_anexo}.pdf`);

export const eliminarAnexo = (idContrato, idAnexo) => cuerpo(api.delete(`/contratos/${idContrato}/anexos/${idAnexo}`));
