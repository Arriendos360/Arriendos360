/**
 * Composición de `Contrato` (con su `Inmueble`) e `Inquilino` sobre cuentas de
 * cobro y transacciones, con una petición por servicio para toda la lista. Si un
 * servicio no responde, la propiedad queda en `null`: esto decora, no autoriza.
 */

import { porIds as contratosPorIds } from '../clientes/contratos';
import type { ContratoAjeno } from '../clientes/contratos';
import { usuariosPorIds } from '../clientes/identidad';
import type { UsuarioAjeno } from '../clientes/identidad';

/** Da al usuario la forma de `Inquilino` que leen el frontend y los PDF. */
export const comoUsuario = (
  usuario: UsuarioAjeno | undefined,
): Record<string, unknown> | null =>
  usuario
    ? {
        id_usuario: usuario.id,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        documento: usuario.documento,
        telefono: usuario.telefono,
        email: usuario.email,
      }
    : null;

/** Convierte una instancia de Sequelize en objeto plano, o la deja pasar. */
const aPlano = (entidad: unknown): Record<string, unknown> => {
  const posible = entidad as { toJSON?: () => Record<string, unknown> };
  return typeof posible?.toJSON === 'function'
    ? posible.toJSON()
    : (entidad as Record<string, unknown>);
};

/**
 * Adjunta el `Contrato` —y dentro de el su `Inmueble`— a una lista de cuentas de
 * cobro o de transacciones.
 *
 * @param elementos cuentas de cobro o transacciones
 * @param contenedor donde colgar el `Contrato`: el propio elemento, o su
 *   `CuentaCobro` si va un nivel abajo
 */
export const adjuntarContratoConInmueble = async (
  elementos: unknown[],
  contenedor: (elemento: Record<string, unknown>) => Record<string, unknown> | null | undefined,
): Promise<Array<Record<string, unknown>>> => {
  const lista = (elementos ?? []).map(aPlano);
  const destinos = lista
    .map((elemento) => contenedor(elemento))
    .filter(Boolean) as Array<Record<string, unknown>>;

  // Una petición, con el inmueble dentro.
  const contratos = await contratosPorIds(
    destinos.map((destino) => destino['id_contrato'] as string),
    { conInmueble: true },
  );

  for (const elemento of lista) {
    const destino = contenedor(elemento);
    if (!destino) {
      continue;
    }

    destino['Contrato'] = contratos.get(destino['id_contrato'] as string) ?? null;
  }

  return lista;
};

/** `cuenta.Contrato.Inmueble`. */
export const adjuntarContratoACuentas = (
  cuentas: unknown[],
): Promise<Array<Record<string, unknown>>> =>
  adjuntarContratoConInmueble(cuentas, (cuenta) => cuenta);

/** `transaccion.CuentaCobro.Contrato.Inmueble`. */
export const adjuntarContratoATransacciones = (
  transacciones: unknown[],
): Promise<Array<Record<string, unknown>>> =>
  adjuntarContratoConInmueble(
    transacciones,
    (transaccion) => transaccion['CuentaCobro'] as Record<string, unknown> | null,
  );

/** Adjunta `Inquilino` a un contrato, para el bloque del arrendatario de los PDF. */
export const adjuntarInquilino = async (
  contrato: ContratoAjeno | null,
): Promise<Record<string, unknown> | null> => {
  if (!contrato) {
    return null;
  }

  const usuarios = await usuariosPorIds([contrato.id_inquilino]);

  return { ...contrato, Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino)) };
};
