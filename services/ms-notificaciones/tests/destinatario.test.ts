/**
 * El destinatario se PREGUNTA a ms-identidad, no se lee del sobre.
 *
 * ── LA REGLA QUE SE DEFIENDE AQUI ───────────────────────────────────────────
 *
 * Ningun evento lleva una direccion de correo. Llevan el `id_usuario`, y este servicio
 * resuelve la direccion consultando a ms-identidad en el momento de manejar el evento.
 *
 * El motivo es de propiedad del dato: un correo pertenece a `identidad.usuarios` y a
 * nadie mas. Copiarlo en un sobre convertiria a cada emisor —ms-identidad para la
 * recuperacion, ms-financiero para los avisos del motor— en responsable de un dato de
 * contacto que no le pertenece, y dejaria copias viejas en dos tablas de salida que no
 * tienen forma de enterarse de que alguien cambio su correo.
 *
 * Una regla asi es facil de romper sin darse cuenta: basta que alguien añada `email` al
 * payload «porque ya lo tenia a mano». De ahi la segunda prueba de este archivo, que
 * mete un `email` falso en el sobre y comprueba que se ignora.
 */

import crypto from 'crypto';

import {
  cerrarEntorno,
  entregarEvento,
  enviosDe,
  identidadFalsa,
  prepararEntorno,
  usuarioDe,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

const cuentaGenerada = (idInquilino: string) => ({
  id_cuenta_cobro: crypto.randomUUID(),
  id_contrato: crypto.randomUUID(),
  id_inquilino: idInquilino,
  valor: 1200000,
  inicio: '2026-03-01',
  fin: '2026-03-31',
});

describe('Resolución del destinatario', () => {
  test('el correo sale de ms-identidad y se consulta por el id del sobre', async () => {
    const idUsuario = usuarioDe({ email: 'resuelto@test.com', nombres: 'Reina' });

    identidadFalsa().limpiarLlamadas();
    const { sobre } = await entregarEvento('CuentaCobroGenerada', cuentaGenerada(idUsuario));

    // Se preguntó, y se preguntó por ESE id.
    const consultas = identidadFalsa().llamadas.filter((l) =>
      l.ruta.startsWith('/interno/usuarios'),
    );
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.ruta).toContain(idUsuario);

    const [envio] = await enviosDe(sobre.id_evento);
    expect(envio!.destinatario).toBe('resuelto@test.com');
    // Y se guardan los dos: a quién se quiso avisar y a dónde salió.
    expect(envio!.id_usuario).toBe(idUsuario);
    // El nombre resuelto también se usa, no el del sobre — que no lo lleva.
    expect(envio!.cuerpo).toContain('Reina');
  });

  test('un `email` metido en el sobre se IGNORA', async () => {
    // La prueba que defiende la regla de verdad. Si alguien añadiera `email` al
    // payload y el manejador lo usara, esta prueba lo atraparía: el correo tiene que
    // salir al que dice ms-identidad, no al que dice el emisor.
    const idUsuario = usuarioDe({ email: 'el-de-identidad@test.com' });

    const { sobre } = await entregarEvento('CuentaCobroGenerada', {
      ...cuentaGenerada(idUsuario),
      email: 'el-del-sobre@test.com',
      destinatario: 'tambien-del-sobre@test.com',
    } as never);

    const [envio] = await enviosDe(sobre.id_evento);
    expect(envio!.destinatario).toBe('el-de-identidad@test.com');
  });

  test('si el correo CAMBIA, el aviso siguiente va al nuevo', async () => {
    // Es la consecuencia práctica de resolver en el momento y no copiar: un dato de
    // contacto copiado en un sobre se queda viejo y nadie lo sabe.
    const idUsuario = usuarioDe({ email: 'antiguo@test.com' });

    const primero = await entregarEvento('CuentaCobroGenerada', cuentaGenerada(idUsuario));
    expect((await enviosDe(primero.sobre.id_evento))[0]!.destinatario).toBe('antiguo@test.com');

    identidadFalsa().usuarios.set(idUsuario, { id: idUsuario, email: 'nuevo@test.com' });

    const segundo = await entregarEvento('CuentaCobroGenerada', cuentaGenerada(idUsuario));
    expect((await enviosDe(segundo.sobre.id_evento))[0]!.destinatario).toBe('nuevo@test.com');
  });

  test('los dos destinatarios de un aviso de mora se piden en UNA consulta', async () => {
    // En lote, no de uno en uno: la transacción del consumidor está abierta mientras se
    // pregunta, y mantenerla abierta el doble de tiempo por nada no tiene excusa
    // cuando el endpoint ya acepta una lista.
    const idInquilino = usuarioDe({ email: 'a@test.com' });
    const idPropietario = usuarioDe({ email: 'b@test.com' });

    identidadFalsa().limpiarLlamadas();

    await entregarEvento('CuentaCobroPorVencer', {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idInquilino,
      id_propietario: idPropietario,
      valor: 500000,
      inicio: '2026-04-01',
      fin: '2026-04-30',
      entra_en_mora_el: '2026-04-07',
      direccion_inmueble: 'Av 9 #100-20',
    });

    const consultas = identidadFalsa().llamadas.filter((l) =>
      l.ruta.startsWith('/interno/usuarios'),
    );
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.ruta).toContain(idInquilino);
    expect(consultas[0]!.ruta).toContain(idPropietario);
  });
});

describe('Usuarios que no se pueden resolver', () => {
  test('un usuario sin correo no se avisa, y NO se reintenta el evento', async () => {
    // Que ms-identidad no conteste es transitorio y merece reintento. Que conteste y el
    // usuario no tenga correo no se arregla insistiendo: serían diez intentos y un
    // evento apartado para nada. Así que 200, sin envío.
    const idUsuario = crypto.randomUUID();
    identidadFalsa().usuarios.set(idUsuario, { id: idUsuario, nombres: 'Sin', email: '' });

    const { respuesta, sobre } = await entregarEvento(
      'CuentaCobroGenerada',
      cuentaGenerada(idUsuario),
    );

    expect(respuesta.status).toBe(200);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });

  test('si sólo se resuelve UNO de los dos, sale ese', async () => {
    // Un aviso a medias es mejor que ninguno.
    const idInquilino = usuarioDe({ email: 'solo-el@test.com' });
    const idPropietario = crypto.randomUUID(); // no existe en identidad

    const { respuesta, sobre } = await entregarEvento('CuentaCobroEnMora', {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idInquilino,
      id_propietario: idPropietario,
      valor: 300000,
      inicio: '2026-02-01',
      fin: '2026-02-28',
      dias_de_mora: 10,
      direccion_inmueble: 'Diagonal 5 #6-7',
    });

    expect(respuesta.status).toBe(200);
    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]!.destinatario).toBe('solo-el@test.com');
  });
});
