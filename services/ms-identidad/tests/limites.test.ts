/**
 * Limitación de tasa de las rutas públicas.
 *
 * Lo que se fija: superar un límite responde 429 con un `Retry-After` que no dice
 * cuánto falta, el contador se libera al pasar la ventana, fallar el login de alguien
 * bloquea al atacante y no a la víctima, el límite por cuenta de `/recuperar` es
 * silencioso, y una IP que no firmó el gateway no vale.
 *
 * El reloj se sustituye: pasar la ventana es moverlo, no esperar. Y cada prueba usa
 * sus propias IP, firmadas como las firmaría el gateway, para no compartir contadores.
 */

import request from 'supertest';
import { firmarOrigenCliente, textoDeEntorno } from 'arriendos360-shared';

import {
  app,
  cerrarBase,
  eventosDeSalida,
  recrearBase,
  registrarPropietario,
  sequelize,
} from './utiles/entorno';
import {
  LIMITES_POR_DEFECTO,
  MENSAJE_LIMITE,
  contar,
  grupoDeIp,
  purgarVencidos,
  restablecerLimites,
  usarLimites,
  usarReloj,
} from '../src/services/limites';

// El inicio de una hora: alineado con las ventanas de 15 min y de 1 h.
let ahora = Date.UTC(2026, 8, 14, 12, 0, 0);
const avanzar = (segundos: number): void => {
  ahora += segundos * 1000;
};

const CONTRASENA = 'pass123';
const VICTIMA = 'victima@test.com';

/** Cabecera de origen tal como la pondría el gateway para una petición desde `ip`. */
const firmada = (ip: string, secreto = process.env['SERVICIO_JWT_SECRET']): [string, string] => [
  'x-origen-cliente',
  firmarOrigenCliente({
    ip,
    emisor: 'gateway',
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-identidad'),
    secreto,
  }),
];

const post = (ruta: string, cuerpo: Record<string, unknown>, ip: string) =>
  request(app).post(`/api/auth/${ruta}`).set(...firmada(ip)).send(cuerpo);

let siguienteDocumento = 90000000;
const registro = (ip: string) => {
  siguienteDocumento += 1;
  return post(
    'registro',
    {
      nombres: 'Limi',
      apellidos: 'Tado',
      email: `limite-${siguienteDocumento}@test.com`,
      contrasena: CONTRASENA,
      documento: String(siguienteDocumento),
    },
    ip,
  );
};

/** El 429 de una ruta de autenticación: ventana entera y ninguna cabecera de cuota. */
const esBloqueo = (respuesta: request.Response, ventanaSegundos: number): void => {
  expect(respuesta.status).toBe(429);
  expect(respuesta.headers['retry-after']).toBe(String(ventanaSegundos));
  expect(respuesta.body).toEqual({ mensaje: MENSAJE_LIMITE });
  expect(Object.keys(respuesta.headers).filter((nombre) => /ratelimit/i.test(nombre))).toEqual([]);
};

beforeAll(async () => {
  await recrearBase();
  restablecerLimites();
  usarReloj(() => ahora);

  await registrarPropietario({
    email: VICTIMA,
    nombres: 'Vic',
    apellidos: 'Tima',
    documento: '89999999',
  });
});

afterAll(async () => {
  usarReloj(null);
  restablecerLimites();
  await cerrarBase();
});

describe('Límite por IP: registro, 10 por hora', () => {
  const ip = '198.51.100.1';

  test('el undécimo responde 429 con Retry-After de la ventana entera', async () => {
    for (let i = 0; i < LIMITES_POR_DEFECTO.registroPorIp.maximo; i += 1) {
      expect((await registro(ip)).status).toBe(201);
    }

    esBloqueo(await registro(ip), 3600);
  });

  test('Retry-After no dice cuánto falta: sigue siendo la hora entera a mitad de ventana', async () => {
    avanzar(30 * 60);
    esBloqueo(await registro(ip), 3600);
  });

  test('otra IP no comparte contador', async () => {
    expect((await registro('198.51.100.2')).status).toBe(201);
  });

  test('pasada la ventana, el contador se libera', async () => {
    avanzar(30 * 60);
    expect((await registro(ip)).status).toBe(201);
  });
});

describe('Login', () => {
  const login = (ip: string, email = VICTIMA, contrasena = CONTRASENA) =>
    post('login', { email, contrasena }, ip);

  test('cinco fallos bloquean ESA IP para esa cuenta, aunque luego acierte', async () => {
    const atacante = '203.0.113.10';

    for (let i = 0; i < LIMITES_POR_DEFECTO.loginFallidosPorCuentaEIp.maximo; i += 1) {
      expect((await login(atacante, VICTIMA, 'no-es')).status).toBe(401);
    }

    esBloqueo(await login(atacante), 900);
  });

  test('la víctima sigue entrando desde su propia IP', async () => {
    expect((await login('203.0.113.20')).status).toBe(200);
  });

  test('un login correcto no consume el contador de fallos', async () => {
    for (let i = 0; i < 8; i += 1) {
      expect((await login('203.0.113.30')).status).toBe(200);
    }
  });

  test('un correo que no existe se cuenta igual: el 429 no dice qué cuentas existen', async () => {
    const ip = '203.0.113.40';

    for (let i = 0; i < LIMITES_POR_DEFECTO.loginFallidosPorCuentaEIp.maximo; i += 1) {
      expect((await login(ip, 'nadie@test.com', 'no-es')).status).toBe(401);
    }

    esBloqueo(await login(ip, 'nadie@test.com', 'no-es'), 900);
  });

  test('por IP: pasado el máximo, 429 sea cual sea la cuenta', async () => {
    usarLimites({ loginPorIp: { maximo: 3 } });
    try {
      const ip = '203.0.113.50';
      for (let i = 0; i < 3; i += 1) {
        expect((await login(ip, `cuenta-${i}@test.com`, 'no-es')).status).toBe(401);
      }

      esBloqueo(await login(ip), 900);
    } finally {
      restablecerLimites();
    }
  });

  test('los fallos caducan con la ventana', async () => {
    avanzar(15 * 60);
    expect((await login('203.0.113.10')).status).toBe(200);
  });
});

describe('Recuperar y restablecer', () => {
  test('recuperar por IP: el sexto responde 429', async () => {
    const ip = '192.0.2.1';

    for (let i = 0; i < LIMITES_POR_DEFECTO.recuperarPorIp.maximo; i += 1) {
      expect((await post('recuperar', { email: `r${i}@test.com` }, ip)).status).toBe(200);
    }

    esBloqueo(await post('recuperar', { email: 'r9@test.com' }, ip), 3600);
  });

  test('recuperar por cuenta es SILENCIOSO: mismo 200, sin enlace, y queda en el log una vez', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const antes = (await eventosDeSalida('RecuperacionSolicitada')).length;
      const maximo = LIMITES_POR_DEFECTO.recuperarPorCuenta.maximo;

      const respuestas = [];
      for (let i = 0; i < maximo + 2; i += 1) {
        respuestas.push(await post('recuperar', { email: VICTIMA }, `192.0.2.${100 + i}`));
      }

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(200);
        expect(respuesta.body).toEqual(respuestas[0]!.body);
      }

      expect((await eventosDeSalida('RecuperacionSolicitada')).length).toBe(antes + maximo);

      const avisos = aviso.mock.calls.filter(([texto]) => String(texto).includes('recuperación por cuenta'));
      expect(avisos).toHaveLength(1);
      expect(String(avisos[0]![0])).toContain('vi***@test.com');
      expect(String(avisos[0]![0])).not.toContain(VICTIMA);
    } finally {
      aviso.mockRestore();
    }
  });

  test('restablecer por IP: el sexto responde 429', async () => {
    const ip = '192.0.2.50';
    const intento = () => post('restablecer', { token: 'inventado', contrasena_nueva: 'nueva-clave-1' }, ip);

    for (let i = 0; i < LIMITES_POR_DEFECTO.restablecerPorIp.maximo; i += 1) {
      expect((await intento()).status).toBe(400);
    }

    esBloqueo(await intento(), 3600);
  });
});

describe('Origen de la petición', () => {
  test('una IP firmada con otro secreto no vale: cuenta la IP de la conexión', async () => {
    usarLimites({ restablecerPorIp: { maximo: 2 } });
    try {
      const intento = (ipInventada: string) =>
        request(app)
          .post('/api/auth/restablecer')
          .set(...firmada(ipInventada, 'clave-que-no-es-la-del-gateway'))
          .send({ token: 'inventado', contrasena_nueva: 'nueva-clave-1' });

      expect((await intento('10.0.0.1')).status).toBe(400);
      expect((await intento('10.0.0.2')).status).toBe(400);
      // Tres IP distintas "declaradas", una sola conexión: tercera, bloqueada.
      esBloqueo(await intento('10.0.0.3'), 3600);
    } finally {
      restablecerLimites();
    }
  });

  test('IPv4 tal cual, IPv4 mapeada como IPv4, IPv6 agrupada por su /64', () => {
    expect(grupoDeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(grupoDeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(grupoDeIp('2001:db8:abcd:12:1::5')).toBe('2001:db8:abcd:12::/64');
    expect(grupoDeIp('2001:db8:abcd:12:ffff:ffff:ffff:ffff')).toBe(grupoDeIp('2001:db8:abcd:12::1'));
    expect(grupoDeIp('2001:db8:abcd:13::1')).not.toBe(grupoDeIp('2001:db8:abcd:12::1'));
  });
});

describe('El almacén', () => {
  test('peticiones concurrentes nunca cuentan de menos: la sentencia es atómica', async () => {
    const lim = { nombre: 'prueba-concurrencia', maximo: 1000, ventanaSegundos: 60 };

    const cuentas = await Promise.all(Array.from({ length: 20 }, () => contar(lim, ['misma-clave'])));

    expect([...cuentas].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('si el almacén falla, 503 y la petición no pasa', async () => {
    const consulta = jest.spyOn(sequelize, 'query') as unknown as jest.SpyInstance;
    consulta.mockRejectedValueOnce(new Error('base caída'));
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    try {
      expect((await registro('198.51.100.99')).status).toBe(503);
    } finally {
      consulta.mockRestore();
    }
  });

  test('la purga borra las ventanas vencidas y conserva la vigente', async () => {
    const lim = { nombre: 'prueba-purga', maximo: 1000, ventanaSegundos: 60 };
    await contar(lim, ['vieja']);

    avanzar(3 * 3600);
    await contar(lim, ['nueva']);
    await purgarVencidos();

    const [filas] = (await sequelize.query(
      `SELECT ventana FROM identidad.limites_tasa WHERE clave LIKE 'prueba-purga:%'`,
    )) as [Array<{ ventana: Date }>, unknown];

    expect(filas).toHaveLength(1);
    expect(new Date(filas[0]!.ventana).getTime()).toBeGreaterThanOrEqual(ahora - 60 * 1000);
  });
});
