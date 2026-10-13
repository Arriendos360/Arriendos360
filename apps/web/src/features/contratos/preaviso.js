/** Preaviso de no renovar el contrato: lo que la pantalla muestra de `preaviso`. */

import { CAUSALES_PREAVISO_ARRENDADOR } from 'arriendos360-contracts';

import { formatearFecha, formatearFechaHora } from '../../ui/formato';

const PARTE = { PROPIETARIO: 'el arrendador', INQUILINO: 'el arrendatario' };

/** Lo que exige la ley, en la tarjeta y en el diálogo de envío. */
export const AVISO_SERVICIO_POSTAL =
    'La ley exige enviar el preaviso por escrito y por correo certificado: registrarlo aquí y el correo electrónico no lo reemplazan. Descarga la carta, fírmala y envíala.';

const estadoDe = (preaviso, limite, vencimiento) => {
    if (preaviso.vencido) return `Venció el ${vencimiento} con preaviso: falta finalizar el contrato.`;
    if (preaviso.enviado) {
        return `Preaviso enviado por ${PARTE[preaviso.enviado.parte]} el ${formatearFechaHora(preaviso.enviado.enviado_en)}.`;
    }
    if (preaviso.en_ventana) return `Si no quieres renovar, envía el preaviso a más tardar el ${limite}.`;
    if (preaviso.dentro_de_plazo) return `Puedes enviar el preaviso hasta el ${limite}.`;
    return `Pasó la fecha límite del preaviso: sin él, el contrato se prorroga al vencer el ${vencimiento}.`;
};

/** `null` si el contrato no trae `preaviso` (no está activo). */
export const resumenDePreaviso = (preaviso) => {
    if (!preaviso) return null;

    const vencimiento = formatearFecha(preaviso.vencimiento);
    const limite = formatearFecha(preaviso.fecha_limite);
    return {
        vencimiento,
        limite,
        destacarLimite: preaviso.en_ventana && !preaviso.enviado,
        puedeEnviar: preaviso.dentro_de_plazo && !preaviso.enviado,
        enviado: Boolean(preaviso.enviado),
        estado: estadoDe(preaviso, limite, vencimiento),
        // Sólo el propietario las recibe.
        causales: (preaviso.causales_disponibles ?? []).map((valor) => ({
            valor,
            texto: CAUSALES_PREAVISO_ARRENDADOR[valor]
        }))
    };
};
