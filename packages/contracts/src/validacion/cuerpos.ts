/**
 * Un validador por cuerpo de creación. Devuelve `datos`, los campos normalizados, y
 * `errores`, todos a la vez y en el orden del formulario.
 */

import type { CancelarContratoRequest, CrearContratoRequest } from '../contratos';
import { MOTIVOS_CANCELACION } from '../contratos';
import type { CrearCuentaCobroRequest, RegistrarPagoRequest } from '../financiero';
import { TIPOS_TRANSACCION } from '../financiero';
import type { RegistroUsuarioRequest } from '../identidad';
import type { CrearInmuebleRequest } from '../inmuebles';
import { LONGITUD_MAXIMA_ALIAS, TIPOS_INMUEBLE } from '../inmuebles';
import {
  MAXIMO_INTEGER,
  TOPE_NUMERIC_10_2,
  TOPE_NUMERIC_12_2,
  celular,
  cedula,
  contrasena,
  decimalPositivo,
  email,
  entero,
  fechaCalendario,
  fechaNoFutura,
  mensajeObligatorio,
  nombrePersona,
  textoMax,
} from './reglas';
import type { Regla } from './reglas';

export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

/** Superconjunto de `{ mensaje }`: quien sólo lee `mensaje` ve el primer error. */
export interface ErrorValidacion {
  mensaje: string;
  errores: ErrorCampo[];
}

export const errorDeValidacion = (errores: ErrorCampo[]): ErrorValidacion => ({
  mensaje: errores[0]?.mensaje ?? '',
  errores,
});

export interface Validacion<T> {
  datos: Partial<T>;
  errores: ErrorCampo[];
}

const vacio = (valor: unknown): boolean =>
  valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');

const catalogo =
  (valores: readonly string[]): Regla<string> =>
  (valor, etiqueta) =>
    typeof valor === 'string' && valores.includes(valor)
      ? { valor }
      : { error: `${etiqueta} debe ser uno de: ${valores.join(', ')}` };

const diaDelMes: Regla<number> = (valor, etiqueta) => {
  const resultado = entero(1, 31)(valor, etiqueta);
  return 'error' in resultado ? { error: `${etiqueta} debe ser un día del mes (1-31)` } : resultado;
};

const revisor = <T>(cuerpo: unknown) => {
  const entrada = (cuerpo !== null && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
  const datos: Record<string, unknown> = {};
  const errores: ErrorCampo[] = [];

  const campo = <V>(nombre: string, etiqueta: string, regla: Regla<V>, opcional = false): void => {
    const valor = entrada[nombre];

    if (vacio(valor)) {
      // La clave se queda para que `{ ...cuerpo, ...datos }` no guarde un vacío.
      datos[nombre] = undefined;
      if (!opcional) errores.push({ campo: nombre, mensaje: mensajeObligatorio(etiqueta) });
      return;
    }

    const resultado = regla(valor, etiqueta);
    if ('error' in resultado) errores.push({ campo: nombre, mensaje: resultado.error });
    else datos[nombre] = resultado.valor;
  };

  return { entrada, datos, errores, campo, resultado: (): Validacion<T> => ({ datos: datos as Partial<T>, errores }) };
};

type Revisor = ReturnType<typeof revisor>;

const camposDePersona = ({ campo }: Revisor): void => {
  campo('nombres', 'El nombre', nombrePersona(100));
  campo('apellidos', 'El apellido', nombrePersona(100));
  campo('documento', 'El documento', cedula);
  campo('telefono', 'El celular', celular, true);
  campo('email', 'El correo', email);
};

/** `POST /api/auth/registro`. */
export const validarRegistro = (cuerpo: unknown): Validacion<RegistroUsuarioRequest> => {
  const revision = revisor<RegistroUsuarioRequest>(cuerpo);
  camposDePersona(revision);
  revision.campo('contrasena', 'La contraseña', contrasena);
  return revision.resultado();
};

/** `POST /api/usuarios/inquilinos`. La contraseña la genera el servicio. */
export const validarAltaInquilino = (cuerpo: unknown): Validacion<Omit<RegistroUsuarioRequest, 'contrasena'>> => {
  const revision = revisor<Omit<RegistroUsuarioRequest, 'contrasena'>>(cuerpo);
  camposDePersona(revision);
  return revision.resultado();
};

/** `POST /api/contratos`. El deudor solidario va completo o no va. */
export const validarContrato = (cuerpo: unknown): Validacion<CrearContratoRequest> => {
  const revision = revisor<CrearContratoRequest>(cuerpo);
  const { campo, datos, entrada, errores } = revision;

  campo('inicio', 'La fecha de inicio', fechaCalendario);
  campo('fin', 'La fecha de fin', fechaCalendario);
  if (
    typeof datos['inicio'] === 'string' &&
    typeof datos['fin'] === 'string' &&
    Date.parse(datos['fin']) <= Date.parse(datos['inicio'])
  ) {
    errores.push({ campo: 'fin', mensaje: 'La fecha de fin debe ser posterior a la de inicio' });
  }
  campo('canon', 'El canon', decimalPositivo(TOPE_NUMERIC_12_2));
  campo('fecha_limite_pago', 'La fecha límite de pago', diaDelMes, true);
  campo('fecha_inicio_corte', 'La fecha de inicio de corte', fechaCalendario, true);

  const conNombre = !vacio(entrada['nombre_deudor_solidario']);
  const conDocumento = !vacio(entrada['documento_deudor_solidario']);
  campo('nombre_deudor_solidario', 'El nombre del deudor', nombrePersona(150), !conDocumento);
  campo('documento_deudor_solidario', 'El documento del deudor', cedula, !conNombre);

  return revision.resultado();
};

/** `POST /api/inmuebles`. La SPA lo aplica también al editar. */
export const validarInmueble = (cuerpo: unknown): Validacion<CrearInmuebleRequest> => {
  const revision = revisor<CrearInmuebleRequest>(cuerpo);
  const { campo } = revision;

  campo('alias', 'El alias', textoMax(LONGITUD_MAXIMA_ALIAS));
  campo('direccion', 'La dirección', textoMax(255));
  campo('tipo', 'El tipo de inmueble', catalogo(TIPOS_INMUEBLE));
  campo('barrio', 'El barrio', textoMax(100), true);
  campo('departamento', 'El departamento', textoMax(100), true);
  campo('ciudad', 'La ciudad', textoMax(100), true);
  campo('area_m2', 'El área', decimalPositivo(TOPE_NUMERIC_10_2), true);
  campo('estrato', 'El estrato', entero(1, 6), true);
  campo('habitaciones', 'El número de habitaciones', entero(0, MAXIMO_INTEGER), true);
  campo('banos', 'El número de baños', entero(0, MAXIMO_INTEGER), true);
  campo('parqueaderos', 'El número de parqueaderos', entero(0, MAXIMO_INTEGER), true);
  campo('deposito', 'El número de depósitos', entero(0, MAXIMO_INTEGER), true);

  return revision.resultado();
};

/** `POST /api/pagos`. `hoy` (`YYYY-MM-DD` en Bogotá) lo pone quien llama. */
export const validarPago = (cuerpo: unknown, hoy: string): Validacion<RegistrarPagoRequest> => {
  const revision = revisor<RegistrarPagoRequest>(cuerpo);
  const { campo } = revision;

  campo('monto', 'El monto', decimalPositivo(TOPE_NUMERIC_12_2));
  campo('fecha_pago', 'La fecha del pago', fechaNoFutura(hoy), true);
  campo('medio_pago', 'El medio de pago', textoMax(50), true);
  campo('tipo', 'El tipo de transacción', catalogo(TIPOS_TRANSACCION), true);

  return revision.resultado();
};

/** Decimal mayor o igual a cero, en centavos, que cabe en `NUMERIC(12,2)`. */
const decimalNoNegativo: Regla<number> = (valor, etiqueta) => {
  const numero =
    typeof valor === 'number' ? valor : typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor.trim()) ? Number(valor) : NaN;

  if (!Number.isFinite(numero) || numero < 0) {
    return { error: `${etiqueta} debe ser un número mayor o igual a 0` };
  }
  return Math.round(numero * 100) / 100 >= TOPE_NUMERIC_12_2
    ? { error: `${etiqueta} es demasiado grande` }
    : { valor: numero };
};

/**
 * `PUT /api/contratos/{id}/cancelar`. La indemnización es pactable: se valida la forma, no el
 * sugerido. `situacion` es la del contrato, que decide si admite la unilateral del arrendador.
 */
export const validarCancelacion = (
  cuerpo: unknown,
  { situacion }: { situacion: string | null },
): Validacion<CancelarContratoRequest> => {
  const revision = revisor<CancelarContratoRequest>(cuerpo);
  const { campo, datos, errores } = revision;
  const motivos = Object.keys(MOTIVOS_CANCELACION);

  campo('motivo', 'El motivo', catalogo(motivos));
  const motivo = MOTIVOS_CANCELACION[datos['motivo'] as keyof typeof MOTIVOS_CANCELACION];
  if (motivo?.solo_en_prorroga && situacion !== 'renovado') {
    errores.push({ campo: 'motivo', mensaje: `${motivo.etiqueta} sólo se admite con el contrato prorrogado` });
  }

  campo('indemnizacion', 'La indemnización', decimalNoNegativo);
  const conIndemnizacion = typeof datos['indemnizacion'] === 'number' && datos['indemnizacion'] > 0;
  campo('indemnizacion_a_cargo_de', 'Quién paga la indemnización', catalogo(['INQUILINO', 'PROPIETARIO']), !conIndemnizacion);

  return revision.resultado();
};

/** `POST /api/pagos/cuentas-cobro`. */
export const validarCuentaCobro = (cuerpo: unknown): Validacion<CrearCuentaCobroRequest> => {
  const revision = revisor<CrearCuentaCobroRequest>(cuerpo);
  revision.campo('valor', 'El valor', decimalPositivo(TOPE_NUMERIC_12_2));
  return revision.resultado();
};
