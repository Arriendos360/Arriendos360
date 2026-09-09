/**
 * Composicion del `Inmueble` y el `Inquilino` sobre los contratos que salen por
 * `/api/contratos`.
 *
 * ── POR QUE ESTO VIVE EN EL SERVICIO Y NO EN EL GATEWAY ─────────────────────
 *
 * Es la pregunta que este archivo tiene que contestar, porque la respuesta
 * natural seria la contraria: componer es agregar, y las agregaciones se
 * resuelven en el gateway (regla dura 5).
 *
 * La razon es la costura. El gateway reenvia `/api/contratos` ENTERO a este
 * servicio y devuelve su respuesta tal cual — no la abre ni la reescribe, y
 * hacer que lo hiciera significaria meter logica de dominio en el proxy, que es
 * justo lo que la costura evita. Asi que quien sirve el endpoint es quien tiene
 * que devolverlo completo.
 *
 * La regla dura 5 sigue en pie donde importa: el DASHBOARD, que cruza tres
 * contextos y no es de nadie, se resuelve en el gateway. Esto es otra cosa —
 * un servicio rellenando su propia respuesta con dos datos ajenos.
 *
 * Y la direccion es la correcta: Contratos es Core, Inmuebles e Identidad son
 * Soporte. Core preguntando a Soporte.
 *
 * ── LA FORMA SE CONSERVA EXACTAMENTE ────────────────────────────────────────
 *
 * `contrato.Inmueble.direccion` y `contrato.Inquilino.nombres` son las rutas que
 * el frontend lee desde antes de que Inmuebles se extrajera, cuando las producia
 * un `include` de Sequelize. Han sobrevivido a dos extracciones sin cambiar, y
 * esa continuidad es deliberada: el frontend no tiene por que enterarse de donde
 * viven los datos.
 *
 * ── UN LOTE POR SERVICIO, NUNCA UNO POR FILA ────────────────────────────────
 *
 * Un listado de veinte contratos pediria cuarenta veces lo mismo si la consulta
 * fuera de una en una: el N+1 de siempre, pero con latencia de red. Se recogen
 * todos los identificadores y se hacen DOS peticiones, una a cada servicio.
 *
 * ── Y SI ALGUNO NO RESPONDE, LA PROPIEDAD QUEDA EN `null` ───────────────────
 *
 * Esto es DECORAR, no autorizar: la lista ya viene filtrada por pertenencia, y
 * esa parte si propaga el fallo (`services/pertenencia.ts`). Un contrato sin el
 * nombre del inquilino sigue siendo util; un 502 en el listado entero porque
 * ms-identidad tosio, no. Es la misma situacion que ya podia darse cuando el
 * `include` no encontraba fila, asi que el frontend ya la maneja — de ahi los
 * `contrato.Inmueble ? ... : contrato.id_inmueble` que tiene escritos.
 */

import { cabeceraDeServicio } from 'arriendos360-shared';

import type { InmuebleAjeno } from '../clientes/inmuebles';
import type { UsuarioAjeno } from '../clientes/identidad';
import { urlBase as urlIdentidad } from '../clientes/identidad';
import { urlBase as urlInmuebles } from '../clientes/inmuebles';
import type { Contrato } from '../models/Contrato';

const TIEMPO_LIMITE_MS = Number(process.env['COMPOSICION_TIMEOUT_MS'] ?? 3000);

/** Da al usuario del servicio la forma que tenia el modelo del monolito. */
const comoUsuario = (usuario: UsuarioAjeno | undefined): Record<string, unknown> | null =>
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

/**
 * GET a un `/interno` ajeno. DEGRADA: devuelve `null` si no se pudo.
 *
 * Aqui el fallo no se propaga nunca, a diferencia de `clientes/inmuebles.ts`.
 * Son dos usos del mismo servicio con dos politicas distintas, y la diferencia
 * es la de siempre: aquel autoriza, este decora.
 */
const pedirONada = async (url: string, destinatario: string): Promise<unknown> => {
  try {
    const respuesta = await fetch(url, {
      headers: cabeceraDeServicio({
        emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-contratos',
        destinatario,
        secreto: process.env['SERVICIO_JWT_SECRET'],
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });

    if (!respuesta.ok) {
      throw new Error(`${destinatario} respondió ${respuesta.status}`);
    }

    return await respuesta.json();
  } catch (error) {
    console.error(
      `⚠️  ms-contratos: no se pudo componer desde ${destinatario}:`,
      (error as Error).message,
    );
    return null;
  }
};

/** Inmuebles por id, en lote. Mapa vacio si no se pudo preguntar. */
const inmueblesPorIds = async (ids: string[]): Promise<Map<string, InmuebleAjeno>> => {
  const base = urlInmuebles();
  const unicos = [...new Set(ids.filter(Boolean))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  const datos = (await pedirONada(
    `${base}/interno/inmuebles?ids=${encodeURIComponent(unicos.join(','))}`,
    'ms-inmuebles',
  )) as { inmuebles?: InmuebleAjeno[] } | null;

  return new Map((datos?.inmuebles ?? []).map((i) => [i.id_inmueble, i]));
};

/** Usuarios por id, en lote. Mapa vacio si no se pudo preguntar. */
const usuariosPorIds = async (ids: string[]): Promise<Map<string, UsuarioAjeno>> => {
  const base = urlIdentidad();
  const unicos = [...new Set(ids.filter(Boolean))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  const datos = (await pedirONada(
    `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`,
    'ms-identidad',
  )) as { usuarios?: UsuarioAjeno[] } | null;

  return new Map((datos?.usuarios ?? []).map((u) => [u.id, u]));
};

/**
 * Adjunta `Inmueble` e `Inquilino` a una lista de contratos.
 *
 * Dos peticiones para la lista entera, y en PARALELO: no dependen entre si,
 * porque los dos identificadores estan en la fila del contrato. (En el gateway
 * `adjuntarPartes` si tiene que encadenarlas, porque necesita el propietario del
 * inmueble; aqui no hace falta.)
 */
export const adjuntarPartes = async (
  contratos: Contrato[],
): Promise<Array<Record<string, unknown>>> => {
  const lista = contratos.map((c) => c.toJSON() as Record<string, unknown>);

  const [inmuebles, usuarios] = await Promise.all([
    inmueblesPorIds(lista.map((c) => c['id_inmueble'] as string)),
    usuariosPorIds(lista.map((c) => c['id_inquilino'] as string)),
  ]);

  return lista.map((contrato) => ({
    ...contrato,
    Inmueble: inmuebles.get(contrato['id_inmueble'] as string) ?? null,
    Inquilino: comoUsuario(usuarios.get(contrato['id_inquilino'] as string)),
  }));
};

/** Adjunta `Inmueble` e `Inquilino` a un solo contrato. */
export const adjuntarPartesA = async (
  contrato: Contrato,
): Promise<Record<string, unknown>> => {
  const [conPartes] = await adjuntarPartes([contrato]);
  return conPartes as Record<string, unknown>;
};

/**
 * Adjunta SOLO el `Inmueble` a una lista de contratos.
 *
 * ── PARA QUIEN ES ESTO ──────────────────────────────────────────────────────
 *
 * Para `/interno/contratos?incluir=inmueble`, que llama ms-financiero desde el
 * paso 6e. Sus comprobantes imprimen la direccion del inmueble y su motor avisa
 * al propietario, y ninguna de las dos cosas esta en la fila del contrato.
 *
 * ── POR QUE LO RESUELVE ESTE SERVICIO Y NO EL QUE PREGUNTA ──────────────────
 *
 * Son DOS saltos encadenados: hasta que este servicio no dice de que inmueble es
 * cada contrato, nadie sabe que inmuebles pedir. Si los encadenara ms-financiero
 * serian dos viajes de red suyos; resueltos aqui es uno solo, y ademas ese
 * servicio no necesita enterarse de que un contrato tiene inmueble ni de donde
 * vive ese dato. Es la misma razon por la que la pertenencia se resuelve aqui y
 * no cruzando dos listas en el gateway (`docs/adr/0017`).
 *
 * ── UN LOTE, NUNCA UNO POR FILA ─────────────────────────────────────────────
 *
 * Una peticion a ms-inmuebles para la lista entera, sea de uno o de quinientos.
 * Es lo que sostiene la garantia de «un viaje por barrido» del motor de
 * Financiero, y lo que su prueba comprueba.
 *
 * ── NO ADJUNTA EL `Inquilino`, Y ESO ES LA MITAD DE LA GRACIA ───────────────
 *
 * `adjuntarPartes` haria las dos cosas en dos peticiones paralelas, pero quien
 * llama a `/interno` ya le pregunta a ms-identidad por su cuenta —necesita
 * ademas al propietario, que sale de este mismo inmueble— asi que mandarle el
 * inquilino desde aqui seria pedirlo dos veces.
 *
 * DEGRADA a `null`, como todo lo de este archivo: esto decora, no autoriza.
 */
export const adjuntarInmuebles = async (
  contratos: Contrato[],
): Promise<Array<Record<string, unknown>>> => {
  const lista = contratos.map((contrato) => contrato.toJSON() as Record<string, unknown>);

  const inmuebles = await inmueblesPorIds(lista.map((c) => c['id_inmueble'] as string));

  return lista.map((contrato) => ({
    ...contrato,
    Inmueble: inmuebles.get(contrato['id_inmueble'] as string) ?? null,
  }));
};
