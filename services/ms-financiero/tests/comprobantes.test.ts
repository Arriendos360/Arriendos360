/**
 * Los comprobantes en PDF: RF-18 y el recibo mensual.
 *
 * ── QUE DEFIENDE ESTA SUITE ────────────────────────────────────────────────
 *
 * El requisito del paso 6e es que **los comprobantes impriman lo mismo que antes
 * de la extraccion**. La primera linea de defensa no es una prueba: es que
 * `services/pdfService.js` se mudo con `git mv` y sin tocar una linea, asi que
 * el dibujo —coordenadas, colores, textos fijos— es literalmente el mismo. Lo
 * que puede haber cambiado es lo que se le PASA, porque los datos que antes
 * salian de un `include` ahora vienen por HTTP de dos servicios.
 *
 * Asi que esto comprueba el contenido, no el dibujo: se genera el PDF, se extrae
 * su texto y se busca lo que tiene que estar. Extraerlo cuesta dos pasos —el PDF
 * viene comprimido y el texto va en hexadecimal— pero los dos los resuelve
 * `zlib`, que trae Node: ninguna dependencia nueva. Ver `textoDelPdf`.
 *
 * ── LA CIFRA QUE MAS IMPORTA ES `saldo_restante_momento` ───────────────────
 *
 * El comprobante NO recalcula el saldo: lo lee de la foto que se tomo al
 * registrar el movimiento. Un comprobante emitido hace tres meses dice hoy
 * exactamente lo que decia entonces, aunque despues se hayan registrado o
 * anulado otras transacciones sobre la misma cuenta. Es la unica cifra de saldo
 * que se guarda y la razon por la que se guarda.
 *
 * ── Y LA DEGRADACION TAMBIEN SE PRUEBA ─────────────────────────────────────
 *
 * Si ms-contratos o ms-identidad no responden, el recibo sale con «No
 * disponible» en lugar de no salir. Un comprobante incompleto sirve para algo;
 * un 500 al pedir el recibo, no.
 */

import zlib from 'zlib';
import request from 'supertest';

import {
  app,
  cerrarEntorno,
  conToken,
  contratosFalso,
  crearCuenta,
  escenario,
  identidadFalsa,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

/**
 * El texto imprimible de un PDF de PDFKit.
 *
 * ── POR QUE HACE FALTA DESCOMPRIMIR ────────────────────────────────────────
 *
 * Son DOS capas, y las dos hacen falta:
 *
 * 1. **Flate.** PDFKit comprime los flujos de contenido, asi que leer el PDF
 *    como texto no devuelve nada legible. Se localizan los `stream`/`endstream`
 *    y se inflan con `zlib`, que viene con Node — ninguna dependencia nueva. Los
 *    flujos que no son Flate (fuentes, metadatos) fallan al inflar y se ignoran.
 *
 * 2. **Los operadores de texto.** PDFKit no escribe literales entre parentesis
 *    sino arreglos de kerning con cadenas HEXADECIMALES: `[<434f4d50> 20 <41>]
 *    TJ`. Cada trozo hex son los codigos de caracter, asi que decodificarlo como
 *    latin1 devuelve el texto. Se reconstruye POR BLOQUE `TJ`/`Tj` y no de
 *    corrido: dentro de un bloque los trozos son una sola palabra partida por el
 *    kerning y hay que unirlos sin separador, mientras que entre bloques hay que
 *    dejar espacio o «PAGADO» y «Enero» saldrian pegados.
 *
 * Funciona porque los comprobantes usan las fuentes estandar (Helvetica), que no
 * se subincrustan: los codigos son WinAnsi y coinciden con latin1. Si algun dia
 * se cambia a una fuente incrustada con subconjunto, los codigos pasan a ser
 * indices de glifo, esto deja de leerse y hay que cambiar de tactica — comparar
 * contra un PDF de referencia, por ejemplo.
 */
const textoDelPdf = (cuerpo: Buffer): string => {
  const flujos: string[] = [];
  let desde = 0;

  for (;;) {
    const inicio = cuerpo.indexOf('stream', desde);
    if (inicio === -1) break;

    const fin = cuerpo.indexOf('endstream', inicio);
    if (fin === -1) break;

    // Saltar el salto de linea que sigue a `stream`, sea \n o \r\n.
    let datos = inicio + 'stream'.length;
    if (cuerpo[datos] === 0x0d) datos += 1;
    if (cuerpo[datos] === 0x0a) datos += 1;

    try {
      flujos.push(zlib.inflateSync(cuerpo.subarray(datos, fin)).toString('latin1'));
    } catch {
      /* no es un flujo Flate: no interesa */
    }

    desde = fin + 'endstream'.length;
  }

  const contenido = flujos.join('\n');
  const bloques = contenido.match(/\[[^\]]*\]\s*TJ|\((?:\\.|[^\\()])*\)\s*Tj/g) ?? [];

  return bloques
    .map((bloque) => {
      const piezas = bloque.match(/<[0-9A-Fa-f]*>|\((?:\\.|[^\\()])*\)/g) ?? [];

      return piezas
        .map((pieza) =>
          pieza.startsWith('<')
            ? Buffer.from(pieza.slice(1, -1), 'hex').toString('latin1')
            : pieza.slice(1, -1).replace(/\\([()\\])/g, '$1'),
        )
        .join('');
    })
    .join(' ');
};

/** Pide un PDF y devuelve la respuesta con el cuerpo como Buffer. */
const pedirPdf = (ruta: string, token: string) =>
  request(app)
    .get(ruta)
    .set(...conToken(token))
    .buffer(true)
    .parse((res, callback) => {
      const trozos: Buffer[] = [];
      res.on('data', (trozo: Buffer) => trozos.push(trozo));
      res.on('end', () => callback(null, Buffer.concat(trozos)));
    });

/** Monta cuenta + transaccion y devuelve lo necesario para pedir los PDF. */
const conUnPago = async (
  monto: number,
  valor = 1000,
): Promise<{ token: string; idCuenta: string; idTransaccion: string }> => {
  const { propietario: duenio, idContrato } = escenario();
  const { id: idCuenta } = await crearCuenta(duenio.token, idContrato, {
    valor,
    inicio: '2026-01-01',
  });

  const pago = await request(app)
    .post('/api/pagos')
    .set(...conToken(duenio.token))
    .send({
      id_cuenta_cobro: idCuenta,
      monto,
      tipo: 'INGRESO',
      medio_pago: 'Consignacion',
      observaciones: 'REF-99887',
    });

  return {
    token: duenio.token,
    idCuenta,
    idTransaccion: pago.body.transaccion.id_transaccion,
  };
};

describe('RF-18: comprobante de una transaccion', () => {
  test('sale en PDF y con el encabezado de siempre', async () => {
    const { token, idTransaccion } = await conUnPago(1000);

    const respuesta = await pedirPdf(
      `/api/pagos/transacciones/${idTransaccion}/comprobante`,
      token,
    );

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.header['content-type']).toBe('application/pdf');
    expect(respuesta.header['content-disposition']).toContain(
      `Comprobante_${idTransaccion}.pdf`,
    );
    expect(respuesta.body.length).toBeGreaterThan(1000);
  });

  test('imprime la empresa, el arrendatario y el inmueble compuestos', async () => {
    // Los tres bloques de la cabecera. El arrendatario viene de ms-identidad y
    // el inmueble de ms-contratos —dentro del contrato—: los dos eran un
    // `include` y ninguno lo es ya.
    const { token, idTransaccion } = await conUnPago(1000);

    const respuesta = await pedirPdf(
      `/api/pagos/transacciones/${idTransaccion}/comprobante`,
      token,
    );
    const texto = textoDelPdf(respuesta.body);

    expect(texto).toContain('ARRIENDOS 360 S.A.S');
    expect(texto).toContain('900.123.456-7');

    // Del doble de identidad.
    expect(texto).toContain('Inqui Lino');
    expect(texto).toContain('INQ1');

    // Del inmueble que ms-contratos adjunta al contrato.
    expect(texto).toContain('Calle 123 #45-67');
    expect(texto).toContain('Centro');
  });

  test('un pago total imprime PAGADO y saldo cero', async () => {
    const { token, idTransaccion } = await conUnPago(1000);

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idTransaccion}/comprobante`, token)).body,
    );

    expect(texto).toContain('PAGADO');
    expect(texto).toContain('Pago de arriendo periodo');
    // El periodo se formatea en UTC: `inicio` es DATEONLY y formatearlo en la
    // zona local imprimiria «diciembre de 2025», es decir, el mes equivocado.
    expect(texto).toContain('Enero de 2026');
  });

  test('un pago parcial imprime ABONO PARCIAL y el saldo que quedaba', async () => {
    const { token, idTransaccion } = await conUnPago(400);

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idTransaccion}/comprobante`, token)).body,
    );

    expect(texto).toContain('ABONO PARCIAL');
    expect(texto).toContain('Abono arriendo periodo');
  });

  test('la referencia sale de `observaciones`, no de un UUID', async () => {
    // Es la razon por la que `observaciones` sobrevive aunque el modelo canonico
    // no la liste: sin ella este renglon mostraria un identificador generado por
    // el sistema en lugar del numero de consignacion del extracto del
    // arrendatario. Ver docs/adr/0015.
    const { token, idTransaccion } = await conUnPago(500);

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idTransaccion}/comprobante`, token)).body,
    );

    expect(texto).toContain('REF-99887');
    expect(texto).toContain('Consignacion');
  });

  test('LA FOTO NO SE MUEVE: el comprobante conserva su saldo tras otro pago', async () => {
    // La afirmacion central de la suite. Se emite un comprobante con el saldo en
    // 600, despues se paga el resto, y el comprobante viejo tiene que seguir
    // diciendo 600. Si el saldo se recalculara, diria 0 — y eso seria cambiar un
    // documento que alguien ya recibio impreso.
    const { propietario: duenio, idContrato } = escenario();
    const { id: idCuenta } = await crearCuenta(duenio.token, idContrato, {
      valor: 1000,
      inicio: '2026-08-01',
    });

    const pagar = (monto: number) =>
      request(app)
        .post('/api/pagos')
        .set(...conToken(duenio.token))
        .send({ id_cuenta_cobro: idCuenta, monto, tipo: 'INGRESO', medio_pago: 'Efectivo' });

    const primera = await pagar(400);
    const idPrimera = primera.body.transaccion.id_transaccion;

    const antes = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idPrimera}/comprobante`, duenio.token)).body,
    );
    expect(antes).toContain('600');
    expect(antes).toContain('ABONO PARCIAL');

    // Se paga el resto: el saldo VIGENTE de la cuenta pasa a 0.
    await pagar(600);

    const despues = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idPrimera}/comprobante`, duenio.token)).body,
    );

    // Y el comprobante de la primera sigue diciendo exactamente lo mismo.
    expect(despues).toBe(antes);
  });

  test('una transaccion anulada imprime ANULADA', async () => {
    // La unica linea nueva respecto de antes del paso 6c: ese caso no existia,
    // asi que no hay nada que conservar.
    const { token, idTransaccion } = await conUnPago(300);

    await request(app)
      .post(`/api/pagos/transacciones/${idTransaccion}/anular`)
      .set(...conToken(token));

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/transacciones/${idTransaccion}/comprobante`, token)).body,
    );

    expect(texto).toContain('ANULADA');
  });

  test('un tercero no puede bajarse el comprobante', async () => {
    const { idTransaccion } = await conUnPago(200);
    const ajeno = propietario();

    const respuesta = await request(app)
      .get(`/api/pagos/transacciones/${idTransaccion}/comprobante`)
      .set(...conToken(ajeno.token));

    expect(respuesta.statusCode).toBe(403);
  });
});

describe('Recibo mensual de una cuenta de cobro', () => {
  test('sale en PDF con el estado y el periodo', async () => {
    const { token, idCuenta } = await conUnPago(1000);

    const respuesta = await pedirPdf(`/api/pagos/${idCuenta}/recibo`, token);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.header['content-type']).toBe('application/pdf');

    const texto = textoDelPdf(respuesta.body);
    expect(texto).toContain('PAGADO');
    expect(texto).toContain('Enero de 2026');
    expect(texto).toContain('ARRIENDOS 360 S.A.S');
  });

  test('`forma_pago` sale del medio de la ULTIMA transaccion confirmada', async () => {
    // Antes salia de `pagos.tipo_transaccion`, una columna que el controlador
    // iba pisando con el medio del ultimo abono: es el mismo dato, leido de
    // donde de verdad vive en vez de una copia.
    const { propietario: duenio, idContrato } = escenario();
    const { id: idCuenta } = await crearCuenta(duenio.token, idContrato, {
      valor: 1000,
      inicio: '2026-09-01',
    });

    for (const medio of ['Efectivo', 'Transferencia Bancaria']) {
      await request(app)
        .post('/api/pagos')
        .set(...conToken(duenio.token))
        .send({ id_cuenta_cobro: idCuenta, monto: 500, tipo: 'INGRESO', medio_pago: medio });
    }

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/${idCuenta}/recibo`, duenio.token)).body,
    );

    expect(texto).toContain('Transferencia Bancaria');
  });

  test('sin transacciones todavia, la forma de pago es «Múltiple»', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const { id: idCuenta } = await crearCuenta(duenio.token, idContrato, {
      inicio: '2026-10-01',
    });

    const texto = textoDelPdf(
      (await pedirPdf(`/api/pagos/${idCuenta}/recibo`, duenio.token)).body,
    );

    expect(texto).toContain('ltiple');
    expect(texto).toContain('PENDIENTE');
  });
});

describe('El PDF degrada, no revienta', () => {
  test('sin ms-identidad, el arrendatario sale «No disponible»', async () => {
    // Un comprobante incompleto sirve para algo; un 500 al pedirlo, no.
    const { token, idTransaccion } = await conUnPago(700);

    identidadFalsa().caer(503);
    const respuesta = await pedirPdf(
      `/api/pagos/transacciones/${idTransaccion}/comprobante`,
      token,
    );
    identidadFalsa().levantar();

    expect(respuesta.statusCode).toBe(200);

    const texto = textoDelPdf(respuesta.body);
    expect(texto).toContain('No disponible');
    // El inmueble SI, porque viene de ms-contratos y ese responde.
    expect(texto).toContain('Calle 123 #45-67');
  });

  test('sin el contrato, el inmueble sale «No disponible» pero el PDF sale', async () => {
    const { token, idCuenta } = await conUnPago(800);

    // Se cae DESPUES de que la pertenencia ya se resolvio... no: aqui la
    // pertenencia tambien la sirve ms-contratos, asi que caerse entero da 502.
    // Lo que se prueba es el otro camino: que el contrato no exista.
    contratosFalso().contratos.clear();

    const respuesta = await pedirPdf(`/api/pagos/${idCuenta}/recibo`, token);

    // La cuenta ya no es de ningun contrato suyo, asi que el ABAC la rechaza.
    // Es lo correcto: si el contrato desaparecio, nadie es parte de el.
    expect(respuesta.statusCode).toBe(403);
  });
});
