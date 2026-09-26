import 'sequelize';

/** `usuarioAuditor` como opción tipada de Sequelize, leída por los hooks de auditoría. */
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
