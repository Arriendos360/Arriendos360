import 'sequelize';

/**
 * `usuarioAuditor` como opcion de primera clase de Sequelize.
 *
 * ── POR QUE ESTO EXISTE ─────────────────────────────────────────────────────
 *
 * Los hooks de `models/columnas.ts` leen el autor de `options.usuarioAuditor`,
 * que es una opcion que Sequelize no conoce. Sin esta declaracion, cada llamada
 * tendria que escribirse `{ usuarioAuditor: sub } as never`, y ese `as never` es
 * peor que feo: apaga la inferencia del modelo, asi que
 * `Contrato.create(...)` pasa a devolver `never` y el error aparece tres lineas
 * mas abajo, en un `.id_contrato` que «no existe».
 *
 * Declarandolo aqui, el autor de la auditoria queda TIPADO en los cuatro
 * caminos de escritura y no hace falta ni un solo `as`. Es ademas la forma de
 * que un `usuarioAuditor` mal escrito —`usuarioAudito`— lo cace el compilador
 * en vez de acabar silenciosamente en USUARIO_SISTEMA.
 */
declare module 'sequelize' {
  interface CreateOptions {
    /** UUID de quien origina el cambio. Ver `models/columnas.ts`. */
    usuarioAuditor?: string;
  }

  interface UpdateOptions {
    usuarioAuditor?: string;
  }

  interface InstanceUpdateOptions {
    usuarioAuditor?: string;
  }

  interface SaveOptions {
    usuarioAuditor?: string;
  }

  interface DestroyOptions {
    usuarioAuditor?: string;
  }
}
