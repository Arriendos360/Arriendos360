/**
 * Las columnas de autoria, en los tres caminos de escritura.
 *
 * POR QUE ESTA SUITE EXISTE. El Capitulo 2 exige `creado_por`, `fecha_creacion`,
 * `ultima_actualizacion` y `actualizado_por` en las ocho tablas de dominio, y
 * durante mucho tiempo ninguna prueba miraba la segunda mitad de esa exigencia.
 * El resultado fue un defecto que vivio sin que saltara nada:
 * `instancia.update()` decide que columnas escribe ANTES de disparar los hooks,
 * asi que `actualizado_por` conservaba para siempre el valor del alta en
 * `contratos`, `pagos` y `abonos` a la vez — hoy `cuentas_cobro` y
 * `transacciones`.
 *
 * LO QUE HACE QUE ESTAS PRUEBAS SIRVAN: **el que modifica no es el que creo**.
 * Una prueba que comparara `actualizado_por` contra el creador —que es
 * exactamente el valor que el defecto dejaba ahi— no podria fallar nunca. Con
 * dos usuarios distintos, la asercion tiene algo que decir.
 *
 * Y SE LEE DESDE LA BASE, no de la instancia en memoria. El defecto dejaba el
 * valor correcto en el objeto de JavaScript y no lo mandaba en el `UPDATE`: una
 * prueba que mirara la instancia habria pasado igual.
 *
 * ── SE MUDA CON LAS TABLAS ──────────────────────────────────────────────────
 *
 * Esta suite estaba en `apps/gateway/tests/auditoria.test.js` y cubria las dos
 * ultimas tablas que le quedaban al gateway. Se va con ellas, igual que el caso
 * de `contratos` se fue a ms-contratos en el paso 6d. Lo que no se podia era
 * dejar de comprobarlo: el defecto que la origino afectaba a las tres tablas a
 * la vez, y ahora viven en dos procesos distintos.
 *
 * No usa `prepararEntorno()` a proposito: esto no toca HTTP ni servicios, asi
 * que no hacen falta los dobles. Solo el esquema.
 */

import crypto from 'crypto';
import type { Model, ModelStatic } from 'sequelize';

import { sequelize } from '../src/config/database';
import { recrearEsquema } from '../src/database/migraciones';
import { CuentaCobro } from '../src/models/CuentaCobro';
import { Transaccion } from '../src/models/Transaccion';
import { USUARIO_SISTEMA } from '../src/models/constantes';

/** Dos personas distintas. La distincion ES la prueba. */
const CREADOR = crypto.randomUUID();
const EDITOR = crypto.randomUUID();

beforeAll(async () => {
  await recrearEsquema(sequelize);
});

afterAll(async () => {
  await sequelize.close();
});

interface FilaAuditada extends Model {
  creado_por: string;
  actualizado_por: string;
  ultima_actualizacion: Date;
}

/** Lee la fila recien escrita, sin fiarse de lo que tenga la instancia. */
const desdeLaBase = async (
  modelo: ModelStatic<Model>,
  id: string,
): Promise<FilaAuditada> => (await modelo.findByPk(id)) as unknown as FilaAuditada;

/**
 * Un caso por modelo con auditoria.
 *
 * Las dos tablas tienen peso probatorio: un cobro y el dinero que entro contra
 * el son lo que se enseña si alguien discute.
 */
const casos = [
  {
    nombre: 'CuentaCobro',
    modelo: CuentaCobro as unknown as ModelStatic<Model>,
    clave: 'id_cuenta_cobro',
    datos: async (): Promise<Record<string, unknown>> => ({
      id_contrato: crypto.randomUUID(),
      detalle: 'Canon de arrendamiento del 2026-01-01 al 2026-01-31',
      valor: 1500000,
      inicio: '2026-01-01',
      fin: '2026-01-31',
    }),
    // El cambio de estado real. Es el que hace el controlador al registrar una
    // transaccion que no cubre la cuenta entera.
    cambio: { estado: 'PARCIAL' },
  },
  {
    nombre: 'Transaccion',
    modelo: Transaccion as unknown as ModelStatic<Model>,
    clave: 'id_transaccion',
    datos: async (): Promise<Record<string, unknown>> => {
      // `transacciones` si tiene clave foranea a `cuentas_cobro`: las dos son de
      // este servicio, asi que no cruza frontera.
      const cuenta = await CuentaCobro.create(
        {
          id_contrato: crypto.randomUUID(),
          detalle: 'Canon de arrendamiento del 2026-01-01 al 2026-01-31',
          valor: 1000,
          inicio: '2026-01-01',
          fin: '2026-01-31',
        },
        { usuarioAuditor: CREADOR },
      );

      return {
        id_cuenta_cobro: cuenta.id_cuenta_cobro,
        monto: 500,
        saldo_restante_momento: 500,
      };
    },
    // Anular es el cambio que de verdad hace el controlador sobre una
    // transaccion, y el que mas importa que quede auditado: es quien deshace un
    // movimiento contable.
    cambio: { estado: 'ANULADA' },
  },
];

describe.each(casos)('Auditoría de $nombre', ({ modelo, clave, datos, cambio }) => {
  test('el alta registra al creador en las dos columnas', async () => {
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });
    const guardada = await desdeLaBase(modelo, fila.get(clave) as string);

    expect(guardada.creado_por).toBe(CREADOR);
    expect(guardada.actualizado_por).toBe(CREADOR);
  });

  test('una modificación posterior registra al EDITOR, no al creador', async () => {
    // ESTA es la prueba que faltaba. Antes del arreglo, `actualizado_por` seguia
    // siendo CREADOR y nadie se enteraba.
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

    await fila.update(cambio, { usuarioAuditor: EDITOR });

    const guardada = await desdeLaBase(modelo, fila.get(clave) as string);
    expect(guardada.actualizado_por).toBe(EDITOR);
    // Y `creado_por` no se toca: quien creo siguio siendo quien creo.
    expect(guardada.creado_por).toBe(CREADOR);
  });

  test('la modificación dentro de una transacción también', async () => {
    // El camino que usan el registro de un pago y la anulacion, que hacen su
    // trabajo con la fila de la cuenta bloqueada.
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

    await sequelize.transaction(async (transaccion) => {
      await fila.update(cambio, { transaction: transaccion, usuarioAuditor: EDITOR });
    });

    const guardada = await desdeLaBase(modelo, fila.get(clave) as string);
    expect(guardada.actualizado_por).toBe(EDITOR);
  });

  test('sin autor explícito, la modificación queda a nombre del sistema', async () => {
    // Es lo que pasa cuando el cambio no lo origina una persona: el motor
    // marcando una mora, o el consumidor del bus creando la primera cuenta de
    // cobro. Registrar al creador ahi seria atribuirle a alguien algo que no
    // hizo, que es peor que no saber quien fue.
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });

    await fila.update(cambio);

    const guardada = await desdeLaBase(modelo, fila.get(clave) as string);
    expect(guardada.actualizado_por).toBe(USUARIO_SISTEMA);
  });

  test('`ultima_actualizacion` avanza con el cambio', async () => {
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });
    const antes = (await desdeLaBase(modelo, fila.get(clave) as string)).ultima_actualizacion;

    await new Promise((resolver) => setTimeout(resolver, 5));
    await fila.update(cambio, { usuarioAuditor: EDITOR });

    const despues = (await desdeLaBase(modelo, fila.get(clave) as string)).ultima_actualizacion;
    expect(despues.getTime()).toBeGreaterThan(antes.getTime());
  });

  test('la actualización masiva sigue registrando al autor', async () => {
    // Regresion del hook que ya existia. Hoy no lo usa ningun controlador de
    // este servicio, y por eso conviene que quede probado: es codigo que nadie
    // ejercita hasta el dia que alguien lo necesite.
    const fila = await modelo.create(await datos(), { usuarioAuditor: CREADOR });
    const id = fila.get(clave) as string;

    await modelo.update(cambio, {
      where: { [clave]: id },
      usuarioAuditor: EDITOR,
    });

    expect((await desdeLaBase(modelo, id)).actualizado_por).toBe(EDITOR);
  });
});

describe('Un `creado_por` explícito gana en el alta', () => {
  test('el autor del cuerpo se respeta y se copia a `actualizado_por`', async () => {
    // La regla vivia en un comentario de `models/columnas.ts` y aqui queda
    // comprobada. En este servicio no hay ningun camino que la use —la necesita
    // el autorregistro de ms-identidad— pero el hook es el mismo, y una regla
    // sin prueba es una regla que se puede romper sin enterarse.
    const propio = crypto.randomUUID();

    const cuenta = await CuentaCobro.create(
      {
        id_contrato: crypto.randomUUID(),
        detalle: 'Canon de arrendamiento del 2026-01-01 al 2026-01-31',
        valor: 1000,
        inicio: '2026-01-01',
        fin: '2026-01-31',
        creado_por: propio,
      },
      { usuarioAuditor: CREADOR },
    );

    const guardada = await desdeLaBase(
      CuentaCobro as unknown as ModelStatic<Model>,
      cuenta.id_cuenta_cobro,
    );

    expect(guardada.creado_por).toBe(propio);
    expect(guardada.actualizado_por).toBe(propio);
  });
});
