/**
 * La IP del cliente firmada por el gateway.
 *
 * Lo que se fija: que la IP firmada se recupere, que una cabecera inventada o
 * dirigida a otro servicio no valga, que cada firma sea unica, y que un token de
 * origen y uno de servicio no sirvan el uno por el otro.
 */

import jwt from 'jsonwebtoken';

import {
  CABECERA_ORIGEN_CLIENTE,
  audienciaDeOrigen,
  firmarOrigenCliente,
  verificarOrigenCliente,
} from '../src/origen';
import { firmarTokenDeServicio, verificarTokenDeServicio } from '../src/servicio';

const SECRETO = 'clave-de-servicio-para-pruebas';

const firmar = (ip: string, extra: Partial<{ destinatario: string; secreto: string }> = {}) =>
  firmarOrigenCliente({
    ip,
    emisor: 'gateway',
    destinatario: 'ms-identidad',
    secreto: SECRETO,
    ...extra,
  });

const verificar = (valor: string | undefined) =>
  verificarOrigenCliente(valor, { destinatario: 'ms-identidad', secreto: SECRETO });

describe('Origen del cliente firmado', () => {
  test('la cabecera se llama x-origen-cliente', () => {
    expect(CABECERA_ORIGEN_CLIENTE).toBe('x-origen-cliente');
  });

  test('recupera la IP firmada', () => {
    expect(verificar(firmar('203.0.113.7'))).toBe('203.0.113.7');
  });

  test('sin cabecera, con basura o firmada con otro secreto: null', () => {
    expect(verificar(undefined)).toBeNull();
    expect(verificar('no-es-un-token')).toBeNull();
    expect(verificar(firmar('203.0.113.7', { secreto: 'otra-clave' }))).toBeNull();
  });

  test('una firma para otro servicio no vale aqui', () => {
    expect(verificar(firmar('203.0.113.7', { destinatario: 'ms-contratos' }))).toBeNull();
  });

  test('cada firma es unica aunque la IP sea la misma', () => {
    const primera = firmar('203.0.113.7');
    const segunda = firmar('203.0.113.7');

    expect(primera).not.toBe(segunda);
    expect((jwt.decode(primera) as jwt.JwtPayload).jti).not.toBe(
      (jwt.decode(segunda) as jwt.JwtPayload).jti,
    );
  });

  test('un token de origen NO sirve como credencial de servicio', () => {
    const origen = firmar('203.0.113.7');

    const resultado = verificarTokenDeServicio(
      { authorization: `Servicio ${origen}` },
      { destinatario: 'ms-identidad', secreto: SECRETO },
    );

    expect(resultado.valido).toBe(false);
    expect((jwt.decode(origen) as jwt.JwtPayload).aud).toBe(audienciaDeOrigen('ms-identidad'));
  });

  test('un token de servicio NO sirve como origen', () => {
    const servicio = firmarTokenDeServicio({
      emisor: 'gateway',
      destinatario: 'ms-identidad',
      secreto: SECRETO,
    });

    expect(verificar(servicio)).toBeNull();
  });
});
