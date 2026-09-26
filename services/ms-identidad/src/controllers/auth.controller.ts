/**
 * Autenticación: registro, login, logout, cambio y recuperación de contraseña.
 * El login fallido responde lo mismo exista o no la cuenta.
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
  consultar,
  contar,
  enmascararEmail,
  grupoDeIp,
  ipDeOrigen,
  limite,
  normalizarEmail,
  responderLimite,
} from '../services/limites';
import {
  registrarContrasenaTemporalEmitida,
  registrarRecuperacionSolicitada,
} from '../eventos';
import {
  buscarTokenVigente,
  emitirTokenDeRecuperacion,
  marcarUsado,
} from '../services/recuperacion';
import {
  emitirToken,
  estaRevocado,
  fechaDeExpiracion,
  marcaDeCambio,
  revocarToken,
  rolPrincipal,
} from '../services/tokenService';

export const CAMPOS_OBLIGATORIOS = ['nombres', 'apellidos', 'email', 'contrasena', 'documento'] as const;

/** Los mismos, menos la contrasena: en el alta por terceros la genera el servicio. */
export const CAMPOS_SIN_CONTRASENA = ['nombres', 'apellidos', 'email', 'documento'] as const;

/** Minimo de la contrasena que elige la persona. */
export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Unica respuesta del login fallido, exista o no la cuenta. */
export const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos';

/**
 * Hash contra el que se compara cuando el correo no existe, para que el tiempo de
 * respuesta no revele qué correos están registrados.
 */
let hashFicticio: string | null = null;
const hashDeComparacion = (): string =>
  (hashFicticio ??= bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10));

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
  /** Sólo cuando la generó el servicio. No se guarda ni se registra en ningún sitio. */
  contrasenaTemporal?: string;
  error?: { estado: number; mensaje: string };
}

/**
 * Alta de usuario con un rol concreto. `idAutor` queda en la auditoría; en el
 * autorregistro es el propio usuario.
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
  /** Genera una contraseña temporal y marca al usuario para que la cambie. */
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

    // Sólo el alta por terceros avisa a la persona de que su cuenta existe.
    if (generarContrasena) {
      await registrarContrasenaTemporalEmitida(
        { idUsuario, motivo: 'ALTA' },
        transaccion,
      );
    }

    return nuevo;
  });

  return generarContrasena ? { usuario, contrasenaTemporal: contrasena } : { usuario };
};

/**
 * POST /api/auth/registro — ruta pública. Crea siempre un PROPIETARIO; los
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
 * POST /api/auth/login — ruta pública. Responde `token`, `tipo_token`,
 * `expiracion` y `usuario` con `id` y `rol`.
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

    // Límite de fallos por cuenta e IP: se consulta antes de comparar y sólo suma
    // si falla, exista o no el correo.
    const fallos = limite('loginFallidosPorCuentaEIp');
    const cuentaEIp = [normalizarEmail(email), grupoDeIp(ipDeOrigen(req))];
    if ((await consultar(fallos, cuentaEIp)) >= fallos.maximo) {
      return responderLimite(res, fallos);
    }

    const usuario = await Usuario.findOne({ where: { email } });

    // Siempre se compara con bcrypt y se da la misma respuesta, exista o no la cuenta.
    const coincide = await bcrypt.compare(
      String(contrasena),
      usuario?.contrasena ?? hashDeComparacion(),
    );

    if (!usuario || !coincide) {
      await contar(fallos, cuentaEIp);
      return res.status(401).json(crearError(MENSAJE_CREDENCIALES));
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
        // Datos para la barra superior de la SPA.
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        email: usuario.email,
        roles,
        // Lleva a la SPA directo a la pantalla de cambio.
        debe_cambiar_contrasena: usuario.debe_cambiar_contrasena === true,
      },
    });
  } catch (error) {
    console.error('Error en controlador login:', error);
    return res.status(500).json(crearError('Error al iniciar sesión'));
  }
};

/**
 * POST /api/auth/logout — ruta protegida. Revoca el `jti` del token hasta su
 * expiración natural.
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
 * POST /api/auth/cambiar-contrasena — ruta protegida. Invalida todas las sesiones
 * del usuario, revoca el token en curso y devuelve uno nuevo.
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

    // Invalida todas las sesiones; el token nuevo se ancla a esta marca.
    const marca = marcaDeCambio();

    await usuario.update(
      {
        contrasena: await bcrypt.hash(contrasena_nueva, 10),
        debe_cambiar_contrasena: false,
        contrasena_cambiada_en: marca,
      },
      { usuarioAuditor: usuario.id_usuario } as never,
    );

    if (!(await estaRevocado(claims.jti))) {
      await revocarToken(claims.jti, fechaDeExpiracion(claims));
    }

    const roles = await rolesDe(usuario.id_usuario);
    const { token, tipo_token, expiracion } = emitirToken(usuario, roles, { noAntesDe: marca });

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

/**
 * POST /api/auth/recuperar — ruta pública. Responde siempre lo mismo, exista o no
 * la cuenta. Guarda el token y anota `RecuperacionSolicitada` en una transacción;
 * el correo lo envía ms-notificaciones.
 */
export const recuperar = async (req: Request, res: Response): Promise<Response> => {
  const respuestaUnica = {
    mensaje:
      'Si el correo corresponde a una cuenta, te enviaremos un enlace para restablecer tu contraseña.',
  };

  try {
    const { email } = req.body ?? {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json(crearError('El email es obligatorio'));
    }

    // Límite por cuenta, silencioso: pasado el máximo no se emite enlace, pero la
    // respuesta es la de siempre. Se registra la primera vez que salta.
    const porCuenta = limite('recuperarPorCuenta');
    const solicitudes = await contar(porCuenta, [normalizarEmail(email)]);
    if (solicitudes > porCuenta.maximo) {
      if (solicitudes === porCuenta.maximo + 1) {
        console.warn(
          `⚠️  ms-identidad: límite de recuperación por cuenta alcanzado para ${enmascararEmail(email)}: ` +
            `más de ${porCuenta.maximo} solicitudes en ${porCuenta.ventanaSegundos / 60} min. ` +
            'No se emiten más enlaces en esta ventana; la respuesta sigue siendo la de siempre.',
        );
      }
      return res.json(respuestaUnica);
    }

    const usuario = await Usuario.findOne({ where: { email } });

    if (usuario) {
      await sequelize.transaction(async (transaccion) => {
        const { token, expiraEn } = await emitirTokenDeRecuperacion(
          usuario.id_usuario,
          transaccion,
        );

        // El enlace lo arma ms-notificaciones.
        await registrarRecuperacionSolicitada(
          { idUsuario: usuario.id_usuario, token, expiraEn },
          transaccion,
        );
      });
    }

    return res.json(respuestaUnica);
  } catch (error) {
    // Ni un fallo interno cambia la respuesta.
    console.error('Error en recuperación:', (error as Error).message);
    return res.json(respuestaUnica);
  }
};

/**
 * POST /api/auth/restablecer — ruta pública. Con un token vigente cambia la
 * contraseña, lo marca usado e invalida todas las sesiones del usuario.
 */
export const restablecer = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { token, contrasena_nueva } = req.body ?? {};

    if (!token || !contrasena_nueva) {
      return res.status(400).json(crearError('El token y la contraseña nueva son obligatorios'));
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

    const registro = await buscarTokenVigente(token);
    if (!registro) {
      // Un mismo 400 para inexistente, vencido y ya usado.
      return res.status(400).json(crearError('El enlace no es válido o ya expiró'));
    }

    const usuario = await Usuario.findByPk(registro.id_usuario);
    if (!usuario) {
      return res.status(400).json(crearError('El enlace no es válido o ya expiró'));
    }

    await usuario.update(
      {
        contrasena: await bcrypt.hash(contrasena_nueva, 10),
        debe_cambiar_contrasena: false,
        contrasena_cambiada_en: marcaDeCambio(),
      },
      { usuarioAuditor: usuario.id_usuario } as never,
    );

    await marcarUsado(registro);

    // No se devuelve token: se vuelve a entrar por el login.
    return res.json({ mensaje: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error al restablecer la contraseña:', (error as Error).message);
    return res.status(500).json(crearError('Error al restablecer la contraseña'));
  }
};
