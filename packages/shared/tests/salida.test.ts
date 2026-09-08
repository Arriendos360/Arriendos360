/**
 * El publicador: reintentos, orden y veneno.
 *
 * Contra un almacen EN MEMORIA, no contra PostgreSQL. La implementacion SQL se
 * ejercita en las suites del gateway y de ms-inmuebles, que si tienen base; lo
 * que se prueba aqui son las decisiones del publicador —cuando reintentar,
 * cuando esperar, cuando frenar a los que van detras, cuando rendirse— y esas
 * no dependen de donde estén guardadas las filas. Es el mismo reparto que ya
 * hace `revocacion.test.ts` con su `obtener`.
 */

import {
  type AlmacenSalida,
  type FilaSalida,
  SALIDA_APARTADO,
  SALIDA_ENTREGADO,
  SALIDA_PENDIENTE,
  crearPublicador,
} from '../src/salida';
import { TIPO_CONTRATO_FINALIZADO, TIPO_CONTRATO_FORMALIZADO } from '../src/eventos';

interface FilaMemoria extends FilaSalida {
  estado: string;
  ultimo_error: string | null;
}

/** Un almacen de mentira con la misma semantica que el SQL. */
const almacenEnMemoria = (): AlmacenSalida & { filas: FilaMemoria[] } => {
  const filas: FilaMemoria[] = [];
  const buscar = (id: string): FilaMemoria | undefined =>
    filas.find((fila) => fila.id_evento === id);

  return {
    filas,
    async registrar(sobre, opciones = {}) {
      filas.push({
        id_evento: sobre.id_evento,
        tipo: sobre.tipo,
        version: sobre.version,
        ocurrido_en: new Date(sobre.ocurrido_en),
        payload: sobre.payload,
        clave_orden: opciones.claveOrden ?? null,
        intentos: 0,
        proximo_intento_en: new Date(0),
        estado: SALIDA_PENDIENTE,
        ultimo_error: null,
      });
    },
    async pendientes(limite) {
      return filas.filter((fila) => fila.estado === SALIDA_PENDIENTE).slice(0, limite);
    },
    async marcarEntregado(id) {
      const fila = buscar(id);
      if (fila) {
        fila.estado = SALIDA_ENTREGADO;
        fila.intentos += 1;
      }
    },
    async marcarFallo(id, error, proximo) {
      const fila = buscar(id);
      if (fila) {
        fila.intentos += 1;
        fila.ultimo_error = error;
        fila.proximo_intento_en = proximo;
      }
    },
    async apartar(id, error) {
      const fila = buscar(id);
      if (fila) {
        fila.estado = SALIDA_APARTADO;
        fila.intentos += 1;
        fila.ultimo_error = error;
      }
    },
    async reencolar(id) {
      const fila = buscar(id);
      if (fila) {
        fila.estado = SALIDA_PENDIENTE;
        fila.intentos = 0;
        fila.proximo_intento_en = new Date(0);
        fila.ultimo_error = null;
      }
    },
    async contar() {
      return {
        pendientes: filas.filter((f) => f.estado === SALIDA_PENDIENTE).length,
        apartados: filas.filter((f) => f.estado === SALIDA_APARTADO).length,
      };
    },
  };
};

const sobreDe = (id: string, tipo: string, payload: unknown = {}) => ({
  id_evento: id,
  tipo,
  version: 1,
  ocurrido_en: new Date().toISOString(),
  payload,
});

describe('Un evento que no se pudo entregar sobrevive y se reintenta', () => {
  test('la fila sigue pendiente tras un fallo, y sale en el ciclo siguiente', async () => {
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('e1', TIPO_CONTRATO_FORMALIZADO) as never);

    let caido = true;
    const entregados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      registrar: () => {},
      entregar: async (sobre) => {
        if (caido) {
          throw new Error('ms-inmuebles no responde');
        }
        entregados.push(sobre.id_evento);
      },
    });

    const primero = await publicador.ciclo();
    expect(primero.fallidos).toBe(1);
    expect(entregados).toEqual([]);

    // Lo que importa: el evento NO se perdio. Estaba en disco antes de que
    // nadie intentara entregarlo, asi que un fallo de red solo lo retrasa.
    expect(almacen.filas[0]?.estado).toBe(SALIDA_PENDIENTE);
    expect(almacen.filas[0]?.ultimo_error).toContain('no responde');

    caido = false;
    const segundo = await publicador.ciclo();

    expect(segundo.entregados).toBe(1);
    expect(entregados).toEqual(['e1']);
    expect(almacen.filas[0]?.estado).toBe(SALIDA_ENTREGADO);
  });

  test('la espera crece y el evento no se toca antes de que venza', async () => {
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('e1', TIPO_CONTRATO_FORMALIZADO) as never);

    let momento = new Date('2026-01-01T00:00:00Z');
    let intentos = 0;

    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 1000,
      registrar: () => {},
      ahora: () => momento,
      entregar: async () => {
        intentos += 1;
        throw new Error('caido');
      },
    });

    await publicador.ciclo();
    expect(intentos).toBe(1);

    // Mismo instante: la espera no ha vencido, asi que no se vuelve a intentar.
    const aplazado = await publicador.ciclo();
    expect(intentos).toBe(1);
    expect(aplazado.aplazados).toBe(1);

    // Pasado el segundo de espera, si.
    momento = new Date('2026-01-01T00:00:02Z');
    await publicador.ciclo();
    expect(intentos).toBe(2);
  });
});

describe('Un evento envenenado no bloquea la cola ni se reintenta para siempre', () => {
  test('tras el limite de intentos queda apartado, con su error a la vista', async () => {
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('malo', TIPO_CONTRATO_FORMALIZADO) as never);

    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      maxIntentos: 3,
      registrar: () => {},
      entregar: async () => {
        throw new Error('el consumidor lo rechaza siempre');
      },
    });

    await publicador.ciclo();
    await publicador.ciclo();
    const tercero = await publicador.ciclo();

    expect(tercero.apartados).toBe(1);
    expect(almacen.filas[0]?.estado).toBe(SALIDA_APARTADO);
    expect(almacen.filas[0]?.ultimo_error).toContain('rechaza siempre');
    expect(almacen.filas[0]?.intentos).toBe(3);

    // Y deja de intentarse: un ciclo mas no lo toca.
    const despues = await publicador.ciclo();
    expect(despues).toEqual({ entregados: 0, fallidos: 0, apartados: 0, aplazados: 0 });
  });

  test('se aparta, no se borra: el hecho ocurrio y queda constancia', async () => {
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('malo', TIPO_CONTRATO_FORMALIZADO) as never);

    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      maxIntentos: 1,
      registrar: () => {},
      entregar: async () => {
        throw new Error('veneno');
      },
    });

    await publicador.ciclo();
    expect(almacen.filas).toHaveLength(1);

    // Y hay vuelta atras cuando se arregla la causa.
    await almacen.reencolar('malo');
    expect(almacen.filas[0]?.estado).toBe(SALIDA_PENDIENTE);
  });

  test('un evento atascado no frena a los de OTRA clave de orden', async () => {
    // Es la mitad de «no bloquea la cola» que de verdad importa: el inmueble A
    // tiene un problema y los contratos del inmueble B no tienen por que
    // enterarse.
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('a1', TIPO_CONTRATO_FORMALIZADO) as never, {
      claveOrden: 'inmueble-A',
    });
    await almacen.registrar(sobreDe('b1', TIPO_CONTRATO_FORMALIZADO) as never, {
      claveOrden: 'inmueble-B',
    });

    const entregados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      registrar: () => {},
      entregar: async (sobre) => {
        if (sobre.id_evento === 'a1') {
          throw new Error('atascado');
        }
        entregados.push(sobre.id_evento);
      },
    });

    const resultado = await publicador.ciclo();

    expect(resultado.fallidos).toBe(1);
    expect(resultado.entregados).toBe(1);
    expect(entregados).toEqual(['b1']);
  });
});

describe('Orden por clave', () => {
  test('un evento espera a que salga el anterior de su mismo inmueble', async () => {
    // El caso concreto que obliga a esto: si `Finalizado` adelantara a
    // `Formalizado`, el inmueble quedaria arrendado para siempre — primero se
    // liberaria (sobre un inmueble que aun estaba libre) y despues se ocuparia.
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('formalizado', TIPO_CONTRATO_FORMALIZADO) as never, {
      claveOrden: 'inmueble-A',
    });
    await almacen.registrar(sobreDe('finalizado', TIPO_CONTRATO_FINALIZADO) as never, {
      claveOrden: 'inmueble-A',
    });

    let caido = true;
    const entregados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      registrar: () => {},
      entregar: async (sobre) => {
        if (caido) {
          throw new Error('caido');
        }
        entregados.push(sobre.id_evento);
      },
    });

    // El primero falla; el segundo NI SE INTENTA, porque comparten clave.
    const bloqueado = await publicador.ciclo();
    expect(bloqueado.fallidos).toBe(1);
    expect(bloqueado.aplazados).toBe(1);

    caido = false;
    await publicador.ciclo();

    expect(entregados).toEqual(['formalizado', 'finalizado']);
  });

  test('sin clave de orden, cada evento va por su cuenta', async () => {
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('uno', TIPO_CONTRATO_FORMALIZADO) as never);
    await almacen.registrar(sobreDe('dos', TIPO_CONTRATO_FORMALIZADO) as never);

    const entregados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      registrar: () => {},
      entregar: async (sobre) => {
        if (sobre.id_evento === 'uno') {
          throw new Error('caido');
        }
        entregados.push(sobre.id_evento);
      },
    });

    await publicador.ciclo();
    expect(entregados).toEqual(['dos']);
  });

  test('apartar un evento tambien desbloquea su clave', async () => {
    // Es la consecuencia menos obvia del apartado y conviene tenerla escrita:
    // el consumidor puede acabar viendo un evento sin su predecesor. Se acepta
    // porque la alternativa —una clave bloqueada para siempre— es peor, y por
    // eso apartar deja rastro tan visible.
    const almacen = almacenEnMemoria();
    await almacen.registrar(sobreDe('primero', TIPO_CONTRATO_FORMALIZADO) as never, {
      claveOrden: 'inmueble-A',
    });
    await almacen.registrar(sobreDe('segundo', TIPO_CONTRATO_FINALIZADO) as never, {
      claveOrden: 'inmueble-A',
    });

    const entregados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      esperaBaseMs: 0,
      maxIntentos: 1,
      registrar: () => {},
      entregar: async (sobre) => {
        if (sobre.id_evento === 'primero') {
          throw new Error('veneno');
        }
        entregados.push(sobre.id_evento);
      },
    });

    const resultado = await publicador.ciclo();

    expect(resultado.apartados).toBe(1);
    expect(entregados).toEqual(['segundo']);
  });
});

describe('El publicador no tumba el proceso cuando la base falla', () => {
  test('un error al leer la tabla se registra y el ciclo devuelve ceros', async () => {
    const almacen = almacenEnMemoria();
    almacen.pendientes = async () => {
      throw new Error('conexión perdida');
    };

    const registrados: string[] = [];
    const publicador = crearPublicador({
      almacen,
      entregar: async () => undefined,
      registrar: (mensaje) => registrados.push(mensaje),
    });

    const resultado = await publicador.ciclo();

    expect(resultado.entregados).toBe(0);
    expect(registrados[0]).toContain('conexión perdida');
  });

  test('el temporizador no mantiene vivo el proceso', async () => {
    const almacen = almacenEnMemoria();
    const publicador = crearPublicador({ almacen, entregar: async () => undefined });

    const temporizador = await publicador.iniciar();
    expect(temporizador.hasRef()).toBe(false);

    publicador.detener();
  });
});
