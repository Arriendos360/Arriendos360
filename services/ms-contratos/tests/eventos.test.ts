import request from 'supertest';

import { sequelize } from '../src/config/database';
import { TABLA_SALIDA, almacen, crearPublicadorDeSalida } from '../src/eventos';
import {
  app,
  cerrarEntorno,
  conToken,
  crearContrato,
  inmuebleDe,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/**
 * MS-Contratos como PRODUCTOR del bus.
 *
 * ── ESTAS PRUEBAS SE MUDAN CON EL PRODUCTOR ─────────────────────────────────
 *
 * Venian de `apps/gateway/tests/eventos.test.js`. El paso 6d no cambia el
 * mecanismo —sigue siendo el de `packages/shared`— pero si de quien es la tabla
 * de salida, y eso es justo lo que hay que volver a comprobar: que el evento se
 * anota en la MISMA transaccion que el contrato, ahora contra el esquema
 * `contratos`.
 *
 * Lo que se comprueba aqui y en ningun otro sitio del proyecto:
 *
 *   1. Firmar un contrato deja el sobre en la bandeja, sin entregarlo todavia.
 *   2. Si el registro del evento falla, el contrato TAMPOCO se guarda.
 *   3. El publicador entrega, marca y no reintenta lo ya entregado.
 *   4. Un destino caido no pierde el evento: se reintenta.
 *
 * El publicador NO se arranca: las pruebas llaman a `ciclo()` a mano. Un
 * temporizador corriendo durante una suite haria que las entregas ocurrieran en
 * momentos que la prueba no controla.
 */

/** Publicador de pruebas: almacen y entrega reales, sin espera entre reintentos. */
const publicador = crearPublicadorDeSalida({ esperaBaseMs: 0, registrar: () => {} });

/** Los sobres que hay en la bandeja, en el orden en que se registraron. */
const enLaBandeja = async (): Promise<Array<{ tipo: string; estado: string; payload: Record<string, unknown> }>> => {
  const [filas] = await sequelize.query(
    `SELECT tipo, estado, payload FROM ${TABLA_SALIDA} ORDER BY registrado_en, id_evento`,
  );
  return filas as Array<{ tipo: string; estado: string; payload: Record<string, unknown> }>;
};

let duenio: ReturnType<typeof propietario>;
let idInquilino: string;

beforeAll(async () => {
  await prepararEntorno();
  duenio = propietario();
  idInquilino = inquilinoDe();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('El evento se anota con el contrato, en la misma transaccion', () => {
  test('firmar deja `ContratoFormalizado` en la bandeja, sin entregar', async () => {
    const idInmueble = inmuebleDe(duenio.sub, 'Bandeja 1');
    const { respuesta } = await crearContrato(duenio.token, idInmueble, idInquilino, {
      canon: 1234567,
      fecha_inicio_corte: '2026-02-10',
    });

    expect(respuesta.statusCode).toBe(201);

    const bandeja = await enLaBandeja();
    const sobre = bandeja.at(-1);

    expect(sobre?.tipo).toBe('ContratoFormalizado');
    // TODAVIA NO ENTREGADO. Es lo que hace que «pendiente» sea un estado
    // observable y no una carrera.
    expect(sobre?.estado).toBe('pendiente');

    // La carga lleva lo que el Capitulo 2 dice, leido de SU columna: `canon` es
    // un numero aunque la columna sea DECIMAL, y la fecha de corte es la de la
    // fila, no una derivada del inicio.
    expect(sobre?.payload['canon']).toBe(1234567);
    expect(sobre?.payload['fecha_inicio_corte']).toBe('2026-02-10');
    expect(sobre?.payload['id_inmueble']).toBe(idInmueble);
  });

  test('finalizar deja `ContratoFinalizado`, con la misma clave de orden', async () => {
    const idInmueble = inmuebleDe(duenio.sub, 'Bandeja 2');
    const { id } = await crearContrato(duenio.token, idInmueble, idInquilino);

    await request(app)
      .put(`/api/contratos/${id}/finalizar`)
      .set(...conToken(duenio.token));

    const bandeja = await enLaBandeja();
    expect(bandeja.at(-1)?.tipo).toBe('ContratoFinalizado');

    // La clave de orden es el inmueble: sin ella, un `Finalizado` podria
    // adelantar a su `Formalizado` y dejar el inmueble arrendado para siempre.
    const [claves] = await sequelize.query(
      `SELECT clave_orden FROM ${TABLA_SALIDA} ORDER BY registrado_en DESC LIMIT 2`,
    );
    const [ultima, penultima] = claves as Array<{ clave_orden: string }>;
    expect(ultima?.clave_orden).toBe(idInmueble);
    expect(penultima?.clave_orden).toBe(idInmueble);
  });

  test('si el registro del evento falla, el contrato TAMPOCO se guarda', async () => {
    // Es el orden correcto: un contrato que nadie anuncia deja el sistema
    // inconsistente en silencio; uno que no se firma se le dice al usuario.
    const original = almacen.registrar;
    (almacen as { registrar: unknown }).registrar = () => {
      throw new Error('bandeja rota a proposito');
    };

    const idInmueble = inmuebleDe(duenio.sub, 'Atomica');
    const { respuesta } = await crearContrato(duenio.token, idInmueble, idInquilino);

    (almacen as { registrar: unknown }).registrar = original;

    expect(respuesta.statusCode).toBe(500);

    // Y no queda contrato: la transaccion se deshizo entera.
    const listado = await request(app)
      .get('/api/contratos')
      .set(...conToken(duenio.token));
    expect(
      listado.body.filter((c: { id_inmueble: string }) => c.id_inmueble === idInmueble),
    ).toHaveLength(0);
  });
});

describe('El publicador entrega y marca', () => {
  test('un ciclo entrega lo pendiente y no lo vuelve a intentar', async () => {
    const primero = await publicador.ciclo();
    expect(primero.entregados).toBeGreaterThan(0);

    // Segundo ciclo: ya no queda nada pendiente.
    const segundo = await publicador.ciclo();
    expect(segundo.entregados).toBe(0);
  });

  test('con el destino caido el evento NO se pierde: queda pendiente', async () => {
    // El evento esta en disco antes de que nadie intente entregarlo, asi que un
    // fallo solo retrasa la convergencia. La garantia pasa de «ojala salga bien»
    // a «acabara pasando».
    const { inmuebles } = await import('./utiles/entorno').then((m) => ({
      inmuebles: m.inmueblesFalso(),
    }));

    const idInmueble = inmuebleDe(duenio.sub, 'Con destino caido');
    await crearContrato(duenio.token, idInmueble, idInquilino);

    inmuebles.caer();
    const conFallo = await publicador.ciclo();
    expect(conFallo.fallidos).toBeGreaterThan(0);
    expect(conFallo.entregados).toBe(0);

    inmuebles.levantar();
    const reintento = await publicador.ciclo();
    expect(reintento.entregados).toBeGreaterThan(0);
  });
});
