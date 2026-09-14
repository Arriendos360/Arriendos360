/**
 * Autenticacion: registro publico, login y logout.
 *
 * Es el mismo comportamiento que servia el monolito, portado a TypeScript. Los
 * mensajes y codigos de estado se conservan literalmente para que el cambio no
 * se note desde el frontend ni desde la coleccion de Postman.
 *
 * Con una excepcion deliberada: el login fallido responde lo mismo exista o no la
 * cuenta, y las rutas publicas llevan limitacion de tasa. Ver `docs/adr/0020`.
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
 * Hash contra el que se compara cuando el correo no existe.
 *
 * Igualar el mensaje no basta: si con un correo desconocido se saltara
 * `bcrypt.compare`, la respuesta llegaria decenas de milisegundos antes y el tiempo
 * seguiria diciendo que correos estan registrados. Mismo coste (10) que los hashes
 * reales. Se calcula la primera vez que hace falta y se reutiliza.
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

    // ── EL AVISO SOLO SALE EN EL ALTA POR TERCEROS ─────────────────────────
    //
    // `generarContrasena` es exactamente la condicion que distingue los dos
    // caminos, y por eso el evento cuelga de ella: quien se autorregistra eligio
    // su contrasena y sabe perfectamente que tiene una cuenta — avisarselo por
    // correo seria ruido. Quien fue dado de alta por su arrendador no pidio nada,
    // y hasta el paso 7 no se enteraba de que existia una cuenta a su nombre.
    //
    // Dentro de la transaccion, como siempre: un correo que dice «se creó tu
    // cuenta» sobre una cuenta que no se creo seria peor que no mandarlo.
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

    // Fallos por cuenta e IP: se consulta ANTES de comparar y solo suma si falla.
    // Fallar el login de alguien bloquea la IP del atacante para esa cuenta, no a la
    // victima, que entra desde la suya. Cuenta igual si el correo no existe: si no,
    // el propio 429 diria que correos estan registrados.
    const fallos = limite('loginFallidosPorCuentaEIp');
    const cuentaEIp = [normalizarEmail(email), grupoDeIp(ipDeOrigen(req))];
    if ((await consultar(fallos, cuentaEIp)) >= fallos.maximo) {
      return responderLimite(res, fallos);
    }

    const usuario = await Usuario.findOne({ where: { email } });

    // UNA respuesta para «no existe» y «contrasena mal», y bcrypt.compare en los dos
    // casos. Con mensajes distintos, o con un correo desconocido respondido antes por
    // saltarse la comparacion, el login seria un verificador de cuentas.
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

    // Tira todas las sesiones del usuario, incluida la que hizo esta peticion.
    // El token que se emite abajo se ancla a esta misma marca para no caer con
    // las demas.
    const marca = marcaDeCambio();

    await usuario.update(
      {
        contrasena: await bcrypt.hash(contrasena_nueva, 10),
        debe_cambiar_contrasena: false,
        contrasena_cambiada_en: marca,
      },
      { usuarioAuditor: usuario.id_usuario } as never,
    );

    // El token en curso todavia dice `debe_cambiar: true`: se revoca y se emite
    // otro con el estado real.
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
 * POST /api/auth/recuperar — ruta publica.
 *
 * RESPONDE SIEMPRE LO MISMO, exista o no la cuenta. Es el requisito central de
 * este endpoint: si la respuesta cambiara, la API seria un verificador de
 * cuentas registradas —se prueban correos y se apunta cuales existen— y eso es
 * un dato personal que no hay motivo para regalar.
 *
 * Por la misma razon no se responde 404 con un email desconocido ni 429 con uno
 * conocido: cualquier diferencia observable sirve de oraculo.
 *
 * ── EL PASO 7 CAMBIA LA GARANTIA, Y POR ESO CAMBIA EL MENSAJE ──────────────
 *
 * Antes el correo salia DENTRO de esta peticion, asi que al responder ya se sabia
 * si habia salido. Ahora esto solo anota el evento y el correo lo manda
 * ms-notificaciones despues: la ventana esperada son los ~5 s del publicador mas lo
 * que tarde el envio.
 *
 * Asi que «recibirás un enlace» pasa a «te enviaremos un enlace», y la diferencia
 * no es de redaccion. Lo primero afirmaba un hecho consumado que este endpoint ya no
 * puede afirmar; lo segundo es exactamente lo que garantiza —que el aviso esta
 * anotado y va a salir— y es una promesa que el mecanismo si cumple: el evento esta
 * en disco, se reintenta si falla y acaba en `notificaciones.envios` con su estado a
 * la vista.
 *
 * Lo que NO cambia es que la respuesta sea siempre la misma. El texto nuevo tiene
 * ademas la ventaja de no comprometerse con un momento, asi que sigue sirviendo
 * igual para el caso en que la cuenta no existe y no se anota nada.
 *
 * ── Y LA TRANSACCION ES NUEVA ──────────────────────────────────────────────
 *
 * El token y el evento tienen que quedar los dos o ninguno: un token guardado sin
 * evento es un enlace vivo que nadie recibe, y un evento sin token es un correo con
 * un enlace que no existe. Ver `services/recuperacion.ts`.
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

    // Limite por cuenta, SILENCIOSO: pasado el maximo no se emite enlace, pero se
    // responde lo de siempre, porque un 429 aqui diria que el correo existe. Frena
    // el bombardeo a una victima desde muchas IP, y el ultimo enlace enviado sigue
    // valiendo. Se registra la PRIMERA vez que salta en la ventana: si no, nadie
    // entenderia por que alguien no recibe su enlace.
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

        // El enlace NO se construye aqui: el evento lleva el token y `URL_APP` vive
        // en ms-notificaciones. Armar la URL es cosa del canal, y este servicio ha
        // dejado de saber que el canal es un correo.
        await registrarRecuperacionSolicitada(
          { idUsuario: usuario.id_usuario, token, expiraEn },
          transaccion,
        );
      });
    }

    return res.json(respuestaUnica);
  } catch (error) {
    // Ni siquiera un fallo interno cambia la respuesta: un 500 con un email y un
    // 200 con otro tambien serviria de oraculo.
    //
    // Y ahora esto tapa un caso mas: que no se pueda anotar el evento. La
    // transaccion se va entera, no queda token ni aviso, y quien lo pidio no recibe
    // nada — pero tampoco se le dice si su cuenta existe. Es el precio de la
    // respuesta unica, y el fallo si queda en el log.
    console.error('Error en recuperación:', (error as Error).message);
    return res.json(respuestaUnica);
  }
};

/**
 * POST /api/auth/restablecer — ruta publica.
 *
 * Recibe el token del enlace y la contrasena nueva. Al tener exito marca el
 * token como usado y deja la marca de cambio, con lo que TODAS las sesiones
 * abiertas del usuario dejan de valer. Es el punto del endpoint: quien
 * restablece su contrasena normalmente lo hace porque sospecha que alguien mas
 * esta dentro, y no sabe cuantas sesiones hay ni cuales.
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
        // Quien restablece elige su clave, asi que no queda nada por cambiar.
        debe_cambiar_contrasena: false,
        contrasena_cambiada_en: marcaDeCambio(),
      },
      { usuarioAuditor: usuario.id_usuario } as never,
    );

    await marcarUsado(registro);

    // No se devuelve token: quien restablece vuelve a entrar por el login. Darle
    // sesion aqui convertiria el enlace del correo en un acceso directo.
    return res.json({ mensaje: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error al restablecer la contraseña:', (error as Error).message);
    return res.status(500).json(crearError('Error al restablecer la contraseña'));
  }
};
