/**
 * Doble de ms-financiero para las pruebas del gateway.
 *
 * Mismo razonamiento que los de identidad, inmuebles y contratos: la costura
 * reenvía por red, así que para probar el gateway hace falta algo que escuche.
 * Un mock de función no ejercitaría ni el reenvío, ni la credencial de servicio,
 * ni la política de fallo del cliente.
 *
 * ── QUÉ TIENE QUE HACER ESTE DOBLE, Y POR QUÉ ───────────────────────────────
 *
 * Dos cosas, y son de naturaleza distinta:
 *
 * 1. **Servir `/api/pagos`**, porque es lo que la costura reenvía. Aquí basta
 *    con lo mínimo para que las suites de enrutamiento y de matriz RBAC
 *    comprueben lo suyo: que la petición LLEGA, que llega con el token, y que
 *    una denegada no llega. La lógica de negocio de verdad —el saldo derivado,
 *    la anulación, los comprobantes— se prueba en el servicio, no aquí.
 *
 * 2. **Servir `/interno/cuentas-cobro`**, que es de lo que vive el dashboard.
 *    Esto sí importa: es el único consumo real que el gateway hace de este
 *    servicio, y la suite del dashboard tiene que poder afirmar sobre las
 *    cifras que agrega.
 *
 * ── Y DEVUELVE `saldo_pendiente` DERIVADO, PORQUE EL REAL LO DERIVA ─────────
 *
 * No es un detalle de comodidad. `saldo_pendiente` dejó de ser una columna en el
 * paso 6c: es `valor` menos la suma de las transacciones confirmadas, y el
 * gateway NO puede calcularlo —no tiene las transacciones—. Si este doble
 * devolviera cuentas sin ese campo, la métrica de mora del dashboard sumaría
 * `undefined` y la suite lo daría por bueno o por `NaN`, según cómo estuviera
 * escrita. Así que el doble guarda transacciones y hace la resta, igual que el
 * servicio real.
 *
 * Lo que el doble NO prueba es que el contrato entre los dos sea cierto. De eso
 * se encarga la suite de integración contra el stack real.
 */

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { exigirServicio } = require('arriendos360-shared');

const crearFinancieroFalso = async (opciones = {}) => {
    const secreto = opciones.secreto || process.env.JWT_SECRET;

    /** @type {Map<string, object>} cuentas de cobro por id */
    const cuentas = new Map();
    /** @type {Map<string, object>} transacciones por id */
    const transacciones = new Map();
    /** Peticiones recibidas, para que una prueba pueda afirmar sobre ellas. */
    const llamadas = [];
    /** Si se pone, las peticiones que casen fallan con este código. */
    let fallarCon = null;
    let fallarSolo = null;

    const app = express();
    app.use(express.json());
    app.use((req, res, siguiente) => {
        llamadas.push({ metodo: req.method, ruta: req.originalUrl });
        if (fallarCon !== null && (fallarSolo === null || fallarSolo.test(req.originalUrl))) {
            return res.status(fallarCon).json({ mensaje: 'Doble caído a propósito' });
        }
        return siguiente();
    });

    /** Verifica el token como lo haría el servicio real (confianza cero). */
    const claimsDe = (req) => {
        const cabecera = req.headers['authorization'];
        if (!cabecera) return null;

        const [esquema, valor] = cabecera.split(' ');
        if (!valor || esquema.toLowerCase() !== 'bearer') return null;

        try {
            return jwt.verify(valor, secreto);
        } catch {
            return null;
        }
    };

    /**
     * El saldo, DERIVADO. Igual que el servicio real: `valor` menos la suma de
     * las transacciones CONFIRMADAS. Ver la cabecera.
     */
    const saldoDe = (cuenta) => {
        const cobrado = [...transacciones.values()]
            .filter(
                (t) =>
                    t.id_cuenta_cobro === cuenta.id_cuenta_cobro && t.estado === 'CONFIRMADA'
            )
            .reduce((suma, t) => suma + parseFloat(t.monto), 0);

        return Math.round((parseFloat(cuenta.valor) - cobrado) * 100) / 100;
    };

    const conSaldo = (cuenta) => ({ ...cuenta, saldo_pendiente: saldoDe(cuenta) });

    // ── /api/pagos ──────────────────────────────────────────────────────────
    // Lo mínimo para que la costura y la matriz tengan algo al otro lado.
    app.use('/api/pagos', (req, res, siguiente) => {
        const claims = claimsDe(req);
        if (!claims) {
            return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        }
        req.claims = claims;
        return siguiente();
    });

    const soloPropietario = (req, res, siguiente) => {
        if (!(req.claims.roles || []).includes('PROPIETARIO')) {
            return res
                .status(403)
                .json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
        }
        return siguiente();
    };

    app.get('/api/pagos', (req, res) =>
        res.json(
            [...cuentas.values()]
                .filter((c) => (c.partes || []).includes(req.claims.sub))
                .map(conSaldo)
        )
    );

    app.post('/api/pagos/cuentas-cobro', soloPropietario, (req, res) => {
        const cuenta = {
            id_cuenta_cobro: crypto.randomUUID(),
            estado: 'PENDIENTE',
            fecha_pago: null,
            valor: 1000,
            inicio: '2026-01-01',
            fin: '2026-01-31',
            detalle: 'Canon',
            ...req.body,
            // Quien la crea es parte de ella, que es lo que el ABAC real
            // resolvería preguntándole a ms-contratos.
            partes: [req.claims.sub]
        };

        cuentas.set(cuenta.id_cuenta_cobro, cuenta);
        return res
            .status(201)
            .json({ mensaje: 'Cuenta de cobro registrada exitosamente', cuenta_cobro: conSaldo(cuenta) });
    });

    app.post('/api/pagos', soloPropietario, (req, res) => {
        const cuenta = cuentas.get(req.body.id_cuenta_cobro);
        if (!cuenta) {
            return res.status(404).json({ mensaje: 'Cuenta de cobro no encontrada' });
        }

        const saldoActual = saldoDe(cuenta);
        const monto = parseFloat(req.body.monto);

        if (monto <= 0 || monto > saldoActual) {
            return res.status(400).json({ mensaje: 'Monto inválido o superior al saldo' });
        }

        const transaccion = {
            id_transaccion: crypto.randomUUID(),
            id_cuenta_cobro: cuenta.id_cuenta_cobro,
            monto,
            tipo: req.body.tipo || 'INGRESO',
            medio_pago: req.body.medio_pago,
            estado: 'CONFIRMADA',
            saldo_restante_momento: Math.round((saldoActual - monto) * 100) / 100
        };

        transacciones.set(transaccion.id_transaccion, transaccion);

        const nuevoSaldo = saldoDe(cuenta);
        // EN_MORA gana sobre PARCIAL, como en `estadoSegunSaldo` del servicio real:
        // abonar a una cuenta vencida no la pone al día.
        cuenta.estado = nuevoSaldo <= 0
            ? 'PAGADA'
            : cuenta.estado === 'EN_MORA'
              ? 'EN_MORA'
              : nuevoSaldo < parseFloat(cuenta.valor) ? 'PARCIAL' : 'PENDIENTE';

        return res.status(201).json({
            mensaje: nuevoSaldo === 0 ? 'Pago completado exitosamente' : 'Pago parcial registrado exitosamente',
            cuenta_cobro: conSaldo(cuenta),
            transaccion
        });
    });

    app.post('/api/pagos/verificar-mora', soloPropietario, (req, res) =>
        res.json({ mensaje: 'Mora verificada', pagos_actualizados: 0 })
    );

    // ── /interno ────────────────────────────────────────────────────────────
    // El doble EXIGE la credencial de servicio, igual que el real. Sin esto, las
    // suites pasarían aunque el gateway olvidara mandarla.
    app.use(
        '/interno',
        exigirServicio({
            destinatario: 'ms-financiero',
            secreto: opciones.secretoServicio || process.env.SERVICIO_JWT_SECRET
        })
    );

    /**
     * GET /interno/cuentas-cobro?contratos=a,b,c[&estado=X,Y]
     *
     * Lo que consume el dashboard. Filtra por contrato y por estado igual que el
     * real, y devuelve el saldo derivado.
     */
    app.get('/interno/cuentas-cobro', (req, res) => {
        const { contratos, estado } = req.query;

        if (typeof contratos !== 'string') {
            return res
                .status(400)
                .json({ mensaje: 'Indica `contratos` con una lista de identificadores' });
        }

        const ids = contratos.split(',').map((valor) => valor.trim()).filter(Boolean);
        const estados = typeof estado === 'string' && estado !== ''
            ? estado.split(',').map((valor) => valor.trim())
            : null;

        const encontradas = [...cuentas.values()]
            .filter((c) => ids.includes(c.id_contrato))
            .filter((c) => !estados || estados.includes(c.estado))
            .map(conSaldo);

        return res.json({ cuentas_cobro: encontradas });
    });

    const servidor = await new Promise((resolver) => {
        const s = app.listen(0, '127.0.0.1', () => resolver(s));
    });

    return {
        url: `http://127.0.0.1:${servidor.address().port}`,
        cuentas,
        transacciones,
        llamadas,
        /**
         * Registra una cuenta de cobro sin pasar por la API.
         *
         * `partes` es quién puede verla: en el servicio real eso lo resuelve
         * ms-contratos y aquí se declara, porque lo que estas suites prueban es
         * el dashboard del gateway y no la pertenencia.
         */
        sembrarCuenta: (datos) => {
            const cuenta = {
                id_cuenta_cobro: crypto.randomUUID(),
                valor: 1000,
                inicio: '2026-01-01',
                fin: '2026-01-31',
                detalle: 'Canon',
                estado: 'PENDIENTE',
                fecha_pago: null,
                partes: [],
                ...datos
            };
            cuentas.set(cuenta.id_cuenta_cobro, cuenta);
            return cuenta;
        },
        limpiarLlamadas: () => {
            llamadas.length = 0;
        },
        caer: (codigo = 503, patron = null) => {
            fallarCon = codigo;
            fallarSolo = patron;
        },
        levantar: () => {
            fallarCon = null;
            fallarSolo = null;
        },
        cerrar: () =>
            new Promise((resolver, rechazar) => {
                servidor.close((error) => (error ? rechazar(error) : resolver()));
            })
    };
};

module.exports = { crearFinancieroFalso };
