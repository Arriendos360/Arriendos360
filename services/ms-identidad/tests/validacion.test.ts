/**
 * Validación de las altas de usuario: un 400 con `errores` por campo, todos a la
 * vez y sin dejar nada creado.
 */

import request from 'supertest';

import {
  app,
  cerrarBase,
  conToken,
  eventosDeSalida,
  recrearBase,
  registrarPropietario,
  type Sesion,
} from './utiles/entorno';
import { Usuario } from '../src/models/Usuario';

let propietario: Sesion;

const persona = {
  nombres: 'Ana',
  apellidos: 'Ruiz',
  documento: '20000001',
  telefono: '3001234567',
  email: 'ana@validacion.test',
};

const registrar = (cuerpo: Record<string, unknown>) => request(app).post('/api/auth/registro').send(cuerpo);

const darDeAlta = (cuerpo: Record<string, unknown>) =>
  request(app).post('/api/usuarios/inquilinos').set(...conToken(propietario.token)).send(cuerpo);

const campos = (respuesta: request.Response): string[] =>
  (respuesta.body.errores as { campo: string }[]).map((error) => error.campo);

const temporalesEmitidas = async (): Promise<number> =>
  (await eventosDeSalida('ContrasenaTemporalEmitida')).length;

beforeAll(async () => {
  await recrearBase();
  propietario = await registrarPropietario({
    email: 'dueno@validacion.test',
    nombres: 'Dueño',
    apellidos: 'Valida',
    documento: '20000000',
  });
});

afterAll(async () => {
  await cerrarBase();
});

describe('POST /api/auth/registro', () => {
  test.each([
    ['nombres', { nombres: 'Juan123' }],
    ['apellidos', { apellidos: 'A' }],
    ['apellidos', { apellidos: 'a'.repeat(101) }],
    ['documento', { documento: 'jnkjbn3kj2b3jh234b2j' }],
    ['documento', { documento: '1.020.304' }],
    ['telefono', { telefono: 'n2jk4b24jh2b34j2' }],
    ['telefono', { telefono: '6012345678' }],
    ['email', { email: 'ana.correo.com' }],
    ['email', { email: `${'a'.repeat(140)}@correo.com` }],
    ['contrasena', { contrasena: 'corta' }],
  ])('%s inválido: 400 en su campo y nada creado', async (campo, cambio) => {
    const antes = await Usuario.count();
    const respuesta = await registrar({ ...persona, contrasena: 'segura123', ...cambio });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo, mensaje: expect.any(String) }]);
    expect(respuesta.body.mensaje).toBe(respuesta.body.errores[0].mensaje);
    expect(await Usuario.count()).toBe(antes);
  });

  test('INC-001: varios errores a la vez, mensaje igual al primero', async () => {
    const antes = await Usuario.count();
    const respuesta = await registrar({
      ...persona,
      nombres: 'Juan123',
      documento: 'jnkjbn3kj2b3jh234b2j',
      telefono: 'n2jk4b24jh2b34j2',
      contrasena: 'segura123',
    });

    expect(respuesta.status).toBe(400);
    expect(campos(respuesta)).toEqual(['nombres', 'documento', 'telefono']);
    expect(respuesta.body.mensaje).toBe(respuesta.body.errores[0].mensaje);
    expect(await Usuario.count()).toBe(antes);
  });

  test('guarda nombres y celular normalizados, y el email recortado con sus mayúsculas', async () => {
    const respuesta = await registrar({
      ...persona,
      nombres: '  María   José ',
      telefono: '+57 (300) 123-4567',
      email: ' Ana@Correo.com ',
      contrasena: 'segura123',
    });

    expect(respuesta.status).toBe(201);
    const usuario = await Usuario.findByPk(respuesta.body.usuario.id);
    expect(usuario?.nombres).toBe('María José');
    expect(usuario?.telefono).toBe('3001234567');
    expect(usuario?.email).toBe('Ana@Correo.com');
  });

  test('email y documento repetidos responden en su campo', async () => {
    const email = await registrar({ ...persona, email: propietario.email, documento: '20000009', contrasena: 'segura123' });
    expect(email.status).toBe(400);
    expect(email.body.errores).toEqual([{ campo: 'email', mensaje: 'El email ya está registrado' }]);

    const documento = await registrar({ ...persona, email: 'otra@validacion.test', documento: propietario.documento, contrasena: 'segura123' });
    expect(documento.status).toBe(400);
    expect(documento.body.errores).toEqual([{ campo: 'documento', mensaje: 'El documento ya está registrado' }]);
  });
});

describe('POST /api/usuarios/inquilinos', () => {
  test.each([
    ['nombres', { nombres: '1468498' }],
    ['apellidos', { apellidos: '4642684' }],
    ['documento', { documento: 'dasnsjdoasjdoaj' }],
    ['telefono', { telefono: '97wqqewqeqeq' }],
    ['email', { email: 'sin-arroba' }],
  ])('%s inválido: 400 en su campo, sin usuario ni temporal', async (campo, cambio) => {
    const [usuarios, temporales] = [await Usuario.count(), await temporalesEmitidas()];
    const respuesta = await darDeAlta({ ...persona, email: 'inq@validacion.test', documento: '20000005', ...cambio });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo, mensaje: expect.any(String) }]);
    expect(await Usuario.count()).toBe(usuarios);
    expect(await temporalesEmitidas()).toBe(temporales);
  });

  test('INC-003: un error por cada campo basura, sin contraseña temporal', async () => {
    const temporales = await temporalesEmitidas();
    const respuesta = await darDeAlta({
      ...persona,
      nombres: '1468498',
      apellidos: '4642684',
      documento: 'dasnsjdoasjdoaj',
      telefono: '97wqqewqeqeq',
    });

    expect(respuesta.status).toBe(400);
    expect(campos(respuesta)).toEqual(['nombres', 'apellidos', 'documento', 'telefono']);
    expect(respuesta.body.contrasena_temporal).toBeUndefined();
    expect(await temporalesEmitidas()).toBe(temporales);
  });

  test('ignora la contraseña del cuerpo y genera la temporal', async () => {
    const respuesta = await darDeAlta({ ...persona, email: 'inq2@validacion.test', documento: '20000006', contrasena: 'x' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrasena_temporal).toEqual(expect.any(String));
  });
});
