/**
 * El consumidor de eventos, contra la base de verdad.
 *
 * Aqui no hay dobles: la idempotencia la da una restriccion de clave primaria de
 * PostgreSQL dentro de una transaccion, y eso no se puede comprobar contra un
 * `Set` en memoria sin probar otra cosa distinta de la que se despliega.
 *
 * Lo que se persigue en toda la suite es una sola afirmacion, la que sostiene
 * que la entrega al-menos-una-vez sea aceptable: **entregar el mismo evento dos
 * veces produce un solo efecto**.
 */

import crypto from 'crypto';
import request from 'supertest';

import {
  app,
  cerrarBase,
  conServicio,
  conToken,
  crearInmueble,
  propietario,
  recrearBase,
} from './utiles/entorno';
import { Inmueble } from '../src/models/Inmueble';

const dueno = propietario();

let idInmueble: string;

/** Un sobre con la forma que produce `crearSobre` en el emisor. */
const sobre = (tipo: string, payload: Record<string, unknown>, idEvento?: string) => ({
  id_evento: idEvento ?? crypto.randomUUID(),
  tipo,
  version: 1,
  ocurrido_en: new Date().toISOString(),
  payload,
});

const entregar = (cuerpo: unknown) =>
  request(app)
    .post('/interno/eventos')
    .set(...conServicio())
    .send(cuerpo as object);

const estadoDe = async (id: string): Promise<string | undefined> =>
  (await Inmueble.findByPk(id))?.estado;

beforeAll(async () => {
  await recrearBase();
  idInmueble = (await crearInmueble(dueno.token, { direccion: 'Calle del Bus 1' })).id;
});

afterAll(async () => {
  await cerrarBase();
});

describe('Credencial de servicio', () => {
  test('La entrada del bus la exige como el resto de /interno', async () => {
    // Confianza cero: que un evento venga de la red interna no lo hace
    // confiable. Sin esto, cualquiera con acceso al puerto podria arrendar
    // inmuebles ajenos inventandose un sobre.
    const respuesta = await request(app)
      .post('/interno/eventos')
      .send(sobre('ContratoFormalizado', { id_inmueble: idInmueble }));

    expect(respuesta.statusCode).toBe(401);
  });

  test('Un token de usuario no sirve tampoco aqui', async () => {
    const respuesta = await request(app)
      .post('/interno/eventos')
      .set(...conToken(dueno.token))
      .send(sobre('ContratoFormalizado', { id_inmueble: idInmueble }));

    expect(respuesta.statusCode).toBe(401);
  });
});

describe('ContratoFormalizado ocupa el inmueble', () => {
  test('El inmueble pasa a arrendado', async () => {
    expect(await estadoDe(idInmueble)).toBe('disponible');

    const respuesta = await entregar(
      sobre('ContratoFormalizado', {
        id_contrato: crypto.randomUUID(),
        id_inmueble: idInmueble,
        canon: 1500000,
        fecha_inicio_corte: '2026-01-01',
      }),
    );

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.repetido).toBe(false);
    expect(await estadoDe(idInmueble)).toBe('arrendado');
  });

  test('La auditoria registra al sistema, no a una persona', async () => {
    // Cambio respecto del ADR 0011, y deliberado: el sobre no lleva actor. Un
    // evento describe un hecho del dominio del emisor, no la peticion de una
    // persona a este servicio; quien firmo el contrato queda registrado en
    // `contratos.creado_por`, que es donde corresponde.
    const inmueble = await Inmueble.findByPk(idInmueble);

    expect(inmueble?.actualizado_por).toBe('6facbaff-9fcd-4300-9426-e464f45be52d');
    expect(inmueble?.creado_por).toBe(dueno.sub);
  });
});

describe('Entregar el mismo evento dos veces produce un solo efecto', () => {
  test('La segunda entrega se descarta por id_evento', async () => {
    const idEvento = crypto.randomUUID();
    const carga = { id_contrato: crypto.randomUUID(), id_inmueble: idInmueble };

    const primera = await entregar(sobre('ContratoFinalizado', carga, idEvento));
    expect(primera.body.repetido).toBe(false);
    expect(await estadoDe(idInmueble)).toBe('disponible');

    // Se ensucia el estado a mano. Es lo que hace la prueba concluyente: si el
    // manejador volviera a ejecutarse, lo devolveria a `disponible` y no habria
    // forma de distinguir «no se ejecuto» de «se ejecuto y dio lo mismo».
    await Inmueble.update({ estado: 'arrendado' }, { where: { id_inmueble: idInmueble } });

    const segunda = await entregar(sobre('ContratoFinalizado', carga, idEvento));

    expect(segunda.statusCode).toBe(200);
    expect(segunda.body.repetido).toBe(true);
    expect(await estadoDe(idInmueble)).toBe('arrendado');
  });

  test('Otro evento con la misma carga SI vuelve a aplicarse', async () => {
    // El descarte es por identificador de evento, no por contenido: dos hechos
    // iguales son dos hechos. Si se dedujera del payload, un contrato firmado,
    // finalizado y vuelto a firmar sobre el mismo inmueble perderia el ultimo.
    const respuesta = await entregar(
      sobre('ContratoFinalizado', {
        id_contrato: crypto.randomUUID(),
        id_inmueble: idInmueble,
      }),
    );

    expect(respuesta.body.repetido).toBe(false);
    expect(await estadoDe(idInmueble)).toBe('disponible');
  });
});

describe('Lo que llega mal', () => {
  test('Un sobre sin forma de sobre devuelve 400', async () => {
    const respuesta = await entregar({ tipo: 'ContratoFormalizado' });

    expect(respuesta.statusCode).toBe(400);
  });

  test('Un tipo sin manejador se acepta y se ignora', async () => {
    // No es un error: en una coreografia el productor no sabe quien escucha.
    // Devolver 500 lo haria reintentar hasta apartarlo, ensuciando SU tabla por
    // una decision de configuracion ajena.
    const respuesta = await entregar(sobre('PagoRegistrado', { id_pago: crypto.randomUUID() }));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.ignorado).toBe(true);
  });

  test('Una carga sin id_inmueble devuelve 500 para que el productor reintente', async () => {
    // Es un error de programacion del emisor. Acabara apartado en su tabla de
    // salida, que es donde tiene que verse.
    const respuesta = await entregar(sobre('ContratoFormalizado', { id_contrato: 'x' }));

    expect(respuesta.statusCode).toBe(500);
  });

  test('Un evento sobre un inmueble que no existe se da por procesado', async () => {
    // Reintentar no lo va a hacer aparecer, y dejarlo en la cola frenaria a los
    // demas eventos de esa misma clave de orden por algo que nadie puede
    // arreglar.
    const respuesta = await entregar(
      sobre('ContratoFormalizado', {
        id_contrato: crypto.randomUUID(),
        id_inmueble: crypto.randomUUID(),
      }),
    );

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.repetido).toBe(false);
  });
});

describe('El efecto y la marca de procesado van juntos', () => {
  test('Si el manejador falla, el evento NO queda marcado', async () => {
    // Sin esto, un fallo a mitad perderia el evento para siempre: el productor
    // lo daria por entregado —respondio— y el consumidor lo descartaria como
    // repetido en el reintento.
    const idEvento = crypto.randomUUID();

    const fallida = await entregar(sobre('ContratoFormalizado', {}, idEvento));
    expect(fallida.statusCode).toBe(500);

    // El mismo id, ahora con una carga correcta: si la marca hubiera quedado
    // escrita, esto responderia `repetido` y no haria nada.
    const buena = await entregar(
      sobre(
        'ContratoFormalizado',
        { id_contrato: crypto.randomUUID(), id_inmueble: idInmueble },
        idEvento,
      ),
    );

    expect(buena.body.repetido).toBe(false);
    expect(await estadoDe(idInmueble)).toBe('arrendado');
  });
});
