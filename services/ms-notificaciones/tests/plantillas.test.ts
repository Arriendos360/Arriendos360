/**
 * Las plantillas. Funciones puras, asi que se prueban sin base y sin dobles.
 *
 * Lo que se fija aqui no es el texto —que puede cambiar— sino las tres cosas que NO
 * pueden cambiar sin romper algo:
 *
 *   1. que el correo de recuperacion lleve el enlace con el token y una caducidad
 *      ABSOLUTA, no «30 minutos»;
 *   2. que el de la contrasena temporal NO lleve la contrasena;
 *   3. que el de vencimiento proximo diga una FECHA y no «mañana».
 *
 * Las tres son decisiones documentadas en `docs/adr/0019`, y las tres son faciles de
 * deshacer sin darse cuenta al retocar un texto. Del rediseño se fija, ademas, que el
 * HTML escape lo que escribe una persona y que cada boton lleve a una ruta de la SPA.
 */

import {
  contrasenaTemporalEmitida,
  cuentaCobroGenerada,
  enMoraInquilino,
  enMoraPropietario,
  porVencerInquilino,
  porVencerPropietario,
  recuperacionSolicitada,
  type Mensaje,
} from '../src/plantillas';
import type { Destinatario } from '../src/clientes/identidad';

const URL_APP = 'https://app.arriendos360.test';

const quien: Destinatario = {
  id_usuario: '11111111-1111-4111-8111-111111111111',
  email: 'quien@test.com',
  nombres: 'Quien',
};

const sinNombre: Destinatario = { ...quien, nombres: '' };

const recuperacion = {
  id_usuario: quien.id_usuario,
  token: 'abc123def456abc123def456abc123def456abc123def456abc123def4560000',
  // 2026-06-15T20:30:00Z son las 15:30 en Bogotá.
  expira_en: '2026-06-15T20:30:00.000Z',
};

const base = {
  id_cuenta_cobro: '22222222-2222-4222-8222-222222222222',
  id_contrato: '33333333-3333-4333-8333-333333333333',
  id_inquilino: quien.id_usuario,
  id_propietario: '44444444-4444-4444-8444-444444444444',
  valor: 1500000,
  inicio: '2026-06-01',
  fin: '2026-06-30',
  direccion_inmueble: 'Calle 123 #45-67',
};

/** La carga de `CuentaCobroGenerada`, que no trae ni propietario ni inmueble. */
const generada = {
  id_cuenta_cobro: base.id_cuenta_cobro,
  id_contrato: base.id_contrato,
  id_inquilino: base.id_inquilino,
  valor: base.valor,
  inicio: base.inicio,
  fin: base.fin,
};

/** El texto que se lee, sin etiquetas ni estilos. */
const texto = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** Un mensaje de cada plantilla, con la ruta de la SPA a la que lleva su botón. */
const cadaPlantilla = (
  destinatario: Destinatario,
  direccion = base.direccion_inmueble,
): Array<[Mensaje, string]> => {
  const cuenta = { ...base, direccion_inmueble: direccion };
  const porVencer = { ...cuenta, entra_en_mora_el: '2026-06-07' };
  const enMora = { ...cuenta, dias_de_mora: 7 };

  return [
    [recuperacionSolicitada(recuperacion, destinatario), `/restablecer?token=${recuperacion.token}`],
    [contrasenaTemporalEmitida({ id_usuario: destinatario.id_usuario, motivo: 'ALTA' }, destinatario), '/login'],
    [contrasenaTemporalEmitida({ id_usuario: destinatario.id_usuario, motivo: 'REEMISION' }, destinatario), '/login'],
    [cuentaCobroGenerada(generada, destinatario), '/pagos'],
    [porVencerInquilino(porVencer, destinatario), '/pagos'],
    [porVencerPropietario(porVencer, destinatario), '/pagos'],
    [enMoraInquilino(enMora, destinatario), '/pagos'],
    [enMoraPropietario(enMora, destinatario), '/pagos'],
  ];
};

beforeAll(() => {
  process.env['URL_APP'] = URL_APP;
});

describe('Recuperación de contraseña', () => {
  const carga = recuperacion;

  test('el enlace lleva el token y sale de URL_APP', () => {
    const { cuerpoHtml } = recuperacionSolicitada(carga, quien);

    expect(cuerpoHtml).toContain(`https://app.arriendos360.test/restablecer?token=${carga.token}`);
  });

  test('la caducidad es un INSTANTE, no «30 minutos»', () => {
    // Es el único cambio de texto del paso 7 respecto al correo anterior, y tiene
    // motivo: «caduca en 30 minutos» era cierto cuando el envío iba dentro de la
    // petición que creaba el token. Con el bus hay una ventana entre las dos cosas y los
    // reintentos la estiran, así que una duración relativa se vuelve falsa sola.
    const { cuerpoHtml } = recuperacionSolicitada(carga, quien);

    expect(cuerpoHtml).not.toMatch(/30 minutos/);
    // Y dice la hora de Bogotá, no la del contenedor: 20:30Z son las 15:30 allí.
    expect(cuerpoHtml).toMatch(/15 de junio/);
    expect(cuerpoHtml).toMatch(/3:30/);
    // La hora acaba en «p. m.», y la frase no le añade otro punto.
    expect(texto(cuerpoHtml)).not.toMatch(/\.\s*\./);
  });

  test('sin nombre saluda sin dejar una coma suelta', () => {
    // Se mira el texto y no la etiqueta: los estilos en línea son del diseño, no del
    // saludo.
    const sinNombreTexto = texto(recuperacionSolicitada(carga, sinNombre).cuerpoHtml);

    expect(sinNombreTexto).toContain(' Hola, ');
    expect(sinNombreTexto).not.toMatch(/Hola\s+,/);
    expect(texto(recuperacionSolicitada(carga, quien).cuerpoHtml)).toContain(' Hola Quien, ');
  });
});

describe('Contraseña temporal', () => {
  test('NO lleva la contraseña, ni en el alta ni en la reemisión', () => {
    // El ADR 0007 decide que la temporal se entrega en mano porque el sistema no puede
    // garantizar que un correo llegue, y ese ADR sigue en pie. Este evento avisa de que
    // la cuenta existe; no la abre. Ni el sobre la trae, así que no hay forma de que la
    // plantilla la imprima — pero la prueba fija la intención.
    const alta = contrasenaTemporalEmitida(
      { id_usuario: quien.id_usuario, motivo: 'ALTA' },
      quien,
    );
    const reemision = contrasenaTemporalEmitida(
      { id_usuario: quien.id_usuario, motivo: 'REEMISION' },
      quien,
    );

    for (const { cuerpoHtml } of [alta, reemision]) {
      // Dice explícitamente que la entrega es por fuera del correo.
      expect(cuerpoHtml).toMatch(/no se envía por correo/);
      expect(cuerpoHtml).toMatch(/entregará/);
    }

    // Y los dos motivos dicen cosas distintas: uno estrena cuenta, el otro avisa de que
    // la anterior dejó de valer.
    expect(alta.asunto).not.toBe(reemision.asunto);
    expect(alta.cuerpoHtml).toContain(quien.email);
    // `\s+` y no un espacio: el HTML de la plantilla va con saltos de línea, así que una
    // frase puede partirse. Fijar el ajuste de línea exacto sería fijar el sangrado.
    expect(reemision.cuerpoHtml).toMatch(/dejó\s+de funcionar/);
  });
});

describe('Avisos del motor', () => {
  test('el recibo generado dice el periodo completo y el valor con formato', () => {
    // El correo anterior decía «el periodo que inicia el 1», con el día del mes suelto y
    // sin mes ni año, porque era lo que el bucle tenía a mano. El evento trae el periodo.
    const { cuerpoHtml } = cuentaCobroGenerada(
      {
        id_cuenta_cobro: base.id_cuenta_cobro,
        id_contrato: base.id_contrato,
        id_inquilino: base.id_inquilino,
        valor: base.valor,
        inicio: base.inicio,
        fin: base.fin,
      },
      quien,
    );

    expect(cuerpoHtml).toMatch(/1 de junio de 2026/);
    expect(cuerpoHtml).toMatch(/30 de junio de 2026/);
    expect(cuerpoHtml).toContain('1.500.000');
  });

  test('las fechas se leen en UTC, no en la zona del contenedor', () => {
    // `2026-06-01` es medianoche UTC. Formatearlo en la zona local imprimiría el 31 de
    // mayo en Bogotá, es decir, el mes equivocado en el recibo. Es el mismo cuidado que
    // tiene `fmtPeriodo` en los comprobantes.
    const { cuerpoHtml } = cuentaCobroGenerada(
      {
        id_cuenta_cobro: base.id_cuenta_cobro,
        id_contrato: base.id_contrato,
        id_inquilino: base.id_inquilino,
        valor: 1,
        inicio: '2026-06-01',
        fin: '2026-06-30',
      },
      quien,
    );

    expect(cuerpoHtml).not.toMatch(/mayo/);
  });

  test('el vencimiento próximo dice una FECHA, no «mañana»', () => {
    const carga = { ...base, entra_en_mora_el: '2026-06-07' };

    for (const plantilla of [porVencerInquilino, porVencerPropietario]) {
      const { cuerpoHtml } = plantilla(carga, quien);

      expect(cuerpoHtml).not.toMatch(/mañana/);
      expect(cuerpoHtml).toMatch(/7 de junio de 2026/);
      expect(cuerpoHtml).toContain('Calle 123 #45-67');
    }
  });

  test('los dos avisos de mora hablan de la misma cuenta con textos distintos', () => {
    // Un evento, dos destinatarios, dos redacciones. Que la decisión de cómo se le habla
    // a cada uno viva aquí y no en el emisor es el punto del diseño.
    const carga = { ...base, dias_de_mora: 7 };

    const inquilino = enMoraInquilino(carga, quien);
    const propietario = enMoraPropietario(carga, quien);

    expect(inquilino.asunto).not.toBe(propietario.asunto);
    expect(inquilino.cuerpoHtml).toMatch(/Tu pago/);
    expect(propietario.cuerpoHtml).toMatch(/El inquilino/);

    // Y los dos llevan los mismos números.
    for (const { cuerpoHtml } of [inquilino, propietario]) {
      expect(cuerpoHtml).toContain('1.500.000');
      expect(cuerpoHtml).toContain('Calle 123 #45-67');
      expect(cuerpoHtml).toMatch(/7/);
    }
  });
});

describe('Diseño', () => {
  test('ningún asunto lleva emojis', () => {
    for (const [{ asunto }] of cadaPlantilla(quien)) {
      expect(asunto).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test('lo que escribió una persona sale escapado en el cuerpo', () => {
    // El nombre sale en todos los saludos, el correo en el alta y la dirección en los
    // avisos de pago. Los tres los escribió alguien, y el correo los pinta como HTML.
    const malicioso: Destinatario = {
      ...quien,
      nombres: '<script>alert(1)</script>',
      email: '"><script>alert(2)</script>@test.com',
    };

    for (const [{ cuerpoHtml }] of cadaPlantilla(malicioso, '<script>alert(3)</script>')) {
      expect(cuerpoHtml).not.toMatch(/<script/i);
      expect(cuerpoHtml).toContain('&lt;script&gt;');
    }
  });

  test('cada botón lleva a una ruta de la SPA, desde URL_APP', () => {
    for (const [{ cuerpoHtml }, ruta] of cadaPlantilla(quien)) {
      const enlaces = [...cuerpoHtml.matchAll(/href="([^"]*)"/g)].map((coincidencia) => coincidencia[1]);

      // El primero es el del botón; el de recuperación lo repite en texto.
      expect(enlaces[0]).toBe(`${URL_APP}${ruta}`);
      for (const enlace of enlaces) {
        expect(enlace?.startsWith(`${URL_APP}/`)).toBe(true);
      }
    }
  });

  test('la cuenta de cobro generada no habla de un inmueble: el evento no lo trae', () => {
    expect(cuentaCobroGenerada(generada, quien).cuerpoHtml).not.toMatch(/inmueble/i);
  });

  test('la dirección del asunto va sin escapar, en una línea y cabiendo en la columna', () => {
    // El asunto es texto plano: escaparlo pintaría «&amp;» en la bandeja. Y va a
    // `notificaciones.envios.asunto`, VARCHAR(255) como la dirección misma: sin
    // recortar, la inserción fallaría y el evento se reintentaría hasta apartarse.
    const conSalto = { ...base, direccion_inmueble: 'Calle 123\n#45-67 & Torre 2' };

    expect(porVencerPropietario({ ...conSalto, entra_en_mora_el: '2026-06-07' }, quien).asunto).toBe(
      'Pago por vencer: Calle 123 #45-67 & Torre 2',
    );

    const larga = { ...base, direccion_inmueble: 'x'.repeat(255) };
    const asuntos = [
      porVencerPropietario({ ...larga, entra_en_mora_el: '2026-06-07' }, quien).asunto,
      enMoraPropietario({ ...larga, dias_de_mora: 7 }, quien).asunto,
    ];

    for (const asunto of asuntos) {
      expect(Array.from(asunto).length).toBeLessThanOrEqual(255);
    }
  });
});
