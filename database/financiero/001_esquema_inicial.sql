-- Esquema inicial de MS-Financiero — Arriendos360, paso 6e
--
-- Las dos últimas tablas de dominio que le quedaban al gateway. Con esto las
-- ocho del Capítulo 2 quedan repartidas entre los servicios que las escriben y
-- `public` deja de tener dominio dentro.
--
-- LA FORMA ES LA QUE YA TENÍAN. El paso 6c hizo el trabajo duro
-- (`database/dominio/006`): partió `pagos`/`abonos` en `cuentas_cobro` y
-- `transacciones`, tradujo los enteros de estado a catálogos cerrados, sustituyó
-- `mes_correspondiente` por el periodo explícito y borró `saldo_pendiente`. Aquí
-- no hay ninguna traducción que hacer: se crean las tablas tal como quedaron y
-- `002` copia las filas.
--
-- ── LA ÚNICA CLAVE FORÁNEA QUE SOBREVIVE, Y POR QUÉ ─────────────────────────
--
-- `transacciones.id_cuenta_cobro` -> `cuentas_cobro`. Las dos tablas son de este
-- servicio, así que la referencia no cruza frontera y la regla dura 1 no la
-- toca. Es además la relación que mejor justifica una FK física: una transacción
-- sin cuenta de cobro no es un dato incompleto, es dinero sin destino.
--
-- `cuentas_cobro.id_contrato` NO la lleva. Apunta a `contratos.contratos`, que
-- es de ms-contratos, y ahí la referencia es un UUID sin constraint.

CREATE SCHEMA IF NOT EXISTS financiero;

-- ── Cuentas de cobro ────────────────────────────────────────────────────────
--
-- La FACTURA. La genera el sistema: la primera al consumir
-- `ContratoFormalizado`, y las de los meses siguientes el motor barriendo fechas
-- de corte.
--
-- NO HAY COLUMNA DE SALDO. Es `valor` menos la suma de las transacciones
-- CONFIRMADAS, y se calcula en `services/saldos.ts`. Un dato derivado que se
-- guarda es un dato que puede mentir: basta un camino de escritura que se olvide
-- de rehacer la resta para que la columna y las transacciones digan cosas
-- distintas sin que nada lo delate.
CREATE TABLE IF NOT EXISTS financiero.cuentas_cobro (
    id_cuenta_cobro UUID PRIMARY KEY,

    /* Concepto del cobro. Lo escribe quien la genera, con el periodo. */
    detalle         TEXT           NOT NULL,

    /* Lo que se factura. NUMERIC, nunca float: son pesos colombianos. */
    valor           NUMERIC(12, 2) NOT NULL,

    /*
     * El periodo que cubre, EXPLÍCITO.
     *
     * `inicio` es la fecha de corte del mes que se factura y `fin` el día
     * ANTERIOR al siguiente corte. Así definidos, los periodos TESELAN el
     * calendario: cada día pertenece a uno y sólo a uno, sin huecos ni solapes,
     * sea cual sea el día pactado. La regla vive en `periodoDeCorte()`, en
     * `packages/shared/src/fechas.ts`, y no se calcula en ningún otro sitio.
     *
     * DATE y no TIMESTAMPTZ: son fechas de calendario, y un `TIMESTAMPTZ` leído
     * con `.getDate()` las movería un día en Bogotá.
     */
    inicio          DATE           NOT NULL,
    fin             DATE           NOT NULL,

    /* Momento en que la cuenta quedó cubierta. Nulo mientras no lo esté. */
    fecha_pago      TIMESTAMPTZ,

    /*
     * Catálogo CERRADO. Si agregas un valor aquí, agrégalo también en
     * `packages/contracts/src/financiero.ts`: el modelo valida contra esa lista
     * y rechazaría antes de llegar a este CHECK. Nada los sincroniza solo.
     */
    estado          VARCHAR(20)    NOT NULL DEFAULT 'PENDIENTE',

    /* Referencia lógica a `contratos.contratos`. Sin FK: regla dura 1. */
    id_contrato     UUID           NOT NULL,

    creado_por           UUID        NOT NULL,
    actualizado_por      UUID        NOT NULL,
    fecha_creacion       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cuentas_cobro_estado_valido
        CHECK (estado IN ('PENDIENTE', 'PAGADA', 'PARCIAL', 'EN_MORA')),

    /* Un periodo que termina antes de empezar es un dato imposible. */
    CONSTRAINT cuentas_cobro_periodo_valido CHECK (fin > inicio)
);

CREATE INDEX IF NOT EXISTS idx_cuentas_cobro_contrato
    ON financiero.cuentas_cobro (id_contrato);

/*
 * ÚNICO, y es la red de seguridad del paso 6e.
 *
 * Dos cuentas de cobro del mismo contrato para el mismo periodo son un cobro
 * duplicado. La comprobación del motor —leer y después insertar— no basta para
 * impedirlo, y desde este paso hay DOS caminos que insertan la primera cuenta:
 * el consumidor de `ContratoFormalizado` y el barrido de `procesarContratos()`.
 * Que el motor ya no genere la primera es una decisión de código; esto es lo que
 * la sostiene aunque alguien se la salte.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_cobro_contrato_periodo
    ON financiero.cuentas_cobro (id_contrato, inicio);

-- ── Transacciones ───────────────────────────────────────────────────────────
--
-- El MOVIMIENTO de dinero contra una cuenta de cobro. Una transacción no se
-- borra: se anula. Ver `docs/adr/0016`.
CREATE TABLE IF NOT EXISTS financiero.transacciones (
    id_transaccion  UUID PRIMARY KEY,

    monto           NUMERIC(12, 2) NOT NULL,

    /* Cuándo entró el dinero. */
    fecha_pago      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    /* Tipo de MOVIMIENTO. Catálogo cerrado con un solo valor hoy. */
    tipo            VARCHAR(20)    NOT NULL DEFAULT 'INGRESO',

    /*
     * Cómo entró el dinero. Catálogo ABIERTO: el único de los cuatro de
     * Financiero. La columna guarda el texto del desplegable de la SPA
     * ("Transferencia Bancaria", "Efectivo", "Consignación") y cerrarla contra
     * la lista del documento —que dice `TRANSFERENCIA`— rompería los datos que
     * ya existen. Sin CHECK a propósito.
     */
    medio_pago      VARCHAR(50),

    estado          VARCHAR(20)    NOT NULL DEFAULT 'CONFIRMADA',

    /*
     * Referencia del movimiento, en texto libre.
     *
     * NO está en el modelo canónico y se conserva: es lo que el comprobante
     * imprime en «Referencia trans.», y sin ella ese renglón mostraría un UUID
     * generado por el sistema en lugar del número de consignación que el
     * arrendatario tiene en su extracto. Ver `docs/adr/0015`.
     */
    observaciones   TEXT,

    /*
     * Lo que quedaba por pagar justo después de esta transacción.
     *
     * ESTO NO SE DERIVA, y es la excepción deliberada. No es el saldo actual de
     * la cuenta: es una FOTO del saldo en el instante en que se emitió el
     * comprobante, y ese comprobante ya está impreso en casa de alguien.
     * Recalcularla cambiaría un documento entregado.
     */
    saldo_restante_momento NUMERIC(12, 2) NOT NULL,

    id_cuenta_cobro UUID NOT NULL,

    creado_por           UUID        NOT NULL,
    actualizado_por      UUID        NOT NULL,
    fecha_creacion       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT transacciones_tipo_valido   CHECK (tipo   IN ('INGRESO')),
    CONSTRAINT transacciones_estado_valido CHECK (estado IN ('CONFIRMADA', 'ANULADA')),

    CONSTRAINT transacciones_id_cuenta_cobro_fkey
        FOREIGN KEY (id_cuenta_cobro)
        REFERENCES financiero.cuentas_cobro (id_cuenta_cobro)
);

/* El saldo derivado suma sólo las confirmadas, y siempre las de una cuenta. */
CREATE INDEX IF NOT EXISTS idx_transacciones_cuenta_estado
    ON financiero.transacciones (id_cuenta_cobro, estado);
