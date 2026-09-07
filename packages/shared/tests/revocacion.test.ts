/**
 * La cache de invalidacion, probada como pieza suelta.
 *
 * Lo que se cubre aqui es SOLO lo que no se puede ver desde un servicio: el
 * ciclo de vida del temporizador. La semantica de que invalida que —el `jti`
 * revocado, la marca de cambio de contrasena, la ventana de refresco— se prueba
 * en `services/ms-inmuebles/tests/revocacion.test.ts`, contra el cliente real y
 * un doble HTTP, que es donde de verdad significa algo. Repetirla aqui seria
 * duplicacion mecanica.
 */

import { crearCacheInvalidacion, INTERVALO_POR_DEFECTO_MS } from '../src/revocacion';
import type { Invalidaciones } from '../src/revocacion';

const silencio = () => {};

describe('Ciclo de vida del temporizador', () => {
  test('`iniciar` hace una primera carga inmediata', async () => {
    let llamadas = 0;
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => {
        llamadas += 1;
        return { revocados: [{ jti: 'a' }], sesiones: [] };
      },
      intervaloMs: 3_600_000,
      registrar: silencio,
    });

    // Sin la carga inmediata, el servicio arrancaria con la copia vacia y
    // dejaria pasar tokens revocados durante el primer intervalo entero.
    expect(llamadas).toBe(0);
    await cache.iniciar();
    expect(llamadas).toBe(1);
    expect(cache.estado().vigentes).toBe(1);

    cache.detener();
  });

  test('`detener` corta el refresco periódico', async () => {
    let llamadas = 0;
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => {
        llamadas += 1;
        return {};
      },
      intervaloMs: 10,
      registrar: silencio,
    });

    await cache.iniciar();
    const trasIniciar = llamadas;

    cache.detener();
    await new Promise((r) => setTimeout(r, 60));

    expect(llamadas).toBe(trasIniciar);
  });

  // El `unref()` del temporizador no tiene prueba propia a proposito: lo que
  // comprueba es que el proceso pueda salir, y eso no se puede afirmar desde
  // dentro del mismo proceso sin montar un subproceso entero. Lo verifica esta
  // suite por omision — corre sin `--forceExit`, asi que si el temporizador
  // retuviera el bucle de eventos, jest colgaria aqui.

  test('`detener` dos veces no falla', () => {
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => ({}),
      registrar: silencio,
    });

    expect(() => {
      cache.detener();
      cache.detener();
    }).not.toThrow();
  });

  test('El intervalo por defecto es el del ADR 0008', () => {
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => ({}),
      registrar: silencio,
    });

    expect(cache.estado().intervaloMs).toBe(INTERVALO_POR_DEFECTO_MS);
    expect(INTERVALO_POR_DEFECTO_MS).toBe(15000);
  });
});

describe('Estado observable', () => {
  test('Arranca vacío y sin historia', () => {
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => ({}),
      registrar: silencio,
    });

    expect(cache.estado()).toMatchObject({
      vigentes: 0,
      sesionesInvalidadas: 0,
      ultimoExito: null,
      ultimoError: null,
    });
  });

  test('Un refresco con éxito borra el error anterior', async () => {
    let debeFallar = true;
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => {
        if (debeFallar) {
          throw new Error('sin red');
        }
        return { revocados: [{ jti: 'a' }], sesiones: [] };
      },
      registrar: silencio,
    });

    expect(await cache.refrescar()).toBe(false);
    expect(cache.estado().ultimoError).toBe('sin red');
    expect(cache.estado().ultimoExito).toBeNull();

    debeFallar = false;
    expect(await cache.refrescar()).toBe(true);
    expect(cache.estado().ultimoError).toBeNull();
    expect(cache.estado().ultimoExito).toBeInstanceOf(Date);
  });

  test('Una respuesta sin campos no rompe: se interpreta como «nada que invalidar»', async () => {
    const cache = crearCacheInvalidacion({
      obtener: async (): Promise<Invalidaciones> => ({}),
      registrar: silencio,
    });

    expect(await cache.refrescar()).toBe(true);
    expect(cache.estado().vigentes).toBe(0);
  });
});
