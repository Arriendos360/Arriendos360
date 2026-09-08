/**
 * Las columnas de autoría, en los tres caminos de escritura.
 *
 * POR QUÉ ESTA SUITE EXISTE. El Capítulo 2 exige `creado_por`, `fecha_creacion`,
 * `ultima_actualizacion` y `actualizado_por` en las ocho tablas de dominio, y
 * hasta ahora ninguna prueba del gateway miraba la segunda mitad de esa exigencia.
 * El resultado fue un defecto que vivió sin que saltara nada: `instancia.update()`
 * decide qué columnas escribe ANTES de disparar los hooks, así que
 * `actualizado_por` conservaba para siempre el valor del alta en `contratos`,
 * `pagos` y `abonos` a la vez — hoy `cuentas_cobro` y `transacciones`.
 *
 * LO QUE HACE QUE ESTAS PRUEBAS SIRVAN, y que es justo lo que le faltaba a la
 * que existía en ms-inmuebles: **el que modifica no es el que creó**. Aquella
 * comparaba `actualizado_por` contra el creador —que es exactamente el valor que
 * el defecto dejaba ahí— y por eso no podía fallar nunca. Con dos usuarios
 * distintos, la aserción tiene algo que decir.
 *
 * Y SE LEE DESDE LA BASE, no de la instancia en memoria. El defecto dejaba el
 * valor correcto en el objeto de JavaScript y no lo mandaba en el `UPDATE`: una
 * prueba que mirara la instancia habría pasado igual.
 *
 * No usa `prepararEntorno()` a propósito: esto no toca HTTP ni servicios, así
 * que no hacen falta los dobles. Sólo el esquema.
 */

const crypto = require('crypto');

const { sequelize } = require('../src/config/database');
const { recrearEsquema } = require('../src/database/migraciones');
const { Contrato, CuentaCobro, Transaccion } = require('../src/models');
const { USUARIO_SISTEMA } = require('../src/models/constantes');

/** Dos personas distintas. La distinción ES la prueba. */
const CREADOR = crypto.randomUUID();
const EDITOR = crypto.randomUUID();

beforeAll(async () => {
    await recrearEsquema(sequelize);
});

afterAll(async () => {
    await sequelize.close();
});

/** Lee la fila recién escrita, sin fiarse de lo que tenga la instancia. */
const desdeLaBase = (modelo, id) => modelo.findByPk(id);

/**
 * Un caso por modelo con auditoría.
 *
 * `contratos` y `cuentas_cobro` son las dos tablas con peso probatorio —un
 * contrato y su cobro son lo que se enseña si alguien discute— y `transacciones`
 * va con ellas porque comparte el mismo hook: dejarla fuera sería volver a tener
 * una tabla sin comprobar, que es como empezó todo esto.
 */
const casos = [
    {
        nombre: 'Contrato',
        modelo: Contrato,
        clave: 'id_contrato',
        datos: async () => ({
            id_inmueble: crypto.randomUUID(),
            id_inquilino: crypto.randomUUID(),
            inicio: '2026-01-01',
            fin: '2026-12-31',
            canon: 1500000
        }),
        cambio: { canon: 1600000 }
    },
    {
        nombre: 'CuentaCobro',
        modelo: CuentaCobro,
        clave: 'id_cuenta_cobro',
        datos: async () => ({
            id_contrato: crypto.randomUUID(),
            detalle: 'Canon de arrendamiento del 2026-01-01 al 2026-01-31',
            valor: 1500000,
            inicio: '2026-01-01',
            fin: '2026-01-31'
        }),
        // El cambio de estado real. Es el que hace el controlador al registrar
        // una transacción que no cubre la cuenta entera.
        cambio: { estado: 'PARCIAL' }
    },
    {
        nombre: 'Transaccion',
        modelo: Transaccion,
        clave: 'id_transaccion',
        datos: async () => {
            // `transacciones` sí tiene clave foránea a `cuentas_cobro`: las dos
            // acaban en ms-financiero, así que no cruza frontera de servicio.
            const cuenta = await CuentaCobro.create(
                {
                    id_contrato: crypto.randomUUID(),
                    detalle: 'Canon de arrendamiento del 2026-01-01 al 2026-01-31',
                    valor: 1000,
                    inicio: '2026-01-01',
                    fin: '2026-01-31'
                },
                { usuarioAuditor: CREADOR }
            );

            return {
                id_cuenta_cobro: cuenta.id_cuenta_cobro,
                monto: 500,
                saldo_restante_momento: 500
            };
        },
        // Anular es el cambio que de verdad hace el controlador sobre una
        // transacción, y el que más importa que quede auditado: es quien
        // deshace un movimiento contable.
        cambio: { estado: 'ANULADA' }
    }
];

describe.each(casos)('Auditoría de $nombre', ({ modelo, clave, datos, cambio }) => {
    test('el alta registra al creador en las dos columnas', async () => {
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });
        const guardada = await desdeLaBase(modelo, fila[clave]);

        expect(guardada.creado_por).toBe(CREADOR);
        expect(guardada.actualizado_por).toBe(CREADOR);
    });

    test('una modificación posterior registra al EDITOR, no al creador', async () => {
        // ÉSTA es la prueba que faltaba. Antes del arreglo, `actualizado_por`
        // seguía siendo CREADOR y nadie se enteraba.
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

        await fila.update(cambio, { usuarioAuditor: EDITOR });

        const guardada = await desdeLaBase(modelo, fila[clave]);
        expect(guardada.actualizado_por).toBe(EDITOR);
        // Y `creado_por` no se toca: quien creó siguió siendo quien creó.
        expect(guardada.creado_por).toBe(CREADOR);
    });

    test('la modificación dentro de una transacción también', async () => {
        // El camino que usa `finalizar` un contrato desde el paso 5, ahora que
        // el cambio de estado y el evento van juntos.
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

        await sequelize.transaction(async (transaccion) => {
            await fila.update(cambio, { transaction: transaccion, usuarioAuditor: EDITOR });
        });

        expect((await desdeLaBase(modelo, fila[clave])).actualizado_por).toBe(EDITOR);
    });

    test('sin autor explícito, la modificación queda a nombre del sistema', async () => {
        // Es lo que pasa cuando el cambio no lo origina una persona: el motor
        // financiero marcando una mora, o un consumidor del bus reaccionando a
        // un evento. Registrar al creador ahí sería atribuirle a alguien algo
        // que no hizo, que es peor que no saber quién fue.
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

        await fila.update(cambio);

        expect((await desdeLaBase(modelo, fila[clave])).actualizado_por).toBe(USUARIO_SISTEMA);
    });

    test('`ultima_actualizacion` avanza con el cambio', async () => {
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });
        const antes = (await desdeLaBase(modelo, fila[clave])).ultima_actualizacion;

        await new Promise((resolver) => setTimeout(resolver, 5));
        await fila.update(cambio, { usuarioAuditor: EDITOR });

        const despues = (await desdeLaBase(modelo, fila[clave])).ultima_actualizacion;
        expect(despues.getTime()).toBeGreaterThan(antes.getTime());
    });

    test('la actualización masiva sigue registrando al autor', async () => {
        // Regresión del hook que ya existía. Hoy no lo usa ningún controlador
        // —se escribió para `Inmueble.update(...)`, que se fue en el paso 4— y
        // por eso conviene que quede probado: es código que nadie ejercita hasta
        // el día que alguien lo necesite.
        const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

        await modelo.update(cambio, {
            where: { [clave]: fila[clave] },
            usuarioAuditor: EDITOR
        });

        expect((await desdeLaBase(modelo, fila[clave])).actualizado_por).toBe(EDITOR);
    });
});

describe('Un `creado_por` explícito gana en el alta', () => {
    test('el autor del cuerpo se respeta y se copia a `actualizado_por`', async () => {
        // Lo necesita el autorregistro: ahí el autor es el propio usuario que se
        // está creando, y no hay `usuarioAuditor` que valga. La regla vivía en un
        // comentario y ahora está comprobada.
        const propio = crypto.randomUUID();

        const contrato = await Contrato.create(
            {
                id_inmueble: crypto.randomUUID(),
                id_inquilino: crypto.randomUUID(),
                inicio: '2026-01-01',
                fin: '2026-12-31',
                canon: 1000,
                creado_por: propio
            },
            { usuarioAuditor: CREADOR }
        );

        const guardado = await desdeLaBase(Contrato, contrato.id_contrato);
        expect(guardado.creado_por).toBe(propio);
        expect(guardado.actualizado_por).toBe(propio);
    });
});
