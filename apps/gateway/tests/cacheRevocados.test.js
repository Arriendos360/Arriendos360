/**
 * Caché de tokens revocados.
 *
 * Sin red ni base: la función que trae la lista se inyecta. Lo que se prueba es
 * la política de la caché —qué hace al refrescar, qué hace cuando el origen
 * falla— que es donde están las decisiones, no la llamada HTTP.
 */

const { crearCacheRevocados } = require('../src/routing/cacheRevocados');

const entrada = (jti) => ({ jti, expira_en: new Date(Date.now() + 3600000).toISOString() });

/** Lo que devuelve `/interno/revocados`: las dos formas de invalidar. */
const lote = (revocados = [], sesiones = []) => ({ revocados, sesiones });

/** Claims mínimos, para preguntar a la caché. */
const claims = (jti, sub = 'u1', iat = Math.floor(Date.now() / 1000)) => ({ jti, sub, iat });

describe('Refresco', () => {
    test('parte vacía y se llena al refrescar', async () => {
        const cache = crearCacheRevocados({ obtener: async () => lote([entrada('a')]) });

        expect(await cache.tokenInvalidado(claims('a'))).toBe(false);
        await cache.refrescar();
        expect(await cache.tokenInvalidado(claims('a'))).toBe(true);
    });

    test('reemplaza la copia entera, no la acumula', async () => {
        // Es lo que hace que una fila vencida desaparezca sola de la caché: el
        // origen deja de listarla y aquí deja de existir, sin barrido.
        let lista = lote([entrada('a'), entrada('b')]);
        const cache = crearCacheRevocados({ obtener: async () => lista });

        await cache.refrescar();
        expect(await cache.tokenInvalidado(claims('a'))).toBe(true);

        lista = lote([entrada('b')]);
        await cache.refrescar();

        expect(await cache.tokenInvalidado(claims('a'))).toBe(false);
        expect(await cache.tokenInvalidado(claims('b'))).toBe(true);
    });

    test('un jti que no está no cuenta como revocado', async () => {
        const cache = crearCacheRevocados({ obtener: async () => lote([entrada('a')]) });
        await cache.refrescar();

        expect(await cache.tokenInvalidado(claims('otro'))).toBe(false);
        expect(await cache.tokenInvalidado(claims(undefined))).toBe(false);
        expect(await cache.tokenInvalidado(claims(''))).toBe(false);
    });
});

describe('Cuando ms-identidad no responde', () => {
    test('conserva la última copia buena en vez de vaciarse', async () => {
        // Vaciarse significaría dar por bueno todo token cerrado durante el
        // incidente. Ver docs/adr/0008.
        let falla = false;
        const cache = crearCacheRevocados({
            obtener: async () => {
                if (falla) throw new Error('sin red');
                return lote([entrada('a')]);
            }
        });

        await cache.refrescar();
        falla = true;
        const resultado = await cache.refrescar();

        expect(resultado).toBe(false);
        expect(await cache.tokenInvalidado(claims('a'))).toBe(true);
    });

    test('no propaga el error: un fallo de refresco no puede tumbar la API', async () => {
        const cache = crearCacheRevocados({
            obtener: async () => {
                throw new Error('sin red');
            }
        });

        await expect(cache.refrescar()).resolves.toBe(false);
    });

    test('el estado deja constancia del fallo, para el log y para depurar', async () => {
        const cache = crearCacheRevocados({
            obtener: async () => {
                throw new Error('sin red');
            }
        });

        await cache.refrescar();
        expect(cache.estado().ultimoError).toBe('sin red');
        expect(cache.estado().ultimoExito).toBeNull();
    });

    test('un fallo tras un éxito no borra la marca del último éxito', async () => {
        let falla = false;
        const cache = crearCacheRevocados({
            obtener: async () => {
                if (falla) throw new Error('sin red');
                return lote();
            }
        });

        await cache.refrescar();
        const exito = cache.estado().ultimoExito;
        falla = true;
        await cache.refrescar();

        expect(cache.estado().ultimoExito).toBe(exito);
        expect(cache.estado().ultimoError).toBe('sin red');
    });
});

describe('Ciclo de vida', () => {
    test('iniciar() hace una carga inmediata, sin esperar al primer intervalo', async () => {
        // Si no, el gateway arrancaría con la caché vacía y aceptaría durante un
        // intervalo entero tokens ya cerrados.
        const cache = crearCacheRevocados({
            obtener: async () => lote([entrada('a')]),
            intervaloMs: 60000
        });

        await cache.iniciar();
        expect(await cache.tokenInvalidado(claims('a'))).toBe(true);
        cache.detener();
    });

    test('el temporizador no impide que el proceso termine', async () => {
        const cache = crearCacheRevocados({ obtener: async () => lote(), intervaloMs: 60000 });
        const temporizador = await cache.iniciar();

        // `unref` es lo que evita que el proceso se quede colgado por el timer.
        expect(temporizador.hasRef()).toBe(false);
        cache.detener();
    });

    test('detener() corta el refresco', async () => {
        let veces = 0;
        const cache = crearCacheRevocados({
            obtener: async () => {
                veces += 1;
                return lote();
            },
            intervaloMs: 5
        });

        await cache.iniciar();
        cache.detener();
        const tras = veces;

        await new Promise((r) => setTimeout(r, 30));
        expect(veces).toBe(tras);
    });

    test('el estado reporta cuántos hay y cada cuánto se refresca', async () => {
        const cache = crearCacheRevocados({
            obtener: async () => lote([entrada('a'), entrada('b')]),
            intervaloMs: 15000
        });
        await cache.refrescar();

        expect(cache.estado().vigentes).toBe(2);
        expect(cache.estado().intervaloMs).toBe(15000);
    });
});

describe('Invalidación en bloque por cambio de contraseña', () => {
    const marca = (sub, desde) => ({ sub, desde: new Date(desde).toISOString() });

    test('un token emitido ANTES del cambio deja de valer', async () => {
        const cambio = Date.now();
        const cache = crearCacheRevocados({
            obtener: async () => lote([], [marca('u1', cambio)])
        });
        await cache.refrescar();

        const antes = claims('jti-1', 'u1', Math.floor(cambio / 1000) - 60);
        expect(await cache.tokenInvalidado(antes)).toBe(true);
    });

    test('uno emitido DESPUÉS sigue valiendo', async () => {
        const cambio = Date.now();
        const cache = crearCacheRevocados({
            obtener: async () => lote([], [marca('u1', cambio)])
        });
        await cache.refrescar();

        const despues = claims('jti-2', 'u1', Math.floor(cambio / 1000) + 60);
        expect(await cache.tokenInvalidado(despues)).toBe(false);
    });

    test('sólo afecta al usuario que cambió, no a los demás', async () => {
        const cambio = Date.now();
        const cache = crearCacheRevocados({
            obtener: async () => lote([], [marca('u1', cambio)])
        });
        await cache.refrescar();

        const deOtro = claims('jti-3', 'u2', Math.floor(cambio / 1000) - 60);
        expect(await cache.tokenInvalidado(deOtro)).toBe(false);
    });

    test('un token emitido en el mismo segundo del cambio sobrevive', async () => {
        // El `iat` de un JWT va en segundos enteros, y al cambiar la contraseña
        // se emite un token nuevo justo después. Si la comparación no tolerara
        // el mismo segundo, ese token se invalidaría a sí mismo.
        const segundo = Math.floor(Date.now() / 1000);
        const cache = crearCacheRevocados({
            obtener: async () => lote([], [marca('u1', segundo * 1000)])
        });
        await cache.refrescar();

        expect(await cache.tokenInvalidado(claims('jti-4', 'u1', segundo))).toBe(false);
    });

    test('las dos formas conviven: revocado por jti y por marca', async () => {
        const cambio = Date.now();
        const cache = crearCacheRevocados({
            obtener: async () => lote([entrada('revocado')], [marca('u1', cambio)])
        });
        await cache.refrescar();

        // Por jti, aunque el iat sea posterior al cambio.
        expect(
            await cache.tokenInvalidado(claims('revocado', 'u2', Math.floor(cambio / 1000) + 60))
        ).toBe(true);
        // Por marca, aunque el jti no esté revocado.
        expect(
            await cache.tokenInvalidado(claims('otro', 'u1', Math.floor(cambio / 1000) - 60))
        ).toBe(true);

        expect(cache.estado().sesionesInvalidadas).toBe(1);
    });
});
