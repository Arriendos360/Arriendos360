/**
 * Composicion de datos ajenos sobre las cuentas de cobro y las transacciones.
 *
 * Sustituye a los `include` que el gateway podia hacer mientras `cuentas_cobro`
 * vivia en su base. Aqui no queda ninguno que cruce frontera: una cuenta de
 * cobro cuelga de un contrato que esta en ms-contratos, y ese contrato de un
 * inmueble que esta en ms-inmuebles.
 *
 * La forma del resultado es exactamente la que producia Sequelize
 * —`cuenta.Contrato.Inmueble.direccion`, `contrato.Inquilino.nombres`— para que
 * ni el frontend ni los PDF noten la diferencia. Ha sobrevivido a tres
 * extracciones sin cambiar, y esa continuidad es deliberada.
 *
 * ── DOS VIAJES COMO MUCHO, Y NUNCA UNO POR FILA ─────────────────────────────
 *
 * Los dos saltos que hacen falta son a ms-contratos y a ms-identidad, y cada uno
 * se hace UNA vez para la coleccion entera. Lo que NO se hace es un tercero a
 * ms-inmuebles: el inmueble viene ya dentro del contrato porque se pide con
 * `incluir=inmueble`, y es ms-contratos quien lo resuelve en lote. Ver la
 * cabecera de `clientes/contratos.ts`.
 *
 * Desde el paso 7 los dos saltos son solo para los COMPROBANTES y los listados. El
 * motor no compone nada: avisa con eventos que llevan identificadores, asi que ya no
 * necesita direcciones de correo. Ver la nota al pie de este archivo.
 *
 * Componer dentro de un bucle seria cambiar un JOIN por N llamadas de red, que
 * es peor que el problema que se estaba resolviendo.
 *
 * ── Y SI ALGUNO NO RESPONDE, LA PROPIEDAD QUEDA EN `null` ───────────────────
 *
 * Todo lo de este archivo DECORA, no autoriza: la lista ya se filtro antes con
 * los contratos de quien pregunta, y esa parte si propaga el fallo
 * (`clientes/contratos.ts`). Un listado sin la direccion del inmueble sigue
 * siendo util; un 502 en la pantalla entera porque ms-inmuebles tosio, no. Es la
 * misma situacion que ya podia darse cuando el `include` no encontraba fila, asi
 * que los consumidores ya la manejan.
 */

import { porIds as contratosPorIds } from '../clientes/contratos';
import type { ContratoAjeno } from '../clientes/contratos';
import { usuariosPorIds } from '../clientes/identidad';
import type { UsuarioAjeno } from '../clientes/identidad';

/** Da al usuario del servicio la forma que tenia el modelo del monolito. */
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

  // UNA peticion, y el inmueble viene dentro: ms-contratos lo resuelve en lote.
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

/**
 * Adjunta `Inquilino` a un contrato ya compuesto, para el bloque del
 * arrendatario de los PDF.
 *
 * Un solo contrato, asi que un solo usuario: es el unico sitio del servicio
 * donde pedir de uno en uno es correcto, porque el PDF es de uno en uno.
 */
export const adjuntarInquilino = async (
  contrato: ContratoAjeno | null,
): Promise<Record<string, unknown> | null> => {
  if (!contrato) {
    return null;
  }

  const usuarios = await usuariosPorIds([contrato.id_inquilino]);

  return { ...contrato, Inquilino: comoUsuario(usuarios.get(contrato.id_inquilino)) };
};

/**
 * ── `adjuntarPartes` SE FUE EN EL PASO 7 ──────────────────────────────────
 *
 * Componia `Inquilino` y `Inmueble.Propietario` sobre una lista de contratos, y su
 * unico llamante era el motor: los necesitaba para sacar las direcciones de correo a
 * las que avisaba.
 *
 * El motor ya no manda correos. Anota eventos con el `id_usuario` de cada parte —que
 * ya viene en el contrato— y quien resuelve las direcciones es ms-notificaciones, en
 * el momento de manejar el evento, que es el unico en que la respuesta es actual.
 * Asi que la funcion se queda sin llamantes y se borra en vez de quedarse
 * «por si acaso».
 *
 * Lo que SI sobrevive es `adjuntarInquilino`, justo arriba: los comprobantes en PDF
 * imprimen el nombre del arrendatario, y eso no es una notificacion.
 */
