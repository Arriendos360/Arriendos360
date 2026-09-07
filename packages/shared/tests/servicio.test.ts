/**
 * Autenticacion entre servicios.
 *
 * Es el mecanismo que heredaran los cuatro servicios siguientes, asi que se
 * prueba aqui y no en cada consumidor. Lo que se fija: que un token de usuario
 * no valga, que uno dirigido a otro servicio no valga, que caduque, y que la
 * respuesta ante cualquier fallo sea la misma.
 */

import jwt from 'jsonwebtoken';

import type { ClaimsServicio } from '../src/servicio';
import {
  ESQUEMA_SERVICIO,
  MENSAJE_SERVICIO_NO_AUTENTICADO,
  cabeceraDeServicio,
  exigirServicio,
  extraerTokenDeServicio,
  firmarTokenDeServicio,
  verificarTokenDeServicio,
} from '../src/servicio';

const CLAVE = 'clave-de-servicio-para-pruebas';
const CLAVE_DE_USUARIO = 'clave-de-usuario-distinta';

const firmar = (extra: Partial<{ emisor: string; destinatario: string; secreto: string; vigenciaSegundos: number }> = {}) =>
  firmarTokenDeServicio({
    emisor: 'gateway',
    destinatario: 'ms-identidad',
    secreto: CLAVE,
    ...extra,
  });

const verificar = (token: string, extra: Record<string, unknown> = {}) =>
  verificarTokenDeServicio(
    { authorization: `${ESQUEMA_SERVICIO} ${token}` },
    { destinatario: 'ms-identidad', secreto: CLAVE, ...extra },
  );

describe('Firma', () => {
  test('produce un token con emisor, destinatario y expiracion', () => {
    const claims = jwt.decode(firmar()) as Record<string, unknown>;

    expect(claims['iss']).toBe('gateway');
    expect(claims['aud']).toBe('ms-identidad');
    expect((claims['exp'] as number) - (claims['iat'] as number)).toBe(60);
  });

  test('la cabecera trae el esquema propio, no Bearer', () => {
    const cabecera = cabeceraDeServicio({
      emisor: 'gateway',
      destinatario: 'ms-identidad',
      secreto: CLAVE,
    });

    expect(cabecera['Authorization']).toMatch(/^Servicio ey/);
    expect(cabecera['Authorization']).not.toMatch(/^Bearer/);
  });

  test('sin clave falla al firmar, no emite un token invalido', () => {
    // Que reviente aqui y no en el otro extremo: un fallo de configuracion tiene
    // que notarse donde esta el fallo.
    expect(() =>
      firmarTokenDeServicio({ emisor: 'gateway', destinatario: 'ms-identidad', secreto: undefined }),
    ).toThrow(/SERVICIO_JWT_SECRET/);
  });
});

describe('Extraccion de la cabecera', () => {
  test('acepta el esquema Servicio, en cualquier caja', () => {
    expect(extraerTokenDeServicio({ authorization: 'Servicio abc' })).toBe('abc');
    expect(extraerTokenDeServicio({ authorization: 'servicio abc' })).toBe('abc');
  });

  test('NO acepta Bearer', () => {
    // Es la segunda barrera: aunque alguien se equivocara de secreto, un token
    // de usuario no puede colarse por aqui.
    expect(extraerTokenDeServicio({ authorization: 'Bearer abc' })).toBeUndefined();
  });

  test('sin cabecera o sin valor devuelve undefined', () => {
    expect(extraerTokenDeServicio({})).toBeUndefined();
    expect(extraerTokenDeServicio({ authorization: 'Servicio' })).toBeUndefined();
  });
});

describe('Verificacion', () => {
  test('un token bien firmado pasa y dice quien llamo', () => {
    const resultado = verificar(firmar());

    expect(resultado.valido).toBe(true);
    if (resultado.valido) {
      expect(resultado.claims.iss).toBe('gateway');
      expect(resultado.claims.aud).toBe('ms-identidad');
    }
  });

  test('un token dirigido a OTRO servicio no vale', () => {
    // `aud` explicito: robar una llamada a ms-identidad no da acceso a
    // ms-financiero.
    const resultado = verificar(firmar({ destinatario: 'ms-financiero' }));
    expect(resultado.valido).toBe(false);
  });

  test('un token firmado con otra clave no vale', () => {
    const resultado = verificar(firmar({ secreto: 'otra-clave' }));
    expect(resultado.valido).toBe(false);
  });

  test('un token caducado no vale', () => {
    const caducado = jwt.sign({}, CLAVE, {
      issuer: 'gateway',
      audience: 'ms-identidad',
      expiresIn: -120,
    });

    expect(verificar(caducado).valido).toBe(false);
  });

  test('un token de USUARIO no vale, ni con la cabecera correcta', () => {
    // El escenario que obliga a que los dos secretos sean distintos: si
    // compartieran clave, cualquier inquilino podria llamar a /interno.
    const tokenDeUsuario = jwt.sign(
      { sub: 'u1', email: 'a@b.c', roles: ['INQUILINO'], jti: 'j1' },
      CLAVE_DE_USUARIO,
      { expiresIn: '1h' },
    );

    expect(verificar(tokenDeUsuario).valido).toBe(false);
  });

  test('sin credencial responde 401 con el mensaje generico', () => {
    const resultado = verificarTokenDeServicio(
      {},
      { destinatario: 'ms-identidad', secreto: CLAVE },
    );

    expect(resultado.valido).toBe(false);
    if (!resultado.valido) {
      expect(resultado.estado).toBe(401);
      expect(resultado.error.mensaje).toBe(MENSAJE_SERVICIO_NO_AUTENTICADO);
    }
  });

  test('todos los fallos responden lo mismo, sin dar pistas', () => {
    // No distinguir entre "no mandaste nada", "firma mala" y "caducado" evita
    // que probando se aprenda que falta.
    const respuestas = [
      verificarTokenDeServicio({}, { destinatario: 'ms-identidad', secreto: CLAVE }),
      verificar('no-es-un-token'),
      verificar(firmar({ secreto: 'otra-clave' })),
      verificar(firmar({ destinatario: 'otro' })),
    ];

    for (const respuesta of respuestas) {
      expect(respuesta.valido).toBe(false);
      if (!respuesta.valido) {
        expect(respuesta.estado).toBe(401);
        expect(respuesta.error.mensaje).toBe(MENSAJE_SERVICIO_NO_AUTENTICADO);
      }
    }
  });
});

describe('Emisores y claves', () => {
  test('se puede restringir quien llama', () => {
    const token = firmar({ emisor: 'ms-financiero' });

    expect(verificar(token, { emisoresPermitidos: ['gateway'] }).valido).toBe(false);
    expect(verificar(token, { emisoresPermitidos: ['gateway', 'ms-financiero'] }).valido).toBe(true);
  });

  test('la clave se puede resolver por emisor', () => {
    // Es la costura por la que se pasara a clave por servicio sin rediseñar:
    // hoy `resolverClave` devuelve siempre la misma, mañana una por emisor.
    const claves: Record<string, string> = { gateway: 'clave-del-gateway' };
    const token = firmar({ secreto: 'clave-del-gateway' });

    const resultado = verificarTokenDeServicio(
      { authorization: `Servicio ${token}` },
      { destinatario: 'ms-identidad', resolverClave: (emisor) => claves[emisor] },
    );

    expect(resultado.valido).toBe(true);
  });

  test('un emisor sin clave conocida se rechaza', () => {
    const token = firmar({ emisor: 'desconocido' });

    const resultado = verificarTokenDeServicio(
      { authorization: `Servicio ${token}` },
      { destinatario: 'ms-identidad', resolverClave: () => undefined },
    );

    expect(resultado.valido).toBe(false);
  });
});

describe('Middleware', () => {
  const respuestaFalsa = () => {
    const estado = { codigo: 0, cuerpo: null as unknown };
    return {
      res: {
        status(codigo: number) {
          estado.codigo = codigo;
          return {
            json(cuerpo: unknown) {
              estado.cuerpo = cuerpo;
              return cuerpo;
            },
          };
        },
      },
      estado,
    };
  };

  test('deja pasar con credencial valida y cuelga quien llamo', () => {
    const middleware = exigirServicio({ destinatario: 'ms-identidad', secreto: CLAVE });
    const req: { headers: Record<string, string>; servicioLlamante?: ClaimsServicio } = {
      headers: { authorization: `${ESQUEMA_SERVICIO} ${firmar()}` },
    };
    const { res, estado } = respuestaFalsa();
    let siguio = false;

    middleware(req, res, () => {
      siguio = true;
    });

    expect(siguio).toBe(true);
    expect(estado.codigo).toBe(0);
    expect(req.servicioLlamante?.iss).toBe('gateway');
  });

  test('corta con 401 sin credencial', () => {
    const middleware = exigirServicio({ destinatario: 'ms-identidad', secreto: CLAVE });
    const { res, estado } = respuestaFalsa();
    let siguio = false;

    middleware({ headers: {} }, res, () => {
      siguio = true;
    });

    expect(siguio).toBe(false);
    expect(estado.codigo).toBe(401);
  });
});
