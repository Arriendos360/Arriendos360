const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const { TIPOS_TRANSACCION } = require('arriendos360-contracts');

const {
    adjuntarContratoACuentas,
    adjuntarContratoATransacciones,
    adjuntarInmueble,
    adjuntarInquilino
} = require('../clientes/composicion');
const {
    contratosDePropietario,
    idsDondeEsParte,
    parteDe,
    porId: contratoPorId,
    propioDe: contratoPropioDe
} = require('../clientes/contratos');
const { CuentaCobro, Transaccion } = require('../models');
const {
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PARCIAL,
    ESTADO_CUENTA_PENDIENTE,
    ESTADO_TRANSACCION_ANULADA,
    ESTADO_TRANSACCION_CONFIRMADA,
    TIPO_TRANSACCION_INGRESO
} = require('../models/constantes');
const {
    diaDeCorte,
    hoyEnZonaNegocio,
    periodoQueEmpiezaEn,
    soloFecha
} = require('arriendos360-shared');
const { esUuid } = require('../models/uuid');
const { periodoAFacturar } = require('../services/financialEngine');
const {
    conSaldo,
    conSaldoAnidado,
    conSaldos,
    estadoSegunSaldo,
    fechaPagoSegunSaldo,
    saldoDe
} = require('../services/saldos');
const { generarPDFComprobante } = require('../services/pdfService');

/**
 * Cuentas de cobro y transacciones.
 *
 * ── QUÉ CAMBIÓ EN EL PASO 6c ─────────────────────────────────────────────────
 *
 * El controlador seguía llamándose de pagos y abonos porque las tablas también.
 * Ahora son `Cuentas_cobro` y `Transacciones`, que NO son las mismas cosas con
 * otro nombre: una cuenta de cobro es la factura que el sistema genera; una
 * transacción es el movimiento de dinero contra ella. Consecuencias visibles
 * aquí:
 *
 * 1. `PUT /api/pagos/:id/pagar` desaparece y su trabajo lo hace
 *    `POST /api/pagos`, con el cuerpo que fija el Capítulo 2:
 *    `id_cuenta_cobro`, `monto`, `tipo`, `medio_pago`, `fecha_pago`. El alta
 *    manual de una cuenta, que era la que ocupaba `POST /api/pagos`, se movió a
 *    `POST /api/pagos/cuentas-cobro`.
 * 2. El saldo no se guarda ni se resta a mano: se deriva de las transacciones
 *    confirmadas (`services/saldos.js`) y se adjunta a la respuesta con el mismo
 *    nombre de campo, `saldo_pendiente`, que tenía la columna.
 * 3. Hay anulación. Anular no borra: cambia el `estado` de la transacción, y el
 *    saldo se corrige solo porque la suma deja de contarla. Ver `docs/adr/0016`.
 *
 * ── QUÉ CAMBIÓ EN EL PASO 6d ─────────────────────────────────────────────────
 *
 * CLAUDE.md tenía anotado como decisión abierta el salto Financiero -> Contratos:
 * la visibilidad se decidía con un `Op.or` sobre columnas alcanzadas por un
 * `include`, es decir, un JOIN que cruzaba dos bounded contexts. Se resolvió al
 * irse `contratos`, porque dejó de ser posible.
 *
 * LA DISYUNCIÓN NO CAMBIA: se ve una cuenta si eres el dueño del inmueble O el
 * inquilino del contrato. Lo que cambia es quién la evalúa. El paso 4 la resolvía
 * en dos pasos desde aquí —pedir los inmuebles del propietario y filtrar por esa
 * lista—; ahora la resuelve ms-contratos entera y de una vez, porque es quien
 * tiene la mitad barata (`id_inquilino` es columna suya) y quien puede pedir la
 * cara (`id_propietario` está en ms-inmuebles).
 *
 * Aquí llega ya resuelta, como una lista de identificadores de contrato que
 * entra en un `IN` contra la base local. **Un salto de red donde antes había
 * dos**, y la regla escrita una vez en vez de tres.
 *
 * ── EL ORDEN DE LAS DOS COMPROBACIONES IMPORTA ───────────────────────────────
 *
 * En los endpoints que escriben, la pertenencia se comprueba ANTES de tocar
 * nada, y el fallo de red se propaga: nunca se degrada a 403. Decirle a alguien
 * «no tienes permisos» cuando en realidad no se ha podido comprobar es la peor
 * de las respuestas posibles, y es la política que `clientes/contratos.js`
 * documenta para todo lo que autoriza.
 */

/**
 * 502 con el formato de error del proyecto.
 *
 * El mensaje nombra a Contratos y no a Inmuebles desde el paso 6d: es el
 * servicio con el que este controlador habla para autorizar, y el que responde
 * cuando la pertenencia no se puede comprobar.
 */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);
    return res.status(502).json({ mensaje: 'No se pudo contactar el servicio de contratos' });
};

/**
 * ¿Este error viene de no poder hablar con ms-contratos?
 *
 * Existe porque `crearCuentaCobro` tiene un solo `try` que cubre la
 * comprobación de pertenencia y la escritura, y las dos fallan distinto: una es
 * la red y la otra la base. Distinguirlas es lo que separa un 502 honesto de un
 * 500 con el mensaje interno dentro.
 */
const esFalloDeContratos = (error) =>
    typeof error.message === 'string' && error.message.includes('ms-contratos');

/**
 * Lo que sustituye al `Op.or` sobre columnas del `include`.
 *
 * `misContratos` es la lista que devuelve ms-contratos para el usuario, ya con
 * las dos ramas de la disyunción aplicadas. Aquí sólo se filtra por ella.
 */
const deMisContratos = (misContratos) => ({
    id_contrato: { [Op.in]: misContratos }
});

/** ¿Es esta cuenta de cobro de uno de mis contratos? */
const puedeVerCuenta = (cuenta, misContratos) => misContratos.includes(cuenta.id_contrato);

// Obtener todas las cuentas de cobro en las que el usuario es parte
const obtenerTodos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        // UNA petición: la disyunción de pertenencia ya viene resuelta.
        const misContratos = await idsDondeEsParte(sub);

        const cuentas = await CuentaCobro.findAll({ where: deMisContratos(misContratos) });

        // Tres composiciones, cada una con un lote: el contrato y su inmueble
        // salen de dos servicios, y el saldo de una consulta agrupada local.
        res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener cuentas de cobro');
    }
};

// Obtener cuentas de cobro por contrato
const obtenerPorContrato = async (req, res) => {
    try {
        const { id_contrato } = req.params;
        const { sub } = req.usuario;

        // La disyunción entera en una llamada: ms-contratos ya sabe si este
        // usuario es el dueño del inmueble o el inquilino.
        const contrato = esUuid(id_contrato) ? await parteDe(id_contrato, sub) : null;

        if (!contrato) {
            return res
                .status(403)
                .json({ mensaje: 'No tienes permisos para ver los pagos de este contrato' });
        }

        const cuentas = await CuentaCobro.findAll({
            where: { id_contrato },
            order: [['inicio', 'ASC']]
        });
        res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener pagos del contrato');
    }
};

/**
 * Alta manual de una cuenta de cobro — `POST /api/pagos/cuentas-cobro`.
 *
 * Ocupa el sitio de la vieja `POST /api/pagos`, que tuvo que mudarse: esa ruta
 * es ahora la del registro de un pago, según el Capítulo 2.
 *
 * El camino normal es que las cuentas las genere el motor. Esto existe para la
 * demostración y para corregir a mano, y por eso el periodo se puede omitir: se
 * deriva del ciclo de facturación del contrato con la MISMA función que usa el
 * motor, `periodoDeCorte()`, y no con una segunda cuenta que podría separarse.
 */
const crearCuentaCobro = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const { id_contrato, valor, detalle } = req.body;

        // Cobrar es exclusivo del dueño del inmueble, así que aquí no basta con
        // ser parte: hay que ser el propietario. Se le pregunta a ms-contratos,
        // que resuelve las dos mitades —el contrato y de quién es su inmueble—
        // en un solo salto.
        const contrato = esUuid(id_contrato) ? await contratoPropioDe(id_contrato, sub) : null;

        if (!contrato) {
            return res.status(403).json({ mensaje: 'No tienes permisos sobre este contrato' });
        }

        const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
        const inicioPedido = soloFecha(req.body.inicio);

        // Si viene `inicio`, el `fin` se calcula con el día pactado del contrato
        // y no con «un mes menos un día»: los periodos tienen que seguir
        // teselando el calendario aunque la cuenta se cree a mano.
        const periodo = inicioPedido
            ? { ...periodoQueEmpiezaEn(inicioPedido, diaCorte), inicio: inicioPedido }
            : periodoAFacturar(diaCorte, hoyEnZonaNegocio());

        const fin = soloFecha(req.body.fin) || periodo.fin;

        const cuenta = await CuentaCobro.create(
            {
                id_contrato,
                valor,
                inicio: periodo.inicio,
                fin,
                detalle: detalle || `Canon de arrendamiento del ${periodo.inicio} al ${fin}`,
                estado: ESTADO_CUENTA_PENDIENTE
            },
            { usuarioAuditor: sub }
        );

        res.status(201).json({
            mensaje: 'Cuenta de cobro registrada exitosamente',
            cuenta_cobro: await conSaldo(cuenta)
        });
    } catch (error) {
        // Un fallo de ms-contratos no es un 500 nuestro: no se pudo comprobar la
        // pertenencia, y eso es 502.
        if (esFalloDeContratos(error)) {
            return responderServicioCaido(res, error, 'verificar el contrato');
        }
        res.status(500).json({ mensaje: 'Error al crear la cuenta de cobro', error: error.message });
    }
};

/**
 * Registrar un pago — `POST /api/pagos`. RF-17.
 *
 * El cuerpo es el del Capítulo 2. `tipo` se admite ausente y cae en `INGRESO`,
 * que hoy es su único valor: exigir que el cliente mande una constante no añade
 * seguridad, pero mandar un valor que no existe sí es un error y se rechaza.
 *
 * El saldo se LEE dentro de la transacción y con la fila de la cuenta bloqueada.
 * Las dos cosas hacen falta: leer dentro evita arrastrar un saldo viejo, y
 * bloquear evita que dos registros simultáneos vean cada uno el saldo entero y
 * acepten los dos. La versión anterior no hacía ninguna de las dos —restaba
 * sobre `pago.saldo_pendiente` leído sin bloqueo— y podía cobrar de más.
 */
const registrarPago = async (req, res) => {
    const { sub } = req.usuario;
    const { id_cuenta_cobro, monto, medio_pago, observaciones } = req.body;
    const tipo = req.body.tipo || TIPO_TRANSACCION_INGRESO;

    if (!TIPOS_TRANSACCION.includes(tipo)) {
        return res.status(400).json({
            mensaje: `El tipo de transacción debe ser uno de: ${TIPOS_TRANSACCION.join(', ')}`
        });
    }

    // La pertenencia se resuelve ANTES de abrir la transacción: es una llamada
    // de red, y tenerla dentro alargaría el bloqueo de la fila por el tiempo que
    // tarde otro servicio en contestar.
    let misContratos;
    try {
        misContratos = await idsDondeEsParte(sub);
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    const t = await CuentaCobro.sequelize.transaction();
    try {
        const cuenta = esUuid(id_cuenta_cobro)
            ? await CuentaCobro.findByPk(id_cuenta_cobro, { transaction: t })
            : null;

        if (!cuenta) {
            await t.rollback();
            return res.status(404).json({ mensaje: 'Cuenta de cobro no encontrada' });
        }

        // `FOR UPDATE` sobre la fila de la cuenta, en una consulta aparte y sin
        // `include`: PostgreSQL rechaza el bloqueo sobre el lado anulable de un
        // LEFT JOIN, y pedirlo sobre la consulta con el contrato bloquearía
        // además filas de otro agregado sin ninguna necesidad.
        await CuentaCobro.findByPk(cuenta.id_cuenta_cobro, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const saldoActual = await saldoDe(cuenta, { transaction: t });

        if (parseFloat(monto) <= 0 || parseFloat(monto) > saldoActual) {
            await t.rollback();
            return res.status(400).json({ mensaje: 'Monto inválido o superior al saldo' });
        }

        if (!puedeVerCuenta(cuenta, misContratos)) {
            await t.rollback();
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const nuevoSaldo = Math.round((saldoActual - parseFloat(monto)) * 100) / 100;
        const momento = req.body.fecha_pago ? new Date(req.body.fecha_pago) : new Date();

        const transaccion = await Transaccion.create(
            {
                id_cuenta_cobro: cuenta.id_cuenta_cobro,
                monto,
                tipo,
                medio_pago,
                observaciones,
                fecha_pago: momento,
                estado: ESTADO_TRANSACCION_CONFIRMADA,
                // La foto histórica, la única cifra de saldo que se guarda.
                saldo_restante_momento: nuevoSaldo
            },
            { transaction: t, usuarioAuditor: sub }
        );

        await cuenta.update(
            {
                fecha_pago: fechaPagoSegunSaldo(nuevoSaldo, momento),
                estado: estadoSegunSaldo(cuenta.valor, nuevoSaldo, cuenta.estado)
            },
            { transaction: t, usuarioAuditor: sub }
        );

        await t.commit();

        res.status(201).json({
            mensaje: nuevoSaldo === 0 ? 'Pago completado exitosamente' : 'Pago parcial registrado exitosamente',
            cuenta_cobro: { ...cuenta.toJSON(), saldo_pendiente: nuevoSaldo },
            transaccion
        });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ mensaje: 'Error al registrar el pago', error: error.message });
    }
};

/**
 * Anular una transacción — `POST /api/pagos/transacciones/:id/anular`.
 *
 * ANULAR NO BORRA. Cambia el estado a `ANULADA` y recalcula el de la cuenta; el
 * saldo se corrige solo porque la suma que lo deriva ignora las anuladas. La
 * fila y su comprobante siguen existiendo, que es lo que separa una corrección
 * de una falsificación. Ver `docs/adr/0016`.
 *
 * El ABAC exige ser DUEÑO del inmueble, no sólo parte del contrato — el mismo
 * criterio que el alta de una cuenta de cobro y por el mismo motivo: esto
 * reescribe la contabilidad del arriendo, y quien la lleva es el propietario
 * (`docs/adr/0006`).
 *
 * Una transacción ya anulada responde 409 y no 403: el recurso es suyo y su rol
 * es el correcto, lo que falla es que no está en condiciones.
 */
const anularTransaccion = async (req, res) => {
    const { id_transaccion } = req.params;
    const { sub } = req.usuario;

    const t = await CuentaCobro.sequelize.transaction();
    try {
        const transaccion = esUuid(id_transaccion)
            ? await Transaccion.findByPk(id_transaccion, {
                include: [{ model: CuentaCobro }],
                transaction: t
            })
            : null;

        if (!transaccion || !transaccion.CuentaCobro) {
            await t.rollback();
            return res.status(404).json({ mensaje: 'Transacción no encontrada' });
        }

        const cuenta = transaccion.CuentaCobro;

        // Mismo bloqueo que al registrar, y por lo mismo: anular recalcula el
        // saldo, y un registro simultáneo sobre la misma cuenta lo dejaría mal.
        await CuentaCobro.findByPk(cuenta.id_cuenta_cobro, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        // Ser DUEÑO, no sólo parte. Un salto a ms-contratos, que comprueba de
        // paso de quién es el inmueble: el gateway ya no necesita saber que un
        // contrato tiene uno.
        let propio;
        try {
            propio = await contratoPropioDe(cuenta.id_contrato, sub);
        } catch (error) {
            await t.rollback();
            return responderServicioCaido(res, error, 'verificar el contrato');
        }

        if (!propio) {
            await t.rollback();
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        if (transaccion.estado === ESTADO_TRANSACCION_ANULADA) {
            await t.rollback();
            return res.status(409).json({ mensaje: 'La transacción ya está anulada' });
        }

        await transaccion.update({ estado: ESTADO_TRANSACCION_ANULADA }, {
            transaction: t,
            usuarioAuditor: sub
        });

        // Se relee DESPUÉS de anular: el saldo nuevo sale de la misma suma de
        // siempre, que ahora ya no cuenta esta transacción. No hay ninguna resta
        // que deshacer ni ningún estado anterior que recordar.
        const nuevoSaldo = await saldoDe(cuenta, { transaction: t });

        await cuenta.update(
            {
                fecha_pago: fechaPagoSegunSaldo(nuevoSaldo, cuenta.fecha_pago),
                estado: estadoSegunSaldo(cuenta.valor, nuevoSaldo, cuenta.estado)
            },
            { transaction: t, usuarioAuditor: sub }
        );

        await t.commit();

        res.json({
            mensaje: 'Transacción anulada',
            transaccion,
            cuenta_cobro: { ...cuenta.toJSON(), saldo_pendiente: nuevoSaldo }
        });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ mensaje: 'Error al anular la transacción', error: error.message });
    }
};

// Historial global de transacciones
const obtenerHistorialGlobal = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const misContratos = await idsDondeEsParte(sub);

        const transacciones = await Transaccion.findAll({
            where: { '$CuentaCobro.id_contrato$': { [Op.in]: misContratos } },
            include: [{ model: CuentaCobro, required: true }],
            order: [['fecha_pago', 'DESC']]
        });

        // El `include` que queda NO cruza frontera: `cuentas_cobro` y
        // `transacciones` son las dos tablas de Financiero y siguen aquí hasta
        // el paso 6e. Lo que sí se compone es el contrato y su inmueble, un
        // nivel más abajo: `transaccion.CuentaCobro.Contrato.Inmueble`.
        const conContrato = await adjuntarContratoATransacciones(transacciones);
        res.json(await conSaldoAnidado(conContrato, (fila) => fila.CuentaCobro));
    } catch (error) { return responderServicioCaido(res, error, 'obtener historial global'); }
};

// Formateador de moneda
const fmt = (v) => `$ ${parseFloat(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

/**
 * Formateador de periodo (Ej: Junio 2026).
 *
 * `timeZone: 'UTC'` NO es un adorno. `inicio` es `DATEONLY` y llega como
 * `'2026-06-01'`, que `Date` interpreta como medianoche UTC; formatearlo en la
 * zona local imprimiría «mayo de 2026» en Bogotá, es decir, el mes equivocado.
 * Es la misma zona que ya usa el `formatDate` del frontend.
 */
const fmtPeriodo = (fecha) =>
    new Date(fecha)
        .toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .replace(/^\w/, (c) => c.toUpperCase());

/**
 * Datos comunes de la cabecera de los comprobantes.
 *
 * El `arrendatario` lo compone el gateway pidiéndoselo a ms-identidad; su cédula
 * sale de `documento`. Lo que se imprime en el PDF es idéntico a antes.
 */
const datosEmpresa = {
    empresa_nombre: "ARRIENDOS 360 S.A.S",
    empresa_nit: "900.123.456-7",
    empresa_telefono: "+57 (601) 321 0000",
    empresa_email: "soporte@arriendos360.com",
    empresa_ciudad: "Bogotá D.C."
};

/**
 * Bloque del arrendatario.
 *
 * Tolera que falte: si ms-identidad no respondió, el recibo sale con «No
 * disponible» en lugar de no salir. Un comprobante incompleto sirve para algo;
 * un 500 al pedir el recibo, no.
 */
const datosArrendatario = (arrendatario) => ({
    nombre_arrendatario: arrendatario
        ? `${arrendatario.nombres} ${arrendatario.apellidos}`
        : 'No disponible',
    cedula_arrendatario: arrendatario ? arrendatario.documento : 'No disponible',
    telefono_arrendatario: (arrendatario && arrendatario.telefono) || 'No registrado',
    email_arrendatario: (arrendatario && arrendatario.email) || 'No registrado'
});

/**
 * Bloque del inmueble.
 *
 * Tolera que falte, igual que el del arrendatario: si ms-inmuebles no respondió,
 * el recibo sale con «No disponible» en lugar de no salir.
 */
const datosInmueble = (inmueble) => ({
    direccion_inmueble: inmueble ? inmueble.direccion : 'No disponible',
    barrio_ciudad: inmueble ? `${inmueble.barrio}, ${inmueble.municipio}` : 'No disponible',
    tipo_inmueble: inmueble ? inmueble.tipo : 'No disponible'
});

/** Envía un PDF ya construido con el mismo encabezado que usaba `window.open`. */
const responderPdf = (res, nombreArchivo, data) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    doc.pipe(res);
    generarPDFComprobante(doc, data);
    doc.end();
};

/**
 * Comprobante de una transacción — RF-18.
 *
 * IMPRIME LO MISMO QUE ANTES, y hay un dato que lo garantiza: el saldo del
 * comprobante NO se recalcula. Sale de `saldo_restante_momento`, que es la foto
 * que se tomó al registrar el movimiento. Un comprobante emitido hace tres meses
 * dice hoy exactamente lo que decía entonces, aunque después se hayan registrado
 * o anulado otras transacciones sobre la misma cuenta.
 *
 * La única línea nueva es el estado cuando la transacción está anulada: ese caso
 * no existía antes, así que no hay nada que conservar.
 */
const generarComprobante = async (req, res) => {
    try {
        const { id_transaccion } = req.params;
        const { sub } = req.usuario;

        const transaccion = esUuid(id_transaccion)
            ? await Transaccion.findByPk(id_transaccion, {
                include: [{ model: CuentaCobro }]
            })
            : null;

        if (!transaccion) return res.status(404).json({ mensaje: 'No encontrado' });

        const misContratos = await idsDondeEsParte(sub);

        if (!transaccion.CuentaCobro || !puedeVerCuenta(transaccion.CuentaCobro, misContratos)) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const cuenta = transaccion.CuentaCobro;
        // El contrato ya no viene del `include`: se pide, y sobre él se componen
        // el inmueble y el arrendatario que imprime el PDF.
        const delContrato = await contratoPorId(cuenta.id_contrato);
        const contrato = await adjuntarInquilino(await adjuntarInmueble(delContrato));
        const arrendatario = contrato ? contrato.Inquilino : null;
        const esTotal = parseFloat(transaccion.saldo_restante_momento) === 0;
        const periodo = fmtPeriodo(cuenta.inicio);

        const estadoImpreso = transaccion.estado === ESTADO_TRANSACCION_ANULADA
            ? 'ANULADA'
            : (esTotal ? 'PAGADO' : 'ABONO PARCIAL');

        responderPdf(res, `Comprobante_${id_transaccion}.pdf`, {
            ...datosEmpresa,
            ...datosArrendatario(arrendatario),
            ...datosInmueble(contrato && contrato.Inmueble),
            numero_comprobante: `TRX-${transaccion.id_transaccion}`,
            fecha_expedicion: new Date(transaccion.fecha_pago).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: estadoImpreso,
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(cuenta.valor),
            valor_pagado: fmt(transaccion.monto),
            saldo_anterior: fmt(parseFloat(transaccion.saldo_restante_momento) + parseFloat(transaccion.monto)),
            saldo_pendiente: fmt(transaccion.saldo_restante_momento),
            forma_pago: transaccion.medio_pago || 'Transferencia Bancaria',
            banco: 'Red Bancaria Nacional',
            referencia_pago: transaccion.observaciones || `Abono No. ${transaccion.id_transaccion}`
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
    }
};

/** Cómo se etiqueta cada estado en el recibo. Los cuatro textos son los de antes. */
const ETIQUETA_ESTADO = {
    [ESTADO_CUENTA_PENDIENTE]: 'PENDIENTE',
    [ESTADO_CUENTA_PAGADA]: 'PAGADO',
    [ESTADO_CUENTA_EN_MORA]: 'EN MORA',
    [ESTADO_CUENTA_PARCIAL]: 'PAGO PARCIAL'
};

/**
 * Recibo mensual de una cuenta de cobro (resumen del periodo).
 *
 * `forma_pago` sale del medio de la ÚLTIMA transacción confirmada. Antes salía
 * de `pagos.tipo_transaccion`, una columna que el controlador iba pisando con el
 * medio del último abono: es el mismo dato, leído de donde de verdad vive en vez
 * de una copia. Si no hay ninguna transacción todavía, «Múltiple», como antes.
 */
const generarRecibo = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const cuenta = esUuid(id) ? await CuentaCobro.findByPk(id) : null;

        if (!cuenta) return res.status(404).json({ mensaje: 'No encontrado' });

        const misContratos = await idsDondeEsParte(sub);

        if (!puedeVerCuenta(cuenta, misContratos)) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const saldo = await saldoDe(cuenta);

        const ultima = await Transaccion.findOne({
            where: {
                id_cuenta_cobro: cuenta.id_cuenta_cobro,
                estado: ESTADO_TRANSACCION_CONFIRMADA
            },
            order: [['fecha_pago', 'DESC']]
        });

        const delContrato = await contratoPorId(cuenta.id_contrato);
        const contrato = await adjuntarInquilino(await adjuntarInmueble(delContrato));
        const arrendatario = contrato ? contrato.Inquilino : null;
        const esTotal = saldo === 0;
        const periodo = fmtPeriodo(cuenta.inicio);

        responderPdf(res, `Recibo_Mensual_${id}.pdf`, {
            ...datosEmpresa,
            ...datosArrendatario(arrendatario),
            ...datosInmueble(contrato && contrato.Inmueble),
            numero_comprobante: `REC-${cuenta.id_cuenta_cobro}`,
            fecha_expedicion: new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: ETIQUETA_ESTADO[cuenta.estado],
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(cuenta.valor),
            valor_pagado: fmt(parseFloat(cuenta.valor) - saldo),
            saldo_anterior: fmt(cuenta.valor),
            saldo_pendiente: fmt(saldo),
            forma_pago: (ultima && ultima.medio_pago) || 'Múltiple',
            banco: 'N/A',
            referencia_pago: `Recibo mensual No. ${cuenta.id_cuenta_cobro}`
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
    }
};

const obtenerPendientes = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const misContratos = await idsDondeEsParte(sub);

        const cuentas = await CuentaCobro.findAll({
            where: {
                estado: { [Op.in]: [ESTADO_CUENTA_PENDIENTE, ESTADO_CUENTA_PARCIAL] },
                ...deMisContratos(misContratos)
            },
            order: [['inicio', 'ASC']]
        });
        res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
    } catch (error) { return responderServicioCaido(res, error, 'obtener pendientes'); }
};

const verificarMora = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const hoy = hoyEnZonaNegocio();
        // Solo sobre los PROPIOS, y aquí propio significa dueño del inmueble, no
        // parte: verificar la mora escribe, y escribir sobre la cuenta de otro
        // sería peor que verla. Un inquilino no puede marcarse a sí mismo.
        const mios = (await contratosDePropietario(sub)).map((c) => c.id_contrato);

        const vencidas = await CuentaCobro.findAll({
            where: {
                estado: { [Op.in]: [ESTADO_CUENTA_PENDIENTE, ESTADO_CUENTA_PARCIAL] },
                inicio: { [Op.lt]: hoy },
                id_contrato: { [Op.in]: mios }
            }
        });
        for (const cuenta of vencidas) {
            await cuenta.update({ estado: ESTADO_CUENTA_EN_MORA }, { usuarioAuditor: sub });
        }
        res.json({ mensaje: 'Mora verificada', pagos_actualizados: vencidas.length });
    } catch (error) { return responderServicioCaido(res, error, 'verificar mora'); }
};

/** Las transacciones de una cuenta de cobro, incluidas las anuladas. */
const obtenerTransacciones = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;
        const cuenta = esUuid(id) ? await CuentaCobro.findByPk(id) : null;
        if (!cuenta) return res.status(404).json({ mensaje: 'No encontrado' });

        const misContratos = await idsDondeEsParte(sub);
        if (!puedeVerCuenta(cuenta, misContratos)) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        // Las anuladas SE DEVUELVEN. Dejarlas fuera sería esconder que un
        // movimiento se registró y se corrigió, que es justo lo que el estado
        // existe para hacer visible.
        const transacciones = await Transaccion.findAll({
            where: { id_cuenta_cobro: id },
            order: [['fecha_pago', 'DESC']]
        });
        res.json(transacciones);
    } catch (error) { return responderServicioCaido(res, error, 'obtener transacciones'); }
};

module.exports = {
    anularTransaccion,
    crearCuentaCobro,
    generarComprobante,
    generarRecibo,
    obtenerHistorialGlobal,
    obtenerPendientes,
    obtenerPorContrato,
    obtenerTodos,
    obtenerTransacciones,
    registrarPago,
    verificarMora
};
