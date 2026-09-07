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
import { generarContrasenaTemporal } from '../services/contrasenaTemporal';
import {
  emitirToken,
  estaRevocado,
  fechaDeExpiracion,
  revocarToken,
  rolPrincipal,
} from '../services/tokenService';

export const CAMPOS_OBLIGATORIOS = ['nombres', 'apellidos', 'email', 'contrasena', 'documento'] as const;

/** Los mismos, menos la contrasena: en el alta por terceros la genera el servicio. */
export const CAMPOS_SIN_CONTRASENA = ['nombres', 'apellidos', 'email', 'documento'] as const;

/** Minimo de la contrasena que elige la persona. */
export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Devuelve el nombre del primer campo obligatorio que falte, o null. */
export const campoFaltante = (
  cuerpo: Record<string, unknown> | undefined,
  campos: readonly string[] = CAMPOS_OBLIGATORIOS,
): string | null => campos.find((campo) => !cuerpo || !cuerpo[campo]) ?? null;

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
  /**
   * Sólo cuando la generó el servicio. Es la ÚNICA vez que existe en claro
   * fuera de la memoria del proceso: no se guarda, no se registra y no hay
   * endpoint que la devuelva después. Ver docs/adr/0007.
   */
  contrasenaTemporal?: string;
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
  generarContrasena = false,
}: {
  cuerpo: Record<string, string>;
  rol: string;
  idAutor?: string | null;
  /**
   * Cuando es `true` el servicio inventa la contrasena y marca al usuario para
   * que la cambie. Se usa en el alta por terceros: el propietario no tiene por
   * que elegir la credencial de otra persona.
   */
  generarContrasena?: boolean;
}): Promise<ResultadoAlta> => {
  const { nombres, apellidos, email, telefono, documento } = cuerpo;
  const contrasena = generarContrasena
    ? generarContrasenaTemporal()
    : (cuerpo['contrasena'] as string);

  if (await Usuario.findOne({ where: { email } })) {
    return { error: { estado: 400, mensaje: 'El email ya está registrado' } };
  }

  if (await Usuario.findOne({ where: { documento } })) {
    return { error: { estado: 400, mensaje: 'El documento ya está registrado' } };
  }

  const idUsuario = crypto.randomUUID();
  const autor = idAutor ?? idUsuario;
  const hash = await bcrypt.hash(contrasena, 10);

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
        // Marcado sólo si la contrasena no la eligio el usuario.
        debe_cambiar_contrasena: generarContrasena,
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

  return generarContrasena ? { usuario, contrasenaTemporal: contrasena } : { usuario };
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
        // Para que la SPA lleve directo a la pantalla de cambio en vez de
        // chocarse con un 403 en la primera peticion. Ver docs/adr/0007.
        debe_cambiar_contrasena: usuario.debe_cambiar_contrasena === true,
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

/**
 * POST /api/auth/cambiar-contrasena — ruta protegida.
 *
 * Es lo unico que puede hacer un usuario marcado con cambio obligatorio, y esta
 * disponible tambien para quien quiera cambiarla por gusto.
 *
 * Al terminar REVOCA el token en curso y emite uno nuevo. Sin eso, el token
 * viejo seguiria siendo valido durante su hora de vida y seguiria afirmando en
 * sus claims que hace falta cambiar la contrasena: el usuario quedaria atrapado
 * en la pantalla de cambio despues de haberla cambiado.
 */
export const cambiarContrasena = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { contrasena_actual, contrasena_nueva } = req.body ?? {};

    if (!contrasena_actual || !contrasena_nueva) {
      return res
        .status(400)
        .json(crearError('La contraseña actual y la nueva son obligatorias'));
    }

    if (String(contrasena_nueva).length < LONGITUD_MINIMA_CONTRASENA) {
      return res
        .status(400)
        .json(
          crearError(
            `La contraseña nueva debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`,
          ),
        );
    }

    if (contrasena_actual === contrasena_nueva) {
      // Si no, un usuario marcado podria "cambiarla" por la misma temporal y
      // quitarse el indicador sin haber cambiado nada.
      return res.status(400).json(crearError('La contraseña nueva debe ser distinta de la actual'));
    }

    const claims = req.usuario!;
    const usuario = await Usuario.findByPk(claims.sub);
    if (!usuario) {
      return res.status(404).json(crearError('Usuario no encontrado'));
    }

    if (!(await bcrypt.compare(contrasena_actual, usuario.contrasena))) {
      return res.status(401).json(crearError('Contraseña incorrecta'));
    }

    await usuario.update(
      {
        contrasena: await bcrypt.hash(contrasena_nueva, 10),
        debe_cambiar_contrasena: false,
      },
      { usuarioAuditor: usuario.id_usuario } as never,
    );

    // El token en curso todavia dice `debe_cambiar: true`: se revoca y se emite
    // otro con el estado real.
    if (!(await estaRevocado(claims.jti))) {
      await revocarToken(claims.jti, fechaDeExpiracion(claims));
    }

    const roles = await rolesDe(usuario.id_usuario);
    const { token, tipo_token, expiracion } = emitirToken(usuario, roles);

    return res.json({
      mensaje: 'Contraseña actualizada',
      token,
      tipo_token,
      expiracion,
      usuario: {
        id: usuario.id_usuario,
        rol: rolPrincipal(roles),
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        email: usuario.email,
        roles,
        debe_cambiar_contrasena: false,
      },
    });
  } catch (error) {
    // Nunca se registra el cuerpo: llevaria las dos contrasenas en claro.
    console.error('Error al cambiar la contraseña:', (error as Error).message);
    return res.status(500).json(crearError('Error al cambiar la contraseña'));
  }
};
