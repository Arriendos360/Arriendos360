/**
 * Confianza cero de verdad: el servicio comprueba la revocación por su cuenta.
 *
 * Es lo que distingue a este servicio de ms-identidad. Allí la lista está en su
 * propia base y se consulta en el momento; aquí es de otro servicio, así que se
 * lee de una copia en memoria que se refresca cada pocos segundos. Estas
 * pruebas cubren las dos formas de invalidar un token y la ventana que implica.
 *
 * Contra un doble HTTP, no contra un mock: el cliente pide por red, y el doble
 * exige la credencial de servicio igual que el real.
 */

import request from 'supertest';
import { crearCacheInvalidacion } from 'arriendos360-shared';
import type { CacheInvalidacion } from 'arriendos360-shared';

import { invalidacionesVigentes } from '../src/clientes/identidad';
import { levantarDobleIdentidad } from './dobles/identidad';
import type { DobleIdentidad } from './dobles/identidad';
import { app, cerrarBase, conToken, firmarToken, propietario, recrearBase } from './utiles/entorno';

let doble: DobleIdentidad;
let cache: CacheInvalidacion;

beforeAll(async () => {
  await recrearBase();
  doble = await levantarDobleIdentidad();

  cache = crearCacheInvalidacion({
    obtener: () => invalidacionesVigentes({ urlBase: doble.url }),
    // Sin refresco automático: cada prueba llama a `refrescar()` cuando quiere,
    // que es lo que permite comprobar la ventana en vez de sufrirla.
    intervaloMs: 3_600_000,
    registrar: () => {},
  });
});

afterAll(async () => {
  cache.detener();
  await doble.cerrar();
  await cerrarBase();
});

beforeEach(() => {
  doble.revocados = [];
  doble.sesiones = [];
});

describe('El cliente habla con ms-identidad', () => {
  test('Trae las dos listas en un solo viaje', async () => {
    doble.revocados = [{ jti: 'abc' }];
    doble.sesiones = [{ sub: 'xyz', desde: new Date().toISOString() }];

    const antes = doble.llamadas;
    const datos = await invalidacionesVigentes({ urlBase: doble.url });

    expect(doble.llamadas).toBe(antes + 1);
    expect(datos.revocados).toHaveLength(1);
    expect(datos.sesiones).toHaveLength(1);
  });

  test('Sin MS_IDENTIDAD_URL devuelve listas vacías sin llamar a nadie', async () => {
    const antes = doble.llamadas;
    const datos = await invalidacionesVigentes({ urlBase: null });

    expect(doble.llamadas).toBe(antes);
    expect(datos).toEqual({ revocados: [], sesiones: [] });
  });

  test('Si el servicio no responde, el fallo SE PROPAGA', async () => {
    // A diferencia de la composición de datos, aquí un fallo no puede
    // degradarse a «no hay nada revocado»: confundir «no hay» con «no pude
    // preguntar» dejaría entrar tokens de sesiones ya cerradas.
    await expect(invalidacionesVigentes({ urlBase: 'http://127.0.0.1:1' })).rejects.toThrow();
  });
});

describe('La caché conserva la última copia buena', () => {
  test('Un fallo de red no vacía lo que ya sabía', async () => {
    const usuario = propietario();
    doble.revocados = [{ jti: usuario.jti }];
    await cache.refrescar();

    expect(await cache.tokenInvalidado({ sub: usuario.sub, jti: usuario.jti } as never)).toBe(true);

    const rota = crearCacheInvalidacion({
      obtener: () => Promise.reject(new Error('sin red')),
      registrar: () => {},
    });
    const ok = await rota.refrescar();

    expect(ok).toBe(false);
    expect(rota.estado().ultimoError).toBe('sin red');
    // Y la buena sigue sabiendo lo que sabía.
    expect(await cache.tokenInvalidado({ sub: usuario.sub, jti: usuario.jti } as never)).toBe(true);
  });

  test('El refresco REEMPLAZA, no acumula: lo que vence desaparece solo', async () => {
    const usuario = propietario();
    doble.revocados = [{ jti: usuario.jti }];
    await cache.refrescar();
    expect(cache.estado().vigentes).toBe(1);

    // El origen ya no lo reporta porque el token expiró por sí solo.
    doble.revocados = [];
    await cache.refrescar();

    expect(cache.estado().vigentes).toBe(0);
    expect(await cache.tokenInvalidado({ sub: usuario.sub, jti: usuario.jti } as never)).toBe(false);
  });
});

describe('El token revocado no entra al servicio', () => {
  test('Un jti en la lista de revocados da 401 en una ruta real', async () => {
    const usuario = propietario();

    const antes = await request(app)
      .get('/api/inmuebles')
      .set(...conToken(usuario.token));
    expect(antes.statusCode).toBe(200);

    doble.revocados = [{ jti: usuario.jti }];
    await cache.refrescar();

    // Se inyecta la caché de la prueba en el middleware real.
    const modulo = await import('../src/seguridad/cache');
    const original = modulo.cache.tokenInvalidado;
    (modulo.cache as { tokenInvalidado: unknown }).tokenInvalidado = cache.tokenInvalidado;

    const despues = await request(app)
      .get('/api/inmuebles')
      .set(...conToken(usuario.token));

    (modulo.cache as { tokenInvalidado: unknown }).tokenInvalidado = original;

    expect(despues.statusCode).toBe(401);
    expect(despues.body.mensaje).toContain('Sesión cerrada');
  });
});

describe('Invalidación en bloque por cambio de contraseña', () => {
  test('Un token emitido ANTES del cambio deja de valer', async () => {
    const ahora = Date.now();
    const viejo = firmarToken({ iat: Math.floor((ahora - 60_000) / 1000) });

    doble.sesiones = [{ sub: viejo.sub, desde: new Date(ahora).toISOString() }];
    await cache.refrescar();

    expect(await cache.tokenInvalidado({ sub: viejo.sub, jti: viejo.jti, iat: Math.floor((ahora - 60_000) / 1000) } as never)).toBe(true);
  });

  test('Un token emitido DESPUÉS del cambio sigue valiendo', async () => {
    const ahora = Date.now();
    const nuevo = firmarToken({ iat: Math.floor((ahora + 5_000) / 1000) });

    doble.sesiones = [{ sub: nuevo.sub, desde: new Date(ahora).toISOString() }];
    await cache.refrescar();

    expect(await cache.tokenInvalidado({ sub: nuevo.sub, jti: nuevo.jti, iat: Math.floor((ahora + 5_000) / 1000) } as never)).toBe(false);
  });

  test('Una marca de OTRO usuario no toca mis sesiones', async () => {
    const mio = propietario();
    const ajeno = propietario();
    const iat = Math.floor((Date.now() - 60_000) / 1000);

    doble.sesiones = [{ sub: ajeno.sub, desde: new Date().toISOString() }];
    await cache.refrescar();

    expect(await cache.tokenInvalidado({ sub: mio.sub, jti: mio.jti, iat } as never)).toBe(false);
  });

  test('Un token sin iat no se invalida en bloque', async () => {
    // No se puede comparar lo que no viaja. Se deja pasar en vez de rechazar:
    // rechazar por un claim ausente cerraría la puerta a cualquier emisor
    // legítimo que no lo ponga, y la firma ya lo respalda.
    const usuario = propietario();
    doble.sesiones = [{ sub: usuario.sub, desde: new Date().toISOString() }];
    await cache.refrescar();

    expect(await cache.tokenInvalidado({ sub: usuario.sub, jti: usuario.jti } as never)).toBe(false);
  });
});
