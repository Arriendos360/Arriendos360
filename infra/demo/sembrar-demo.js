/**
 * Datos de demostración para la sustentación.
 *
 * El seed de ms-identidad crea tres usuarios y nada más: sin inmuebles, sin contratos
 * y sin pagos, la aplicación se enseña vacía. Esto llena la cartera de la propietaria
 * de demostración con un caso de cada cosa que el sistema sabe hacer.
 *
 *   node infra/demo/sembrar-demo.js                                  # Compose local
 *   URL_GATEWAY=https://gateway-... node infra/demo/sembrar-demo.js  # Azure
 *
 * NO ESCRIBE EN NINGUNA BASE. Hace lo que haría una persona con el navegador: entrar
 * por el gateway con su token. De ahí salen tres propiedades que un `INSERT` a mano no
 * daría: respeta la regla dura 3 —cada esquema es de su servicio—, pasa por el RBAC y
 * el ABAC como cualquier petición, y los datos quedan coherentes solos, porque el
 * contrato anuncia su evento, `ms-inmuebles` pone el inmueble en `arrendado` y
 * `ms-financiero` emite la primera cuenta de cobro al recibirlo. De paso, sembrar es
 * una prueba de humo del sistema entero.
 *
 * Es idempotente: cada cosa se busca antes de crearla —el inmueble por su dirección,
 * el contrato por su inmueble, la cuenta por su periodo, los pagos por su cuenta—, así
 * que repetirlo no duplica nada y completa lo que haya quedado a medias.
 *
 * DESPUÉS HAY QUE CORRER EL MOTOR, que es lo que marca la mora y avisa de ella. Lo dice
 * al terminar. No se hace desde aquí porque no hay API que lo dispare —es un Job en
 * Azure y un cron en Compose (`docs/adr/0021`)— y porque el atajo tentador,
 * `POST /api/pagos/verificar-mora`, marca la mora sin avisar a nadie y deja las cuentas
 * fuera del alcance del motor para siempre.
 *
 * Requisitos: Node 18 (sólo usa `fetch`, sin dependencias) y el seed de ms-identidad ya
 * ejecutado —en Azure, el Job `seed-identidad`—, porque entra como su propietaria.
 *
 * Variables:
 *   URL_GATEWAY     por defecto `http://localhost:3001`.
 *   CORREO_DEMO     buzón real de la inquilina del sexto inmueble. Sus avisos de cobro y
 *                   de mora llegan de verdad, que es lo que hay que poder enseñar. Sin
 *                   ella se usa una dirección `@arriendos360.test`, que no existe y
 *                   rebota. Ninguna dirección personal entra al repositorio.
 */

const GATEWAY = (process.env.URL_GATEWAY || 'http://localhost:3001').replace(/\/$/, '');

/** La propietaria del seed de ms-identidad. Toda la cartera de demostración es suya. */
const PROPIETARIA = 'propietario@arriendos360.test';
const CONTRASENA = 'Prueba123';

/** Los documentos de los dos inquilinos del seed; el tercero lo da de alta este script. */
const DOCUMENTO_BRUNO = '10000002';
const DOCUMENTO_CARMEN = '10000003';

/**
 * Cuánto se espera a que responda una petición.
 *
 * En Azure las apps escalan a cero: la primera petición despierta al gateway y a quien
 * esté detrás, y eso son decenas de segundos. Un seeder puede permitirse esperar; lo
 * que no puede es fallar por impaciencia y dejar los datos a medias.
 */
const ESPERA_MS = 120000;

const dormir = (ms) => new Promise((listo) => setTimeout(listo, ms));

// ── Fechas ──────────────────────────────────────────────────────────────────
// Todo se calcula relativo a HOY para que la demostración no envejezca: sembrada en
// marzo o en septiembre, el historial llega siempre hasta el mes en curso.

/** Hoy en la zona del negocio, no en la del contenedor (CLAUDE.md, «Fechas»). */
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const [ANIO, MES, DIA] = hoyBogota().split('-').map(Number);

/**
 * El día de corte de todos los contratos es HOY.
 *
 * Así la cuenta del periodo en curso acaba de emitirse y se queda `PENDIENTE`. Con el
 * corte el día 1, `verificar-mora` la marcaría en mora junto con las atrasadas —saldo
 * mayor que cero y corte vencido es mora (`docs/adr/0018`)— y la demostración perdería
 * justo el estado más común. Se recorta a 28 para que el día pactado exista en
 * cualquier mes.
 */
const DIA_CORTE = Math.min(DIA, 28);

/** La fecha del día de corte, `n` meses atrás, como `YYYY-MM-DD`. */
const corteHaceMeses = (n) => {
  const fecha = new Date(Date.UTC(ANIO, MES - 1 - n, DIA_CORTE));
  return fecha.toISOString().slice(0, 10);
};

/** `dias` días después de una fecha, en ISO, para fechar un pago. */
const diasDespues = (fecha, dias) => {
  const cuando = new Date(`${fecha}T15:00:00Z`);
  cuando.setUTCDate(cuando.getUTCDate() + dias);
  return cuando.toISOString();
};

// ── Cliente HTTP ────────────────────────────────────────────────────────────

/**
 * Una petición al gateway, reintentando mientras el otro lado despierta.
 *
 * Sólo se reintenta lo que puede ser arranque en frío: un fallo de red o un 5xx. Un 400
 * o un 403 son respuestas de verdad y se devuelven tal cual, para que decida quien las
 * pidió.
 */
const pedir = async (metodo, ruta, { token, cuerpo } = {}) => {
  const limite = Date.now() + ESPERA_MS;
  let ultimoFallo = '';

  for (;;) {
    try {
      const respuesta = await fetch(GATEWAY + ruta, {
        method: metodo,
        headers: {
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
        signal: AbortSignal.timeout(90000),
      });

      let datos = null;
      try {
        datos = await respuesta.json();
      } catch {
        /* respuesta sin cuerpo JSON */
      }

      if (respuesta.status < 500 || Date.now() >= limite) {
        return { estado: respuesta.status, datos };
      }

      ultimoFallo = `${respuesta.status}`;
    } catch (error) {
      if (Date.now() >= limite) throw new Error(`${metodo} ${ruta}: ${error.message}`);
      ultimoFallo = error.message;
    }

    process.stdout.write('.');
    await dormir(3000);
  }
};

/** Como `pedir`, pero un estado inesperado corta el sembrado con un mensaje legible. */
const exigir = async (metodo, ruta, opciones, esperados) => {
  const { estado, datos } = await pedir(metodo, ruta, opciones);
  if (!esperados.includes(estado)) {
    throw new Error(`${metodo} ${ruta} respondió ${estado}: ${JSON.stringify(datos)}`);
  }
  return datos;
};

/** Reintenta hasta que lo que devuelve `obtener` cumpla, o se agote el plazo. */
const esperarA = async (obtener, cumple, limiteMs, queEsperaba) => {
  const limite = Date.now() + limiteMs;
  let ultimo = await obtener();

  while (Date.now() < limite && !cumple(ultimo)) {
    process.stdout.write('.');
    await dormir(2000);
    ultimo = await obtener();
  }

  if (!cumple(ultimo)) throw new Error(`Se agotó la espera: ${queEsperaba}`);
  return ultimo;
};

const entrar = async (email, contrasena) =>
  (await exigir('POST', '/api/auth/login', { cuerpo: { email, contrasena } }, [200])).token;

// ── Altas idempotentes ──────────────────────────────────────────────────────

/** El UUID de un usuario, buscado por documento como lo hace la SPA al firmar. */
const porDocumento = async (token, documento) =>
  (await exigir('GET', `/api/usuarios?documento=${documento}`, { token }, [200])).id;

/**
 * Da de alta al inquilino moroso si no existe.
 *
 * Nace con contraseña temporal y cambio obligatorio (`docs/adr/0007`), que es
 * justamente lo que conviene enseñar. Por eso los otros dos inquilinos son los del
 * seed: con ellos se entra sin trámite durante la demostración.
 */
const altaDeInquilino = async (token, definicion) => {
  const existente = await pedir('GET', `/api/usuarios?documento=${definicion.documento}`, { token });
  if (existente.estado === 200) {
    return { id: existente.datos.id, contrasena: 'la que ya tenía' };
  }

  const alta = await pedir('POST', '/api/usuarios/inquilinos', { token, cuerpo: definicion });

  // El correo es único en el sistema, así que una dirección ya usada por otra cuenta
  // —la del propietario con el que se probó la recuperación, por ejemplo— aborta el
  // sembrado con un 400 que por sí solo no dice qué hacer.
  if (alta.estado === 400 && /email ya está registrado/i.test(alta.datos?.mensaje || '')) {
    throw new Error(
      `${definicion.email} ya pertenece a otra cuenta. Siembra con CORREO_DEMO=<otra dirección>.`,
    );
  }

  if (alta.estado !== 201) {
    throw new Error(`No pude dar de alta a ${definicion.nombres}: ${JSON.stringify(alta.datos)}`);
  }

  return { id: alta.datos.usuario.id, contrasena: alta.datos.contrasena_temporal };
};

/** Crea el inmueble si no hay ya uno con esa dirección. */
const inmuebleDe = async (token, definicion) => {
  const listado = await exigir('GET', '/api/inmuebles', { token }, [200]);
  const existente = (Array.isArray(listado) ? listado : []).find(
    (inmueble) => inmueble.direccion === definicion.direccion,
  );
  if (existente) return existente;

  return (await exigir('POST', '/api/inmuebles', { token, cuerpo: definicion }, [201])).inmueble;
};

/** Firma el contrato si el inmueble no tiene el suyo, y espera a su primera cuenta. */
const contratoDe = async (token, idInmueble, alias, definicion) => {
  const listado = await exigir('GET', '/api/contratos', { token }, [200]);
  const existente = (Array.isArray(listado) ? listado : []).find(
    (contrato) => contrato.id_inmueble === idInmueble,
  );

  const contrato =
    existente ||
    (
      await exigir(
        'POST',
        '/api/contratos',
        { token, cuerpo: { id_inmueble: idInmueble, ...definicion } },
        [201],
      )
    ).contrato;

  // La primera cuenta de cobro la emite ms-financiero al recibir el evento, no esta
  // petición: hay que esperarla antes de cobrar nada sobre ella (regla dura 9).
  await esperarA(
    () => pedir('GET', `/api/pagos/contrato/${contrato.id_contrato}`, { token }),
    (respuesta) => Array.isArray(respuesta.datos) && respuesta.datos.length > 0,
    120000,
    `la primera cuenta de cobro del contrato de ${alias}`,
  );

  return contrato;
};

/** Emite la cuenta de cobro de un periodo si no existe ya. */
const cuentaDe = async (token, idContrato, inicio, valor) => {
  const cuentas = await exigir('GET', `/api/pagos/contrato/${idContrato}`, { token }, [200]);
  const existente = cuentas.find((cuenta) => String(cuenta.inicio).slice(0, 10) === inicio);
  if (existente) return existente;

  const datos = await exigir(
    'POST',
    '/api/pagos/cuentas-cobro',
    { token, cuerpo: { id_contrato: idContrato, valor, inicio } },
    [201],
  );

  return datos.cuenta_cobro || datos;
};

/**
 * Registra los pagos de una cuenta, si no tiene ninguno todavía.
 *
 * La comprobación es «¿tiene alguna transacción?» y no «¿tiene ésta?» a propósito: una
 * de las cuentas lleva un pago anulado y otro bueno, y distinguirlos uno a uno sólo
 * serviría para reinventar una clave de idempotencia que aquí no hace falta.
 */
const pagosDe = async (token, cuenta, pagos) => {
  const previas = await exigir('GET', `/api/pagos/${cuenta.id_cuenta_cobro}/transacciones`, { token }, [200]);
  if (previas.length > 0) return;

  for (const { anular, ...pago } of pagos) {
    const datos = await exigir(
      'POST',
      '/api/pagos',
      { token, cuerpo: { id_cuenta_cobro: cuenta.id_cuenta_cobro, tipo: 'INGRESO', ...pago } },
      [201],
    );

    // Anular no «devuelve» nada: el saldo se recalcula desde las transacciones
    // confirmadas (`docs/adr/0016`). Tener una anulada a la vista lo demuestra.
    if (anular) {
      await exigir(
        'POST',
        `/api/pagos/transacciones/${datos.transaccion.id_transaccion}/anular`,
        { token },
        [200],
      );
    }
  }
};

// ── El guión ────────────────────────────────────────────────────────────────

/**
 * Cinco inmuebles que entre todos cubren cada estado del sistema.
 *
 * `disponible` y `arrendado`; contrato `activo` y `finalizado`; cuentas de cobro
 * `PAGADA`, `PENDIENTE`, `PARCIAL` y `EN_MORA`; transacciones `CONFIRMADA` y `ANULADA`.
 * Lo que no se puede enseñar no se puede sustentar.
 */
const CARTERA = [
  {
    alias: 'Apartamento de Chapinero',
    inmueble: {
      direccion: 'Calle 63 # 9-45 Apto 502',
      barrio: 'Chapinero Central',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'apartamento',
      habitaciones: 3,
      banos: 2,
      area_m2: 78,
      estrato: 4,
      parqueaderos: 1,
    },
    inquilino: 'bruno',
    contrato: { mesesDeAntiguedad: 3, meses: 12, canon: 1800000 },
    // Un inquilino cumplido: todo lo vencido pagado y el periodo en curso pendiente.
    historial: [
      { hace: 3, pagos: [{ monto: 1800000, medio_pago: 'Transferencia', enDias: 2 }] },
      { hace: 2, pagos: [{ monto: 1800000, medio_pago: 'Transferencia', enDias: 3 }] },
      { hace: 1, pagos: [{ monto: 1800000, medio_pago: 'Transferencia', enDias: 1 }] },
      { hace: 0, pagos: [] },
    ],
  },
  {
    alias: 'Casa de Suba',
    inmueble: {
      direccion: 'Carrera 58 # 128-30',
      barrio: 'Niza',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'casa',
      habitaciones: 4,
      banos: 3,
      area_m2: 145,
      estrato: 5,
      parqueaderos: 2,
    },
    inquilino: 'carmen',
    contrato: {
      mesesDeAntiguedad: 2,
      meses: 24,
      canon: 2400000,
      nombre_deudor_solidario: 'Jorge Enrique Ruiz',
      documento_deudor_solidario: '79456321',
    },
    // Un pago anulado y rehecho, y un abono parcial sobre el periodo en curso.
    historial: [
      {
        hace: 2,
        pagos: [
          { monto: 2400000, medio_pago: 'Efectivo', enDias: 4, observaciones: 'Registrado con el valor equivocado', anular: true },
          { monto: 2400000, medio_pago: 'Transferencia', enDias: 5 },
        ],
      },
      { hace: 1, pagos: [{ monto: 2400000, medio_pago: 'Transferencia', enDias: 2 }] },
      { hace: 0, pagos: [{ monto: 1200000, medio_pago: 'Transferencia', enDias: 0, observaciones: 'Abono; queda saldo pendiente' }] },
    ],
  },
  {
    alias: 'Apartaestudio de Teusaquillo',
    inmueble: {
      direccion: 'Calle 34 # 18-22 Apto 301',
      barrio: 'Teusaquillo',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'apartaestudio',
      habitaciones: 1,
      banos: 1,
      area_m2: 42,
      estrato: 3,
    },
    inquilino: 'moroso',
    contrato: { mesesDeAntiguedad: 1, meses: 12, canon: 1250000 },
    // Nada pagado: `verificar-mora`, al final, deja en mora lo vencido.
    historial: [
      { hace: 1, pagos: [] },
      { hace: 0, pagos: [] },
    ],
  },
  {
    alias: 'Oficina del centro',
    inmueble: {
      direccion: 'Carrera 7 # 32-16 Oficina 704',
      barrio: 'San Diego',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'oficina',
      banos: 1,
      area_m2: 55,
      estrato: 4,
    },
    inquilino: 'carmen',
    // Contrato terminado: al finalizarlo, el inmueble vuelve a `disponible` por evento
    // (`docs/adr/0013`). Su única cuenta queda pagada para que no aparezca en mora.
    contrato: { mesesDeAntiguedad: 14, meses: 12, canon: 3100000 },
    finalizar: true,
    historial: [{ hace: 14, pagos: [{ monto: 3100000, medio_pago: 'Transferencia', enDias: 3 }] }],
  },
  {
    alias: 'Apartamento de Cedritos',
    inmueble: {
      direccion: 'Calle 140 # 11-52 Apto 802',
      barrio: 'Cedritos',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'apartamento',
      habitaciones: 2,
      banos: 2,
      area_m2: 64,
      estrato: 4,
      parqueaderos: 1,
    },
    // La única inquilina con buzón real (`CORREO_DEMO`). No paga nada, así que sus avisos
    // de cobro y de mora llegan a un correo que se puede abrir delante del jurado. Los
    // demás inquilinos son ficticios a propósito y sus correos rebotan.
    inquilino: 'buzon',
    contrato: { mesesDeAntiguedad: 3, meses: 12, canon: 2100000 },
    historial: [
      { hace: 3, pagos: [] },
      { hace: 2, pagos: [] },
      { hace: 1, pagos: [] },
      { hace: 0, pagos: [] },
    ],
  },
  {
    alias: 'Local de Kennedy',
    inmueble: {
      direccion: 'Avenida 1 de Mayo # 42-18 Local 3',
      barrio: 'Kennedy Central',
      municipio: 'Bogotá D.C.',
      departamento: 'Cundinamarca',
      tipo: 'local',
      banos: 1,
      area_m2: 60,
      estrato: 3,
    },
    // Sin contrato: es el que se usa para enseñar el alta de uno en vivo.
    contrato: null,
    historial: [],
  },
];

const MOROSO = {
  nombres: 'Diego',
  apellidos: 'Moroso',
  email: 'moroso@arriendos360.test',
  telefono: '3004444444',
  documento: '10000004',
};

/**
 * La inquilina del sexto inmueble: la única cuyos correos llegan a un buzón de verdad.
 *
 * Es otra persona y no el mismo moroso con otra dirección porque la API no permite
 * cambiarle el correo a un usuario ya creado, y el aviso no lo lleva el evento: lo
 * resuelve ms-notificaciones preguntándole a ms-identidad al manejarlo. Sembrar con
 * `CORREO_DEMO` después de haber sembrado sin ella tiene que poder arreglarlo.
 */
const CON_BUZON = {
  nombres: 'Elena',
  apellidos: 'Correa',
  email: process.env.CORREO_DEMO || 'buzon@arriendos360.test',
  telefono: '3005555555',
  documento: '10000005',
};

// ── Sembrado ────────────────────────────────────────────────────────────────

const sembrar = async () => {
  console.log(`Sembrando datos de demostración en ${GATEWAY}`);
  console.log(`Corte de todos los contratos: día ${DIA_CORTE} de cada mes.\n`);

  const token = await entrar(PROPIETARIA, CONTRASENA);

  const inquilinos = {
    bruno: await porDocumento(token, DOCUMENTO_BRUNO),
    carmen: await porDocumento(token, DOCUMENTO_CARMEN),
  };
  const moroso = await altaDeInquilino(token, MOROSO);
  inquilinos.moroso = moroso.id;
  const conBuzon = await altaDeInquilino(token, CON_BUZON);
  inquilinos.buzon = conBuzon.id;

  const resumen = [];

  for (const ficha of CARTERA) {
    process.stdout.write(`${ficha.alias} `);
    const inmueble = await inmuebleDe(token, ficha.inmueble);

    if (!ficha.contrato) {
      resumen.push({ inmueble: ficha.alias, estado: 'sin contrato', cuentas: 0 });
      console.log('· disponible');
      continue;
    }

    const inicio = corteHaceMeses(ficha.contrato.mesesDeAntiguedad);
    const fin = corteHaceMeses(ficha.contrato.mesesDeAntiguedad - ficha.contrato.meses);

    const contrato = await contratoDe(token, inmueble.id_inmueble, ficha.alias, {
      id_inquilino: inquilinos[ficha.inquilino],
      inicio,
      fin,
      canon: ficha.contrato.canon,
      fecha_inicio_corte: inicio,
      fecha_limite_pago: Math.min(DIA_CORTE + 5, 28),
      ...(ficha.contrato.nombre_deudor_solidario
        ? {
            nombre_deudor_solidario: ficha.contrato.nombre_deudor_solidario,
            documento_deudor_solidario: ficha.contrato.documento_deudor_solidario,
          }
        : {}),
    });

    for (const periodo of ficha.historial) {
      const desde = corteHaceMeses(periodo.hace);
      const cuenta = await cuentaDe(token, contrato.id_contrato, desde, ficha.contrato.canon);
      await pagosDe(
        token,
        cuenta,
        periodo.pagos.map(({ enDias, ...pago }) => ({
          ...pago,
          fecha_pago: diasDespues(desde, enDias),
        })),
      );
    }

    if (ficha.finalizar) {
      const actual = await exigir('GET', `/api/contratos/${contrato.id_contrato}`, { token }, [200]);
      if (actual.estado === 'activo') {
        await exigir('PUT', `/api/contratos/${contrato.id_contrato}/finalizar`, { token }, [200]);
      }
    }

    resumen.push({
      inmueble: ficha.alias,
      estado: ficha.finalizar ? 'contrato finalizado' : 'arrendado',
      cuentas: ficha.historial.length,
    });
    console.log('·', ficha.finalizar ? 'finalizado' : 'arrendado');
  }

  // La mora NO se marca aquí. `POST /api/pagos/verificar-mora` la marcaría, pero no
  // avisa a nadie: el aviso lo emite el motor, en la misma transacción que el cambio de
  // estado. Marcarla desde aquí dejaría las cuentas en mora y sin correo, y además ya no
  // habría forma de que el motor avisara después, porque sólo mira las PENDIENTE y
  // PARCIAL. Se deja vencido y sin pagar, y lo cierra el motor. Ver `docs/adr/0021`.
  console.log('\nCartera sembrada:');
  console.table(resumen);

  console.log('\nPara entrar:');
  console.table([
    { quien: 'Propietaria (Ana)', usuario: PROPIETARIA, contrasena: CONTRASENA },
    { quien: 'Inquilino (Bruno)', usuario: 'inquilino@arriendos360.test', contrasena: CONTRASENA },
    { quien: 'Los dos roles (Carmen)', usuario: 'ambos@arriendos360.test', contrasena: CONTRASENA },
    { quien: 'Inquilino moroso (Diego)', usuario: MOROSO.email, contrasena: moroso.contrasena },
    { quien: 'Inquilina con buzón (Elena)', usuario: CON_BUZON.email, contrasena: conBuzon.contrasena },
  ]);

  console.log(
    '\nFalta la mora: la marca el motor, que además avisa por correo a las dos partes.\n' +
      '  local:  npm run motor --workspace=services/ms-financiero\n' +
      '  Azure:  bash infra/azure/ejecutar-trabajo.sh motor-financiero',
  );

  if (!process.env.CORREO_DEMO) {
    console.log(
      '\nAviso: todos los correos van a direcciones @arriendos360.test, que no existen y\n' +
        'rebotan. Siembra con CORREO_DEMO=<tu correo> para que los de Elena lleguen de verdad.',
    );
  }
};

sembrar().catch((error) => {
  console.error('\n❌ No se pudo sembrar:', error.message);
  console.error('\n¿El seed de ms-identidad está aplicado y el gateway responde?');
  process.exit(1);
});
