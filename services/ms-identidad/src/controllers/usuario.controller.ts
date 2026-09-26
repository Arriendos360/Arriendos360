/**
 * Consulta y alta de usuarios por parte de un propietario.
 */

import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { registrarContrasenaTemporalEmitida } from '../eventos';
import { ConsultaDocumento } from '../models/ConsultaDocumento';
import { ROL_INQUILINO } from '../models/constantes';
import { Rol } from '../models/Rol';
import { Usuario } from '../models/Usuario';
import { generarContrasenaTemporal } from '../services/contrasenaTemporal';
import { marcaDeCambio } from '../services/tokenService';
import { CAMPOS_SIN_CONTRASENA, campoFaltante, crearUsuarioConRol } from './auth.controller';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope del lote. Un listado normal pide decenas, no miles. */
const LIMITE_LOTE = 200;

/**
 * GET /api/usuarios?documento=... — traduce un documento al UUID de la persona.
 * Coincidencia exacta, devuelve sólo id y nombres, y cada consulta queda
 * registrada.
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

    // Se registra siempre, también si no encuentra nada.
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
 * POST /api/usuarios/inquilinos — alta de un inquilino por un propietario. El
 * servicio genera la contraseña temporal y la devuelve una sola vez.
 */
export const crearInquilino = async (req: Request, res: Response): Promise<Response> => {
  try {
    // La contraseña la genera el servicio; si el cliente manda una, se ignora.
    const faltante = campoFaltante(req.body, CAMPOS_SIN_CONTRASENA);
    if (faltante) {
      return res.status(400).json(crearError(`El campo ${faltante} es obligatorio`));
    }

    const { error, usuario, contrasenaTemporal } = await crearUsuarioConRol({
      cuerpo: req.body,
      rol: ROL_INQUILINO,
      idAutor: req.usuario!.sub,
      generarContrasena: true,
    });

    if (error) {
      return res.status(error.estado).json(crearError(error.mensaje));
    }

    return res.status(201).json({
      mensaje: 'Inquilino registrado exitosamente',
      // Única vez que la contraseña viaja en claro.
      contrasena_temporal: contrasenaTemporal,
      usuario: {
        id: usuario!.id_usuario,
        email: usuario!.email,
        rol: ROL_INQUILINO,
        nombres: usuario!.nombres,
        apellidos: usuario!.apellidos,
        documento: usuario!.documento,
        debe_cambiar_contrasena: true,
      },
    });
  } catch (error) {
    console.error('Error al registrar inquilino:', error);
    return res.status(500).json(crearError('Error al registrar inquilino'));
  }
};

/**
 * GET /interno/usuarios?ids=uuid,uuid,... — datos de varios usuarios en lote,
 * para otros servicios.
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

/**
 * POST /interno/usuarios/:id/contrasena-temporal — regenera la contraseña
 * temporal y la devuelve una vez. La autorización la resuelve quien llama.
 */
export const reemitirContrasenaTemporal = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { id } = req.params;
    const solicitadoPor =
      typeof req.body?.solicitado_por === 'string' ? req.body.solicitado_por : null;

    const usuario = id ? await Usuario.findByPk(id) : null;
    if (!usuario) {
      return res.status(404).json(crearError('Usuario no encontrado'));
    }

    const temporal = generarContrasenaTemporal();

    // El cambio de credencial y su aviso, en una transacción.
    await sequelize.transaction(async (transaccion) => {
      await usuario.update(
        {
          contrasena: await bcrypt.hash(temporal, 10),
          debe_cambiar_contrasena: true,
          // Invalida sus sesiones abiertas.
          contrasena_cambiada_en: marcaDeCambio(),
        },
        // Se audita a la persona que lo pidió.
        {
          transaction: transaccion,
          usuarioAuditor: solicitadoPor ?? usuario.id_usuario,
        } as never,
      );

      await registrarContrasenaTemporalEmitida(
        { idUsuario: usuario.id_usuario, motivo: 'REEMISION' },
        transaccion,
      );
    });

    return res.json({
      mensaje: 'Contraseña temporal regenerada',
      contrasena_temporal: temporal,
      usuario: {
        id: usuario.id_usuario,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        debe_cambiar_contrasena: true,
      },
    });
  } catch (error) {
    console.error('Error al reemitir la contraseña temporal:', (error as Error).message);
    return res.status(500).json(crearError('Error al reemitir la contraseña temporal'));
  }
};
