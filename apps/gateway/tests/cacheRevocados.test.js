/**
 * Caché de tokens revocados.
 *
 * Sin red ni base: la función que trae la lista se inyecta. Lo que se prueba es
 * la política de la caché —qué hace al refrescar, qué hace cuando el origen
 * falla— que es donde están las decisiones, no la llamada HTTP.
 */

const { crearCacheRevocados } = require('../src/routing/cacheRevocados');

const entrada = (jti) => ({ jti, expira_en: new Date(Date.now() + 3600000).toISOString() });

describe('Refresco', () => {
    test('parte vacía y se llena al refrescar', async () => {
        const cache = crearCacheRevocados({ obtener: async () => [entrada('a')] });

        expect(await cache.estaRevocado('a')).toBe(false);
        await cache.refrescar();
        expect(await cache.estaRevocado('a')).toBe(true);
    });

    test('reemplaza la copia entera, no la acumula', async () => {
        // Es lo que hace que una fila vencida desaparezca sola de la caché: el
        // origen deja de listarla y aquí deja de existir, sin barrido.
        let lista = [entrada('a'), entrada('b')];
        const cache = crearCacheRevocados({ obtener: async () => lista });

        await cache.refrescar();
        expect(await cache.estaRevocado('a')).toBe(true);

        lista = [entrada('b')];
        await cache.refrescar();

        expect(await cache.estaRevocado('a')).toBe(false);
        expect(await cache.estaRevocado('b')).toBe(true);
    });

    test('un jti que no está no cuenta como revocado', async () => {
        const cache = crearCacheRevocados({ obtener: async () => [entrada('a')] });
        await cache.refrescar();

        expect(await cache.estaRevocado('otro')).toBe(false);
        expect(await cache.estaRevocado(undefined)).toBe(false);
        expect(await cache.estaRevocado('')).toBe(false);
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
                return [entrada('a')];
            }
        });

        await cache.refrescar();
        falla = true;
        const resultado = await cache.refrescar();

        expect(resultado).toBe(false);
        expect(await cache.estaRevocado('a')).toBe(true);
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
                return [];
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
            obtener: async () => [entrada('a')],
            intervaloMs: 60000
        });

        await cache.iniciar();
        expect(await cache.estaRevocado('a')).toBe(true);
        cache.detener();
    });

    test('el temporizador no impide que el proceso termine', async () => {
        const cache = crearCacheRevocados({ obtener: async () => [], intervaloMs: 60000 });
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
                return [];
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
            obtener: async () => [entrada('a'), entrada('b')],
            intervaloMs: 15000
        });
        await cache.refrescar();

        expect(cache.estado().vigentes).toBe(2);
        expect(cache.estado().intervaloMs).toBe(15000);
    });
});
