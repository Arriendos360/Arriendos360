/**
 * Plantillas de correo. Cada una recibe la carga del evento y el destinatario ya
 * resuelto, y devuelve `{ asunto, cuerpoHtml }`. Son funciones puras.
 *
 * El diseño aplica el manual de identidad de marca: una sola envoltura (encabezado
 * índigo, tarjeta y pie) y, en los avisos de pago, un bloque con la cifra y su estado.
 * Los asuntos y textos se reescribieron con él a propósito. Lo que no puede cambiar al
 * retocarlos lo fijan las pruebas (`docs/adr/0019`).
 *
 * Es HTML de correo, no de navegador: tablas, estilos en línea y `bgcolor` junto a cada
 * fondo, porque Outlook y Gmail no respetan flexbox, grid ni hojas de estilo. Todo dato
 * que escribió una persona pasa por `escapar`.
 */

import type {
  ContrasenaTemporalEmitida,
  CuentaCobroEnMora,
  CuentaCobroGenerada,
  CuentaCobroPorVencer,
  RecuperacionSolicitada,
} from 'arriendos360-shared';
import { ZONA_NEGOCIO, textoDeEntorno } from 'arriendos360-shared';

import type { Destinatario } from '../clientes/identidad';

/** Lo que una plantilla produce. Es lo que se guarda en la bitacora de envios. */
export interface Mensaje {
  asunto: string;
  cuerpoHtml: string;
}

const remitenteConfigurado = textoDeEntorno('EMAIL_REMITENTE', 'noreply@arriendos360.com').trim();

/**
 * Remitente de los correos, siempre con el nombre de Arriendos360. En Azure
 * `EMAIL_REMITENTE` es sólo la dirección de la cuenta de Gmail, que cambia la dirección
 * si no es la que se autentica pero conserva el nombre. Si ya trae uno, se respeta.
 */
export const REMITENTE = remitenteConfigurado.includes('<')
  ? remitenteConfigurado
  : `"Arriendos360" <${remitenteConfigurado}>`;

/** Base pública de la SPA, para los enlaces. Se lee en cada llamada. */
const urlApp = (): string =>
  textoDeEntorno('URL_APP', 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Rutas de la SPA (`apps/web/src/App.js`) a las que llevan los botones. No hay una por
 * cuenta de cobro: `/pagos` es la lista, para los dos roles.
 */
const RUTA = {
  login: '/login',
  pagos: '/pagos',
  restablecer: '/restablecer',
} as const;

const enlace = (ruta: string): string => `${urlApp()}${ruta}`;

/** Pesos colombianos, con el mismo formato que los comprobantes. */
export const pesos = (valor: number | string): string =>
  `$ ${parseFloat(String(valor ?? 0)).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

/**
 * Una fecha `YYYY-MM-DD` en palabras. En UTC: con la zona local se imprimiría el
 * día anterior.
 */
export const fecha = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Un instante, con hora, en la zona del negocio. Para la caducidad del enlace. */
export const instante = (iso: string): string =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ZONA_NEGOCIO,
  });

/** Un periodo, como se nombra en una cuenta de cobro. */
const periodo = (inicio: string, fin: string): string => `${fecha(inicio)} al ${fecha(fin)}`;

const ENTIDADES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Un dato de usuario, listo para el cuerpo HTML. */
const escapar = (valor: string | null | undefined): string =>
  String(valor ?? '').replace(/[&<>"']/g, (caracter) => ENTIDADES[caracter] ?? caracter);

/** Lo que cabe en `notificaciones.envios.asunto`. */
const LARGO_ASUNTO = 255;

/**
 * Un asunto con un dato de usuario. Es texto plano y no se escapa, pero va en una
 * línea y se recorta: una dirección de 255 caracteres desbordaría la columna, la
 * inserción fallaría y el evento se reintentaría hasta quedar apartado.
 */
const asuntoCon = (prefijo: string, dato: string): string => {
  const caracteres = Array.from(`${prefijo}${String(dato ?? '').replace(/\s+/g, ' ').trim()}`);
  return caracteres.length <= LARGO_ASUNTO
    ? caracteres.join('')
    : `${caracteres.slice(0, LARGO_ASUNTO - 1).join('')}…`;
};

// ── Marca ────────────────────────────────────────────────────────────────────

const COLOR = {
  indigo: '#3D3480',
  indigoMedio: '#5B52A3',
  lavanda: '#F4F3FC',
  pastel: '#E8E5F9',
  texto: '#241F4D',
  secundario: '#6B6580',
  blanco: '#FFFFFF',
  // El rgba(255,255,255,0.16) del manual sobre el índigo, ya mezclado: Outlook no
  // entiende rgba.
  logo: '#5C5494',
} as const;

/** Estados de pago: lo único que lleva ámbar o rojo. */
const ESTADO = {
  pendiente: { etiqueta: 'Pendiente', fondo: '#FEF3DE', texto: '#92400E', cifra: COLOR.indigoMedio },
  mora: { etiqueta: 'En mora', fondo: '#FDECEC', texto: '#B91C1C', cifra: COLOR.texto },
} as const;

type Estado = (typeof ESTADO)[keyof typeof ESTADO];

/** Sin `<link>` a fuentes web: casi todos los clientes mostrarán el respaldo. */
const FUENTE = 'Manrope, Arial, Helvetica, sans-serif';

/** Estilo de texto. Va en cada elemento: Outlook no siempre hereda el de la celda. */
const letra = (px: number, color: string, extra = '', alto = '1.6'): string =>
  `font-family:${FUENTE};font-size:${px}px;line-height:${alto};color:${color};${extra}`;

const MAYUSCULAS = 'text-transform:uppercase;letter-spacing:0.5px;';

const TABLA = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

// ── Piezas ───────────────────────────────────────────────────────────────────

/** El saludo. Sin nombre si no lo hay, en vez de un «Hola ,» suelto. */
const saludo = (destinatario: Destinatario): string =>
  `<p style="margin:0;${letra(14, COLOR.texto)}">${
    destinatario.nombres ? `Hola ${escapar(destinatario.nombres)},` : 'Hola,'
  }</p>`;

const chip = (texto: string): string => `
  <table ${TABLA}><tr>
    <td bgcolor="${COLOR.pastel}" style="background:${COLOR.pastel};border-radius:8px;padding:4px 10px;${letra(11, COLOR.indigo, `font-weight:500;${MAYUSCULAS}`, '16px')}">${texto}</td>
  </tr></table>`;

const insignia = (estado: Estado): string => `
  <table ${TABLA} align="right"><tr>
    <td bgcolor="${estado.fondo}" style="background:${estado.fondo};border-radius:8px;padding:2px 10px;${letra(11, estado.texto, 'font-weight:500;', '18px')}">${estado.etiqueta}</td>
  </tr></table>`;

const boton = (texto: string, url: string): string => `
  <table ${TABLA}><tr>
    <td bgcolor="${COLOR.indigoMedio}" style="background:${COLOR.indigoMedio};border-radius:10px;">
      <a href="${escapar(url)}" target="_blank" style="display:inline-block;padding:12px 22px;border-radius:10px;text-decoration:none;${letra(14, COLOR.blanco, 'font-weight:500;', '20px')}">${texto}</a>
    </td>
  </tr></table>`;

/** Una fila de un bloque. Etiqueta y valor llegan ya en HTML seguro. */
interface Fila {
  etiqueta: string;
  valor: string;
  /** Aclaración bajo el valor, en pequeño. */
  nota?: string;
}

/** El recuadro lavanda de los bloques. */
const recuadro = (contenido: string): string => `
  <table ${TABLA} width="100%"><tr>
    <td bgcolor="${COLOR.lavanda}" style="background:${COLOR.lavanda};border-radius:14px;padding:20px;">${contenido}</td>
  </tr></table>`;

/**
 * Columna de etiquetas del bloque de valor. La misma en todos: con 160 px, en un móvil
 * el valor de los correos de mora se partía palabra por palabra.
 */
const ANCHO_ETIQUETAS = 120;

/** Bloque de los avisos de pago: la cifra con su estado y, debajo, las filas. */
const bloqueDeValor = (etiqueta: string, valor: number, estado: Estado, filas: Fila[]): string =>
  recuadro(`
    <table ${TABLA} width="100%"><tr>
      <td valign="middle" style="${letra(11, COLOR.secundario, MAYUSCULAS)}">${etiqueta}</td>
      <td align="right" valign="middle">${insignia(estado)}</td>
    </tr></table>
    <p style="margin:4px 0 16px;${letra(22, estado.cifra, 'font-weight:500;', '1.3')}">${pesos(valor)}</p>
    <table ${TABLA} width="100%"><tr>
      <td style="border-top:1px solid ${COLOR.pastel};">
        <table ${TABLA} width="100%">${filas
          .map(
            (fila) => `
          <tr>
            <td width="${ANCHO_ETIQUETAS}" valign="top" style="width:${ANCHO_ETIQUETAS}px;padding:12px 12px 0 0;${letra(12, COLOR.secundario, '', '22px')}">${fila.etiqueta}</td>
            <td valign="top" style="padding:12px 0 0;${letra(14, COLOR.texto, 'font-weight:500;', '22px')}">${fila.valor}</td>
          </tr>`,
          )
          .join('')}
        </table>
      </td>
    </tr></table>`);

/** Bloque de los correos de cuenta: filas apiladas, sin cifra ni estado. */
const bloqueDeDatos = (filas: Fila[]): string =>
  recuadro(
    filas
      .map(
        (fila, i) => `
    <table ${TABLA} width="100%"><tr>
      <td style="${i > 0 ? `border-top:1px solid ${COLOR.pastel};padding-top:12px;` : ''}${i < filas.length - 1 ? 'padding-bottom:12px;' : ''}">
        <p style="margin:0;${letra(11, COLOR.secundario, MAYUSCULAS)}">${fila.etiqueta}</p>
        <p style="margin:2px 0 0;${letra(14, COLOR.texto, 'font-weight:500;')}">${fila.valor}</p>${
          fila.nota ? `\n        <p style="margin:4px 0 0;${letra(12, COLOR.secundario)}">${fila.nota}</p>` : ''
        }
      </td>
    </tr></table>`,
      )
      .join(''),
  );

/** Las piezas de un correo. Lo que es HTML llega ya escapado. */
interface Piezas {
  /** Texto de vista previa en la bandeja. No se ve al abrir el correo. */
  preheader: string;
  chip?: string;
  titulo: string;
  destinatario: Destinatario;
  parrafos: string[];
  bloque?: string;
  boton: { texto: string; url: string };
  /** Repite la URL del botón en texto, por si el botón no se ve. */
  enlaceEnTexto?: boolean;
  /** Cierre en pequeño, sin separador. */
  textoFinal?: string;
  /** Cierre en pequeño, tras una línea. */
  nota?: string;
}

/** Envoltura común de todos los correos. */
const envolver = (piezas: Piezas): string => {
  // Cada pieza en su fila y el espacio como padding de la celda: Outlook no respeta
  // los márgenes de las tablas.
  const filas: Array<[espacioAntes: number, html: string]> = [];

  if (piezas.chip) {
    filas.push([0, chip(piezas.chip)]);
  }
  filas.push([
    16,
    `<h1 style="margin:0;${letra(22, COLOR.texto, 'font-weight:500;', '1.3')}">${piezas.titulo}</h1>`,
  ]);
  filas.push([16, saludo(piezas.destinatario)]);
  for (const parrafo of piezas.parrafos) {
    filas.push([12, `<p style="margin:0;${letra(14, COLOR.texto)}">${parrafo}</p>`]);
  }
  if (piezas.bloque) {
    filas.push([20, piezas.bloque]);
  }
  filas.push([24, boton(piezas.boton.texto, piezas.boton.url)]);
  if (piezas.enlaceEnTexto) {
    const url = escapar(piezas.boton.url);
    filas.push([
      16,
      `<p style="margin:0;${letra(12, COLOR.secundario)}">¿El botón no funciona? Copia este enlace en tu navegador:<br>
        <a href="${url}" target="_blank" style="color:${COLOR.indigoMedio};word-break:break-all;">${url}</a></p>`,
    ]);
  }
  if (piezas.textoFinal) {
    filas.push([16, `<p style="margin:0;${letra(13, COLOR.secundario)}">${piezas.textoFinal}</p>`]);
  }
  if (piezas.nota) {
    filas.push([
      24,
      `<table ${TABLA} width="100%"><tr>
        <td style="border-top:1px solid ${COLOR.pastel};padding-top:16px;${letra(13, COLOR.secundario)}">${piezas.nota}</td>
      </tr></table>`,
    ]);
  }

  const cuerpo = filas
    .map(([antes, html], i) => `
              <tr><td style="padding-top:${i === 0 ? 0 : antes}px;">${html}</td></tr>`)
    .join('');

  return `
<table ${TABLA} width="100%" bgcolor="${COLOR.lavanda}" style="background:${COLOR.lavanda};">
  <tr>
    <td align="center" bgcolor="${COLOR.lavanda}" style="background:${COLOR.lavanda};padding:24px;">
      <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.lavanda};opacity:0;">${piezas.preheader}</div>
      <!--[if mso]><table ${TABLA} width="600" align="center"><tr><td><![endif]-->
      <table ${TABLA} width="100%" style="width:100%;max-width:600px;">
        <tr>
          <td bgcolor="${COLOR.indigo}" style="background:${COLOR.indigo};border-radius:14px 14px 0 0;padding:20px 32px;">
            <table ${TABLA}><tr>
              <td width="32" height="32" align="center" valign="middle" bgcolor="${COLOR.logo}" style="width:32px;height:32px;background:${COLOR.logo};border-radius:9px;text-align:center;${letra(16, COLOR.blanco, 'font-weight:600;', '32px')}">A</td>
              <td valign="middle" style="padding-left:12px;${letra(16, COLOR.blanco, 'font-weight:500;', '32px')}">Arriendos360</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${COLOR.blanco}" style="background:${COLOR.blanco};border-radius:0 0 14px 14px;padding:32px;text-align:left;">
            <table ${TABLA} width="100%">${cuerpo}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 16px 0;${letra(12, COLOR.secundario)}">
            Arriendos360 · Bogotá D.C.<br>
            Este es un mensaje automático, no respondas a este correo.
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>`;
};

// ── ms-identidad ─────────────────────────────────────────────────────────────

/** Recuperación de contraseña: el enlace con el token y la hora exacta en que caduca. */
export const recuperacionSolicitada = (
  carga: RecuperacionSolicitada,
  destinatario: Destinatario,
): Mensaje => {
  const caduca = instante(carga.expira_en);
  // La hora termina en «p. m.»: sin esto la frase cerraría con dos puntos.
  const punto = caduca.endsWith('.') ? '' : '.';

  return {
    asunto: 'Restablece tu contraseña de Arriendos360',
    cuerpoHtml: envolver({
      preheader: `El enlace sirve una sola vez y caduca el ${caduca}${punto}`,
      chip: 'Seguridad de la cuenta',
      titulo: 'Restablece tu contraseña',
      destinatario,
      parrafos: [
        `Pediste restablecer tu contraseña. El enlace sirve una sola vez y caduca el <strong>${caduca}</strong>${punto}`,
      ],
      boton: {
        texto: 'Restablecer mi contraseña',
        url: enlace(`${RUTA.restablecer}?token=${encodeURIComponent(carga.token)}`),
      },
      enlaceEnTexto: true,
      nota: 'Si no fuiste tú, ignora este correo: tu contraseña no ha cambiado.',
    }),
  };
};

/** Alta o reemisión de la contraseña temporal. No lleva la contraseña. */
export const contrasenaTemporalEmitida = (
  carga: ContrasenaTemporalEmitida,
  destinatario: Destinatario,
): Mensaje =>
  carga.motivo === 'ALTA'
    ? {
        asunto: 'Tu cuenta en Arriendos360 está lista',
        cuerpoHtml: envolver({
          preheader: 'Tu arrendador creó una cuenta a tu nombre.',
          chip: 'Tu cuenta',
          titulo: 'Tienes una cuenta en Arriendos360',
          destinatario,
          parrafos: [
            'Tu arrendador creó una cuenta a tu nombre. Desde ahí podrás consultar tu contrato, tus cuentas de cobro y tus comprobantes de pago.',
          ],
          bloque: bloqueDeDatos([
            { etiqueta: 'Usuario', valor: escapar(destinatario.email) },
            {
              etiqueta: 'Contraseña temporal',
              valor: 'Te la entregará quien te dio de alta',
              nota: 'Por seguridad no se envía por correo. La primera vez que entres tendrás que cambiarla por una tuya.',
            },
          ]),
          boton: { texto: 'Ir a Arriendos360', url: enlace(RUTA.login) },
        }),
      }
    : {
        asunto: 'Se generó una nueva contraseña temporal para tu cuenta',
        cuerpoHtml: envolver({
          preheader: 'La contraseña anterior dejó de funcionar.',
          chip: 'Seguridad de la cuenta',
          titulo: 'Se generó una nueva contraseña temporal',
          destinatario,
          parrafos: [
            'Se generó una contraseña temporal nueva para tu cuenta. La anterior dejó de funcionar y, con ella, se cerraron todas las sesiones abiertas.',
          ],
          bloque: bloqueDeDatos([
            {
              etiqueta: 'Contraseña nueva',
              valor: 'Te la entregará tu arrendador',
              nota: 'Por seguridad no se envía por correo. Al entrar tendrás que cambiarla por una tuya.',
            },
          ]),
          boton: { texto: 'Ir a Arriendos360', url: enlace(RUTA.login) },
          nota: 'Si no esperabas este cambio, avisa a tu arrendador.',
        }),
      };

// ── ms-financiero ────────────────────────────────────────────────────────────

/** Cuenta de cobro generada, al inquilino. El evento no trae el inmueble. */
export const cuentaCobroGenerada = (
  carga: CuentaCobroGenerada,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: 'Nueva cuenta de cobro de tu arriendo',
  cuerpoHtml: envolver({
    preheader: `Periodo ${periodo(carga.inicio, carga.fin)} · ${pesos(carga.valor)}`,
    titulo: 'Tu nueva cuenta de cobro',
    destinatario,
    parrafos: ['Se generó la cuenta de cobro de tu arriendo para el siguiente periodo.'],
    bloque: bloqueDeValor('Valor a pagar', carga.valor, ESTADO.pendiente, [
      { etiqueta: 'Periodo', valor: periodo(carga.inicio, carga.fin) },
    ]),
    boton: { texto: 'Ver cuenta de cobro', url: enlace(RUTA.pagos) },
    textoFinal: 'Puedes consultarla y descargarla en cualquier momento desde Arriendos360.',
  }),
});

/** Lo que comparten los dos avisos de vencimiento próximo. */
const porVencer = (carga: CuentaCobroPorVencer, etiqueta: string) => {
  const direccion = escapar(carga.direccion_inmueble);
  const moraEl = fecha(carga.entra_en_mora_el);

  return {
    direccion,
    moraEl,
    preheader: `Pasa a mora el ${moraEl} si no se registra el pago.`,
    bloque: bloqueDeValor(etiqueta, carga.valor, ESTADO.pendiente, [
      { etiqueta: 'Inmueble', valor: direccion },
      { etiqueta: 'Periodo', valor: periodo(carga.inicio, carga.fin) },
      { etiqueta: 'Pasa a mora el', valor: moraEl },
    ]),
  };
};

/** Vencimiento próximo, al inquilino, con la fecha en que entra en mora. */
export const porVencerInquilino = (
  carga: CuentaCobroPorVencer,
  destinatario: Destinatario,
): Mensaje => {
  const { direccion, moraEl, preheader, bloque } = porVencer(carga, 'Valor a pagar');

  return {
    asunto: 'Tu pago de arriendo está por vencer',
    cuerpoHtml: envolver({
      preheader,
      titulo: 'Tu pago está por vencer',
      destinatario,
      parrafos: [
        `Tu pago de arriendo del inmueble <strong>${direccion}</strong> está próximo a vencer. Si no se registra el pago, la cuenta pasará a mora el <strong>${moraEl}</strong>.`,
      ],
      bloque,
      boton: { texto: 'Ver mis pagos', url: enlace(RUTA.pagos) },
    }),
  };
};

/** Vencimiento próximo, al propietario. */
export const porVencerPropietario = (
  carga: CuentaCobroPorVencer,
  destinatario: Destinatario,
): Mensaje => {
  const { direccion, moraEl, preheader, bloque } = porVencer(carga, 'Valor pendiente');

  return {
    asunto: asuntoCon('Pago por vencer: ', carga.direccion_inmueble),
    cuerpoHtml: envolver({
      preheader,
      titulo: 'Un pago está por vencer',
      destinatario,
      parrafos: [
        `El pago del inmueble <strong>${direccion}</strong> está próximo a vencer. La cuenta pasará a mora el <strong>${moraEl}</strong> si no se registra el pago.`,
      ],
      bloque,
      boton: { texto: 'Ver pagos', url: enlace(RUTA.pagos) },
    }),
  };
};

/** Lo que comparten los dos avisos de mora: los mismos números para los dos. */
const enMora = (carga: CuentaCobroEnMora) => {
  const direccion = escapar(carga.direccion_inmueble);

  return {
    direccion,
    preheader: `${pesos(carga.valor)} pendientes · ${carga.dias_de_mora} días desde el corte.`,
    bloque: bloqueDeValor('Valor pendiente', carga.valor, ESTADO.mora, [
      { etiqueta: 'Inmueble', valor: direccion },
      { etiqueta: 'Periodo', valor: periodo(carga.inicio, carga.fin) },
      { etiqueta: 'Días desde el corte', valor: String(carga.dias_de_mora) },
    ]),
  };
};

/** Mora, al INQUILINO. */
export const enMoraInquilino = (
  carga: CuentaCobroEnMora,
  destinatario: Destinatario,
): Mensaje => {
  const { direccion, preheader, bloque } = enMora(carga);

  return {
    asunto: 'Tu cuenta de cobro entró en mora',
    cuerpoHtml: envolver({
      preheader,
      titulo: 'Tu cuenta de cobro está en mora',
      destinatario,
      parrafos: [
        `Tu pago de arriendo del inmueble <strong>${direccion}</strong> superó el periodo de gracia y la cuenta quedó en mora. Por favor regulariza tu situación lo antes posible.`,
      ],
      bloque,
      boton: { texto: 'Ver mis pagos', url: enlace(RUTA.pagos) },
      nota: 'Si ya realizaste el pago, confirma con tu arrendador que haya quedado registrado.',
    }),
  };
};

/** Mora, al PROPIETARIO. */
export const enMoraPropietario = (
  carga: CuentaCobroEnMora,
  destinatario: Destinatario,
): Mensaje => {
  const { direccion, preheader, bloque } = enMora(carga);

  return {
    asunto: asuntoCon('Inquilino en mora: ', carga.direccion_inmueble),
    cuerpoHtml: envolver({
      preheader,
      titulo: 'Un inquilino entró en mora',
      destinatario,
      parrafos: [
        `El inquilino del inmueble <strong>${direccion}</strong> superó el periodo de gracia sin que se registrara el pago, y la cuenta de cobro quedó en mora.`,
      ],
      bloque,
      boton: { texto: 'Ver pagos', url: enlace(RUTA.pagos) },
    }),
  };
};
