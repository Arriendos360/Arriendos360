/**
 * Consulta y alta de usuarios por parte de un propietario.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { ConsultaDocumento } from '../models/ConsultaDocumento';
import { ROL_INQUILINO } from '../models/constantes';
import { Rol } from '../models/Rol';
import { Usuario } from '../models/Usuario';
import { campoFaltante, crearUsuarioConRol } from './auth.controller';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope del lote. Un listado normal pide decenas, no miles. */
const LIMITE_LOTE = 200;

/**
 * GET /api/usuarios?documento=...
 *
 * Existe por el paso a UUID: antes el propietario escribia la cedula del
 * inquilino y esa cedula ERA el `id_inquilino`; ahora la identidad es un UUID
 * que nadie teclea, asi que hay que traducir.
 *
 * Tres restricciones deliberadas:
 *
 * - **Coincidencia exacta.** Nada de busqueda parcial: con `LIKE` esto seria un
 *   directorio de cedulas paginable.
 * - **Solo id, nombres y apellidos.** Ni email ni telefono. Quien busca no es
 *   necesariamente alguien con derecho a los datos de contacto de un tercero, y
 *   el nombre basta para confirmar que encontro a la persona correcta.
 * - **Queda registrada.** Cada consulta deja rastro de quien pregunto y por que
 *   documento, exista o no. Es lo que separa una consulta legitima de un barrido.
 */
export const buscarPorDocumento = async (req: Request, res: Response): Promise<Response> => {
  try {
    const documento = req.query['documento'];

    if (typeof documento !== 'string' || documento.trim() === '') {
      return res.status(400).json(crearError('El documento es obligatorio'));
    }

    const usuario = await Usuario.findOne({
      where: { documento },
      attributes: ['id_usuario', 'nombres', 'apellidos'],
    });

    // El registro se escribe pase lo que pase, y antes de responder: un barrido
    // se reconoce por la racha de consultas fallidas, asi que perder las que no
    // encuentran nada seria perder justo la senal que interesa.
    await ConsultaDocumento.create({
      id_consultante: req.usuario!.sub,
      documento,
      encontrado: usuario !== null,
    });

    if (!usuario) {
      return res.status(404).json(crearError('Usuario no encontrado'));
    }

    return res.json({
      id: usuario.id_usuario,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
    });
  } catch (error) {
    console.error('Error al buscar usuario:', error);
    return res.status(500).json(crearError('Error al buscar usuario'));
  }
};

/**
 * POST /api/usuarios/inquilinos — exige propietario autenticado.
 *
 * Contrapartida del registro publico, que siempre crea PROPIETARIO. El
 * propietario da de alta al inquilino desde el formulario de contrato cuando la
 * busqueda por documento no encuentra a nadie.
 *
 * Queda registrado en la auditoria quien lo creo: `creado_por` lleva el `sub`
 * del propietario, no el UUID del propio inquilino.
 */
export const crearInquilino = async (req: Request, res: Response): Promise<Response> => {
  try {
    const faltante = campoFaltante(req.body);
    if (faltante) {
      return res.status(400).json(crearError(`El campo ${faltante} es obligatorio`));
    }

    const { error, usuario } = await crearUsuarioConRol({
      cuerpo: req.body,
      rol: ROL_INQUILINO,
      idAutor: req.usuario!.sub,
    });

    if (error) {
      return res.status(error.estado).json(crearError(error.mensaje));
    }

    return res.status(201).json({
      mensaje: 'Inquilino registrado exitosamente',
      usuario: {
        id: usuario!.id_usuario,
        email: usuario!.email,
        rol: ROL_INQUILINO,
        nombres: usuario!.nombres,
        apellidos: usuario!.apellidos,
        documento: usuario!.documento,
      },
    });
  } catch (error) {
    console.error('Error al registrar inquilino:', error);
    return res.status(500).json(crearError('Error al registrar inquilino'));
  }
};

/**
 * GET /interno/usuarios?ids=uuid,uuid,...
 *
 * Uso exclusivo del gateway, para componer respuestas que antes armaba con un
 * `include` de Sequelize: el nombre del inquilino en el listado de contratos, el
 * bloque del arrendatario en los recibos, el correo al que avisa el motor de
 * mora. Ese `include` cruzaba la frontera del servicio y la regla dura 2 lo
 * prohibe en cuanto los esquemas se separan.
 *
 * Es EN LOTE a proposito. Un listado de veinte contratos pediria veinte veces lo
 * mismo si la consulta fuera de uno en uno: el clasico N+1, pero por red.
 *
 * Devuelve mas campos que la busqueda publica (telefono, email, roles) porque el
 * llamante es el gateway, componiendo una respuesta que ya esta autorizado a
 * construir, no una persona preguntando por un tercero. Por eso cuelga de
 * `/interno`: la costura solo reenvia `/api/*`, asi que no hay forma de llegar
 * aqui desde fuera.
 */
export const usuariosPorIds = async (req: Request, res: Response): Promise<Response> => {
  try {
    const parametro = req.query['ids'];
    const ids =
      typeof parametro === 'string'
        ? parametro.split(',').map((id) => id.trim()).filter((id) => PATRON_UUID.test(id))
        : [];

    if (ids.length === 0) {
      return res.json({ usuarios: [] });
    }

    if (ids.length > LIMITE_LOTE) {
      return res.status(400).json(crearError(`Máximo ${LIMITE_LOTE} identificadores por consulta`));
    }

    const usuarios = await Usuario.findAll({
      where: { id_usuario: ids },
      attributes: ['id_usuario', 'nombres', 'apellidos', 'documento', 'telefono', 'email'],
      include: [{ model: Rol, attributes: ['nombre'], through: { attributes: [] } }],
    });

    return res.json({
      usuarios: usuarios.map((usuario) => ({
        id: usuario.id_usuario,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        documento: usuario.documento,
        telefono: usuario.telefono,
        email: usuario.email,
        roles: ((usuario as unknown as { Rols?: Rol[] }).Rols ?? []).map((rol) => rol.nombre),
      })),
    });
  } catch (error) {
    console.error('Error al listar usuarios por id:', error);
    return res.status(500).json(crearError('Error al listar usuarios'));
  }
};
