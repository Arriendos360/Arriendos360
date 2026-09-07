import type { ClaimsUsuario } from 'arriendos360-shared';

// Los claims verificados que el middleware cuelga de la peticion.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: ClaimsUsuario;
    }
  }
}

export {};
