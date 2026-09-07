/**
 * Autenticacion: registro publico, login y logout.
 *
 * Es el mismo comportamiento que servia el monolito, portado a TypeScript. Los
 * mensajes y codigos de estado se conservan literalmente para que el cambio no
 * se note desde el frontend ni desde la coleccion de Postman.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { ROLES, ROL_PROPIETARIO } from '../models/constantes';
import { Rol } from '../models/Rol';
import { RolUsuario } from '../models/RolUsuario';
import { Usuario } from '../models/Usuario';
import { emitirToken, fechaDeExpiracion, revocarToken, rolPrincipal } from '../services/tokenService';

export const CAMPOS_OBLIGATORIOS = ['nombres', 'apellidos', 'email', 'contrasena', 'documento'] as const;

/** Devuelve el nombre del primer campo obligatorio que falte, o null. */
export const campoFaltante = (cuerpo: Record<string, unknown> | undefined): string | null =>
  CAMPOS_OBLIGATORIOS.find((campo) => !cuerpo || !cuerpo[campo]) ?? null;

/** Nombres de rol de un usuario, en mayusculas, tal como van en los claims. */
export const rolesDe = async (idUsuario: string): Promise<string[]> => {
  const filas = await RolUsuario.findAll({
    where: { id_usuario: idUsuario },
    include: [{ model: Rol, attributes: ['nombre'] }],
  });

  return filas.map((fila) => (fila.Rol as Rol).nombre);
};

export interface ResultadoAlta {
  usuario?: Usuario;
  error?: { estado: number; mensaje: string };
}

/**
 * Alta de usuario con un rol concreto.
 *
 * `idAutor` es quien queda registrado en las columnas de auditoria. En el
 * autorregistro no hay usuario autenticado, asi que se pasa el UUID del propio
 * usuario que se esta creando: lo conocemos porque lo generamos antes del
 * INSERT, que es para lo que sirve generar los identificadores en la aplicacion.
 */
export const crearUsuarioConRol = async ({
  cuerpo,
  rol,
  idAutor = null,
}: {
  cuerpo: Record<string, string>;
  rol: string;
  idAutor?: string | null;
}): Promise<ResultadoAlta> => {
  const { nombres, apellidos, email, contrasena, telefono, documento } = cuerpo;

  if (await Usuario.findOne({ where: { email } })) {
    return { error: { estado: 400, mensaje: 'El email ya está registrado' } };
  }

  if (await Usuario.findOne({ where: { documento } })) {
    return { error: { estado: 400, mensaje: 'El documento ya está registrado' } };
  }

  const idUsuario = crypto.randomUUID();
  const autor = idAutor ?? idUsuario;
  const hash = await bcrypt.hash(contrasena as string, 10);

  const usuario = await sequelize.transaction(async (transaccion) => {
    const nuevo = await Usuario.create(
      {
        id_usuario: idUsuario,
        nombres,
        apellidos,
        email,
        contrasena: hash,
        telefono,
        documento,
        creado_por: autor,
      },
      { transaction: transaccion, usuarioAuditor: autor } as never,
    );

    await RolUsuario.create(
      { id_rol: ROLES[rol], id_usuario: idUsuario, creado_por: autor },
      { transaction: transaccion, usuarioAuditor: autor } as never,
    );

    return nuevo;
  });

  return { usuario };
};

/**
 * POST /api/auth/registro — ruta publica.
 *
 * El contrato de interfaz del Capitulo 2 no lleva campo `rol`: la asignacion se
 * maneja internamente. El registro publico crea siempre un PROPIETARIO. Los
 * inquilinos se dan de alta desde POST /api/usuarios/inquilinos.
 */
export const registrar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const faltante = campoFaltante(req.body);
    if (faltante) {
      return res.status(400).json(crearError(`El campo ${faltante} es obligatorio`));
    }

    const { error, usuario } = await crearUsuarioConRol({
      cuerpo: req.body,
      rol: ROL_PROPIETARIO,
    });

    if (error) {
      return res.status(error.estado).json(crearError(error.mensaje));
    }

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario: {
        id: usuario!.id_usuario,
        email: usuario!.email,
        rol: ROL_PROPIETARIO,
        nombres: usuario!.nombres,
      },
    });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    return res.status(500).json(crearError('Error al registrar usuario'));
  }
};

/**
 * POST /api/auth/login — ruta publica.
 *
 * Respuesta segun el Capitulo 2: `token`, `tipo_token`, `expiracion` y `usuario`
 * con `id` y `rol` singular.
 */
export const login = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, contrasena } = req.body ?? {};

    if (!email || !contrasena) {
      return res.status(400).json(crearError('El email y la contraseña son obligatorios'));
    }

    if (!process.env['JWT_SECRET']) {
      console.error('ERROR: JWT_SECRET no está definido en el entorno');
      return res.status(500).json(crearError('Error de configuración en el servidor'));
    }

    const usuario = await Usuario.findOne({ where: { email } });
    if (!usuario) {
      return res.status(404).json(crearError('Usuario no encontrado'));
    }

    if (!(await bcrypt.compare(contrasena, usuario.contrasena))) {
      return res.status(401).json(crearError('Contraseña incorrecta'));
    }

    const roles = await rolesDe(usuario.id_usuario);
    const { token, tipo_token, expiracion } = emitirToken(usuario, roles);

    return res.json({
      mensaje: 'Login exitoso',
      token,
      tipo_token,
      expiracion,
      usuario: {
        id: usuario.id_usuario,
        rol: rolPrincipal(roles),
        // Fuera del contrato minimo, pero la SPA los pinta en la barra superior
        // y pedirlos aparte seria una llamada de mas.
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        email: usuario.email,
        roles,
      },
    });
  } catch (error) {
    console.error('Error en controlador login:', error);
    return res.status(500).json(crearError('Error al iniciar sesión'));
  }
};

/**
 * POST /api/auth/logout — ruta protegida, cuerpo vacio.
 *
 * Registra el `jti` del token en la lista de revocados hasta su expiracion
 * natural. A partir de ahi el middleware lo rechaza con 401 aunque la firma siga
 * siendo valida, que es todo el punto de tener `jti` en los claims.
 */
export const logout = async (req: Request, res: Response): Promise<Response> => {
  try {
    const claims = req.usuario!;
    await revocarToken(claims.jti, fechaDeExpiracion(claims));
    return res.json({ mensaje: 'Sesión cerrada' });
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    return res.status(500).json(crearError('Error al cerrar sesión'));
  }
};
