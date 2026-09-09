import crypto from 'crypto';

import { sequelize } from '../src/config/database';
import { recrearEsquema } from '../src/database/migraciones';
import { Anexo } from '../src/models/Anexo';
import { Contrato } from '../src/models/Contrato';
import { USUARIO_SISTEMA } from '../src/models/constantes';

/**
 * Las columnas de autoria de `Contratos` y `Anexos`.
 *
 * ── SE MUDAN CON LAS TABLAS ─────────────────────────────────────────────────
 *
 * El caso de `Contrato` vivia en `apps/gateway/tests/auditoria.test.js` y se va
 * con el modelo. La suite del gateway conserva los de `CuentaCobro` y
 * `Transaccion`, que son las dos tablas que le quedan.
 *
 * POR QUE ESTAS PRUEBAS EXISTEN. El Capitulo 2 exige `creado_por`,
 * `fecha_creacion`, `ultima_actualizacion` y `actualizado_por` en las ocho
 * tablas, y hubo un defecto que vivio sin que saltara nada: `instancia.update()`
 * decide que columnas escribe ANTES de disparar los hooks, asi que
 * `actualizado_por` conservaba para siempre el valor del alta.
 *
 * LO QUE HACE QUE SIRVAN: **el que modifica no es el que creo**. Comparar
 * `actualizado_por` contra el creador es exactamente el valor que el defecto
 * dejaba ahi, asi que esa prueba no puede fallar nunca. Con dos usuarios
 * distintos, la asercion tiene algo que decir.
 *
 * Y SE LEE DESDE LA BASE, no de la instancia en memoria. El defecto dejaba el
 * valor correcto en el objeto de JavaScript y no lo mandaba en el `UPDATE`.
 *
 * No usa `prepararEntorno()` a proposito: esto no toca HTTP ni servicios, asi
 * que no hacen falta los dobles. Solo el esquema.
 */

/** Dos personas distintas. La distincion ES la prueba. */
const CREADOR = crypto.randomUUID();
const EDITOR = crypto.randomUUID();

beforeAll(async () => {
  await recrearEsquema(sequelize);
});

afterAll(async () => {
  await sequelize.close();
});

/** Un contrato recien creado, para colgarle cosas. */
const contratoNuevo = async (auditor = CREADOR): Promise<Contrato> =>
  Contrato.create(
    {
      id_inmueble: crypto.randomUUID(),
      id_inquilino: crypto.randomUUID(),
      inicio: '2026-01-01',
      fin: '2026-12-31',
      canon: 1500000,
    },
    { usuarioAuditor: auditor },
  );

describe('Auditoria de Contrato', () => {
  test('el alta registra al creador en las dos columnas', async () => {
    const contrato = await contratoNuevo();
    const guardado = await Contrato.findByPk(contrato.id_contrato);

    expect(guardado?.creado_por).toBe(CREADOR);
    expect(guardado?.actualizado_por).toBe(CREADOR);
  });

  test('una modificacion posterior registra al EDITOR, no al creador', async () => {
    // ESTA es la prueba que faltaba antes del arreglo del hook.
    const contrato = await contratoNuevo();

    await contrato.update({ canon: 1600000 }, { usuarioAuditor: EDITOR });

    const guardado = await Contrato.findByPk(contrato.id_contrato);
    expect(guardado?.actualizado_por).toBe(EDITOR);
    // Y `creado_por` no se toca: quien creo siguio siendo quien creo.
    expect(guardado?.creado_por).toBe(CREADOR);
  });

  test('la modificacion dentro de una transaccion tambien', async () => {
    // El camino que usa `finalizar`, ahora que el cambio de estado y el evento
    // van juntos en la misma transaccion.
    const contrato = await contratoNuevo();

    await sequelize.transaction(async (transaccion) => {
      await contrato.update(
        { estado: 'finalizado' },
        { transaction: transaccion, usuarioAuditor: EDITOR },
      );
    });

    const guardado = await Contrato.findByPk(contrato.id_contrato);
    expect(guardado?.actualizado_por).toBe(EDITOR);
  });

  test('sin autor explicito, la modificacion queda a nombre del sistema', async () => {
    // Es lo que pasa cuando el cambio no lo origina una persona: una migracion
    // de datos, un proceso automatico. Registrar al creador ahi seria atribuirle
    // a alguien algo que no hizo, que es peor que no saber quien fue.
    const contrato = await contratoNuevo();

    await contrato.update({ canon: 1700000 });

    const guardado = await Contrato.findByPk(contrato.id_contrato);
    expect(guardado?.actualizado_por).toBe(USUARIO_SISTEMA);
  });

  test('`ultima_actualizacion` avanza con el cambio', async () => {
    const contrato = await contratoNuevo();
    const antes = (await Contrato.findByPk(contrato.id_contrato))?.get(
      'ultima_actualizacion',
    ) as Date;

    await new Promise((resolver) => setTimeout(resolver, 5));
    await contrato.update({ canon: 1800000 }, { usuarioAuditor: EDITOR });

    const despues = (await Contrato.findByPk(contrato.id_contrato))?.get(
      'ultima_actualizacion',
    ) as Date;
    expect(despues.getTime()).toBeGreaterThan(antes.getTime());
  });

  test('la actualizacion masiva sigue registrando al autor', async () => {
    // Regresion del tercer hook. Hoy no lo usa ningun controlador, y por eso
    // conviene que quede probado: es codigo que nadie ejercita hasta el dia que
    // alguien lo necesite.
    const contrato = await contratoNuevo();

    await Contrato.update(
      { canon: 1900000 },
      { where: { id_contrato: contrato.id_contrato }, usuarioAuditor: EDITOR },
    );

    const guardado = await Contrato.findByPk(contrato.id_contrato);
    expect(guardado?.actualizado_por).toBe(EDITOR);
  });
});

describe('Auditoria de Anexo', () => {
  test('el alta registra al creador, y una correccion al editor', async () => {
    const contrato = await contratoNuevo();

    const anexo = await Anexo.create(
      {
        archivo_anexo: 'contratos/x/y.pdf',
        tipo: 'CONTRATO_FIRMADO',
        id_contrato: contrato.id_contrato,
      },
      { usuarioAuditor: CREADOR },
    );

    expect((await Anexo.findByPk(anexo.id_anexo))?.creado_por).toBe(CREADOR);

    await anexo.update({ tipo: 'OTROSI' }, { usuarioAuditor: EDITOR });

    const guardado = await Anexo.findByPk(anexo.id_anexo);
    expect(guardado?.actualizado_por).toBe(EDITOR);
    expect(guardado?.creado_por).toBe(CREADOR);
  });
});

describe('Un `creado_por` explicito gana en el alta', () => {
  test('el autor del cuerpo se respeta y se copia a `actualizado_por`', async () => {
    const propio = crypto.randomUUID();

    const contrato = await Contrato.create(
      {
        id_inmueble: crypto.randomUUID(),
        id_inquilino: crypto.randomUUID(),
        inicio: '2026-01-01',
        fin: '2026-12-31',
        canon: 1000,
        creado_por: propio,
      },
      { usuarioAuditor: CREADOR },
    );

    const guardado = await Contrato.findByPk(contrato.id_contrato);
    expect(guardado?.creado_por).toBe(propio);
    expect(guardado?.actualizado_por).toBe(propio);
  });
});
