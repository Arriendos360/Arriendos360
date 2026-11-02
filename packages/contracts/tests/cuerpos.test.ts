import {
  errorDeValidacion,
  validarAltaInquilino,
  validarContrato,
  validarCuentaCobro,
  validarInmueble,
  validarPago,
  validarRegistro,
} from '../src/validacion/cuerpos';
import { cuentasPendientes, mesesElegibles } from '../src/validacion/antiguedad';

const campos = (errores: { campo: string }[]): string[] => errores.map((error) => error.campo);

const persona = {
  nombres: 'Ana María',
  apellidos: 'Ruiz',
  documento: '1020304050',
  telefono: '3001234567',
  email: 'ana@correo.com',
};

const HOY = '2026-01-01';

const contrato = {
  inicio: '2026-01-01',
  fin: '2027-01-01',
  canon: '1500000.00',
  fecha_limite_pago: '5',
  fecha_inicio_corte: '2026-01-01',
  nombre_deudor_solidario: 'Jorge Enrique Ruiz',
  documento_deudor_solidario: '79456321',
};

describe('errorDeValidacion', () => {
  test('mensaje es el del primer error', () => {
    const errores = [
      { campo: 'nombres', mensaje: 'primero' },
      { campo: 'documento', mensaje: 'segundo' },
    ];
    expect(errorDeValidacion(errores)).toEqual({ mensaje: 'primero', errores });
  });
});

describe('validarRegistro', () => {
  test('un cuerpo válido no da errores y sale normalizado', () => {
    const { datos, errores } = validarRegistro({
      ...persona,
      nombres: '  María   José ',
      telefono: '+57 (300) 123-4567',
      email: ' Ana@Correo.com ',
      contrasena: 'segura123',
    });

    expect(errores).toEqual([]);
    expect(datos).toMatchObject({ nombres: 'María José', telefono: '3001234567', email: 'Ana@Correo.com' });
  });

  test('INC-001: varios errores a la vez, en el orden del formulario', () => {
    const { errores } = validarRegistro({
      ...persona,
      nombres: 'Juan123',
      documento: 'jnkjbn3kj2b3jh234b2j',
      telefono: 'n2jk4b24jh2b34j2',
      contrasena: 'corta',
    });

    expect(campos(errores)).toEqual(['nombres', 'documento', 'telefono', 'contrasena']);
    expect(errores[3]?.mensaje).toContain('8 caracteres');
  });

  test('sin documento, el primer error menciona el documento', () => {
    const { errores } = validarRegistro({ ...persona, documento: undefined, contrasena: 'x' });
    expect(errorDeValidacion(errores).mensaje).toContain('documento');
  });

  test('el teléfono es opcional y un vacío no se guarda', () => {
    const { datos, errores } = validarRegistro({ ...persona, telefono: '  ', contrasena: 'segura123' });
    expect(errores).toEqual([]);
    expect(datos.telefono).toBeUndefined();
    expect('telefono' in datos).toBe(true);
  });
});

describe('validarAltaInquilino', () => {
  test('INC-003: un error por cada campo basura', () => {
    const { errores } = validarAltaInquilino({
      ...persona,
      nombres: '1468498',
      apellidos: '4642684',
      documento: 'dasnsjdoasjdoaj',
      telefono: '97wqqewqeqeq',
    });

    expect(campos(errores)).toEqual(['nombres', 'apellidos', 'documento', 'telefono']);
  });

  test('no exige contraseña', () => {
    expect(validarAltaInquilino(persona).errores).toEqual([]);
  });
});

describe('validarContrato', () => {
  test('un cuerpo válido no da errores y sale con números', () => {
    const { datos, errores } = validarContrato({ ...contrato, nombre_deudor_solidario: ' Jorge  Enrique Ruiz ' }, HOY);
    expect(errores).toEqual([]);
    expect(datos).toMatchObject({ canon: 1500000, fecha_limite_pago: 5, nombre_deudor_solidario: 'Jorge Enrique Ruiz' });
  });

  test('fin anterior a inicio y deudor basura, en orden', () => {
    const { errores } = validarContrato({ ...contrato, fin: '2025-01-01', documento_deudor_solidario: 'adada' }, HOY);
    expect(campos(errores)).toEqual(['fin', 'documento_deudor_solidario']);
    expect(errores[0]?.mensaje).toBe('La fecha de fin debe ser posterior a la de inicio');
  });

  test('mensaje heredado del día límite', () => {
    const { errores } = validarContrato({ ...contrato, fecha_limite_pago: 32 }, HOY);
    expect(errores[0]?.mensaje).toContain('día del mes');
  });

  test.each([
    ['nombre_deudor_solidario', { nombre_deudor_solidario: '12-31' }],
    ['inicio', { inicio: '2026-02-30' }],
    ['canon', { canon: 'abc' }],
    ['canon', { canon: 1e10 }],
    ['fecha_inicio_corte', { fecha_inicio_corte: 'mañana' }],
  ])('%s inválido', (campo, cambio) => {
    expect(campos(validarContrato({ ...contrato, ...cambio }, HOY).errores)).toEqual([campo]);
  });

  test('deudor incompleto falla en el campo que falta, en los dos sentidos', () => {
    expect(campos(validarContrato({ ...contrato, documento_deudor_solidario: '' }, HOY).errores)).toEqual([
      'documento_deudor_solidario',
    ]);
    expect(campos(validarContrato({ ...contrato, nombre_deudor_solidario: undefined }, HOY).errores)).toEqual([
      'nombre_deudor_solidario',
    ]);
  });

  test('sin deudor, o con los dos vacíos, es válido', () => {
    const sinDeudor = { ...contrato, nombre_deudor_solidario: '', documento_deudor_solidario: '' };
    expect(validarContrato(sinDeudor, HOY).errores).toEqual([]);
    expect(validarContrato(sinDeudor, HOY).datos.nombre_deudor_solidario).toBeUndefined();
  });
});

describe('validarInmueble', () => {
  const inmueble = { alias: 'Apto', direccion: 'Calle 1 # 2-3', tipo: 'apartamento' };

  test('alias, dirección y tipo inválidos juntos', () => {
    const { errores } = validarInmueble({ tipo: 'castillo' });
    expect(campos(errores)).toEqual(['alias', 'direccion', 'tipo']);
    expect(errores[0]?.mensaje).toBe('El alias es obligatorio');
    expect(errores[1]?.mensaje).toBe('La dirección es obligatoria');
    expect(errores[2]?.mensaje).toContain('apartamento');
  });

  test('ficha en texto sale como número', () => {
    const { datos, errores } = validarInmueble({ ...inmueble, estrato: '4', area_m2: '75.5', habitaciones: '3' });
    expect(errores).toEqual([]);
    expect(datos).toMatchObject({ estrato: 4, area_m2: 75.5, habitaciones: 3 });
  });

  test('varios campos de la ficha, en orden', () => {
    const { errores } = validarInmueble({ ...inmueble, alias: '', estrato: 7, habitaciones: -1 });
    expect(campos(errores)).toEqual(['alias', 'estrato', 'habitaciones']);
  });

  test('textos fuera de su columna', () => {
    const { errores } = validarInmueble({ ...inmueble, direccion: 'd'.repeat(256), barrio: 'b'.repeat(101) });
    expect(campos(errores)).toEqual(['direccion', 'barrio']);
  });

  test('ficha ausente: válido y sin claves con valor', () => {
    const { datos, errores } = validarInmueble(inmueble);
    expect(errores).toEqual([]);
    expect(datos.parqueaderos).toBeUndefined();
  });
});

describe('validarPago', () => {
  const hoy = '2026-10-12';

  test('monto y fecha inválidos, en orden', () => {
    const { errores } = validarPago({ monto: 'abc', fecha_pago: '2026-13-45' }, hoy);
    expect(campos(errores)).toEqual(['monto', 'fecha_pago']);
  });

  test.each([
    ['fecha_pago', { fecha_pago: '2026-10-13T17:00:00Z' }],
    ['medio_pago', { medio_pago: 'm'.repeat(51) }],
    ['tipo', { tipo: 'REGALO' }],
    ['monto', { monto: 0 }],
  ])('%s inválido', (campo, cambio) => {
    expect(campos(validarPago({ monto: '100', ...cambio }, hoy).errores)).toEqual([campo]);
  });

  test('un pago válido sin fecha ni tipo', () => {
    expect(validarPago({ monto: '100.50', medio_pago: 'Efectivo' }, hoy)).toEqual({
      datos: { monto: 100.5, fecha_pago: undefined, medio_pago: 'Efectivo', tipo: undefined },
      errores: [],
    });
  });
});

describe('validarCuentaCobro', () => {
  test.each([0, -5, 'abc', 1e10])('valor %s inválido', (valor) => {
    expect(campos(validarCuentaCobro({ valor }).errores)).toEqual(['valor']);
  });

  test('valor válido', () => {
    expect(validarCuentaCobro({ valor: '1500000' }).datos.valor).toBe(1500000);
  });
});

describe('validarContrato de un contrato que ya corría', () => {
  const antiguo = { ...contrato, inicio: '2020-02-17', fin: '2021-02-17', fecha_inicio_corte: undefined };
  const dia = '2026-11-02';
  const errorEn = (cuerpo: object, hoy = dia): string[] => campos(validarContrato(cuerpo, hoy).errores);
  const desde = (inicio: string) => ({ ...contrato, inicio, fin: '2027-12-31', fecha_inicio_corte: undefined });

  test('el último mes se guarda como el inicio de su periodo', () => {
    const { datos, errores } = validarContrato({ ...antiguo, ultimo_periodo_pagado: '2026-08', nunca_ajustado: true }, dia);
    expect(errores).toEqual([]);
    expect(datos.ultimo_periodo_pagado).toBe('2026-08-17');
  });

  test('un día de corte que el mes no tiene se recorta', () => {
    const { datos } = validarContrato(
      { ...antiguo, inicio: '2024-01-31', ultimo_periodo_pagado: '2026-02', nunca_ajustado: true },
      dia,
    );
    expect(datos.ultimo_periodo_pagado).toBe('2026-02-28');
  });

  test('con el primer corte ya pasado el último mes pagado es obligatorio; hoy o en el futuro, no', () => {
    const reciente = desde(dia);
    expect(errorEn(reciente)).toEqual([]);
    expect(errorEn(reciente, '2026-11-03')).toEqual(['ultimo_periodo_pagado']);
    expect(errorEn(desde('2026-12-01'))).toEqual([]);
  });

  test('si se envía sin que toque, no se guarda', () => {
    const { datos } = validarContrato({ ...desde(dia), ultimo_periodo_pagado: '2026-11', nunca_pagado: true }, dia);
    expect(datos.ultimo_periodo_pagado).toBeUndefined();
  });

  test.each([
    ['el mes anterior', '2026-08-17', '2026-07-17'],
    ['con el día recortado', '2026-03-31', '2026-02-28'],
    ['cruzando el año', '2026-01-10', '2025-12-10'],
  ])('«no ha pagado ningún mes» guarda el periodo anterior al primero: %s', (_caso, inicio, esperado) => {
    const { datos, errores } = validarContrato({ ...desde(inicio), nunca_pagado: true }, dia);
    expect(errores).toEqual([]);
    expect(datos.ultimo_periodo_pagado).toBe(esperado);
  });

  test('la casilla manda sobre un mes enviado', () => {
    const cuerpo = { ...desde('2026-08-17'), nunca_pagado: true, ultimo_periodo_pagado: '2026-10' };
    expect(validarContrato(cuerpo, dia).datos.ultimo_periodo_pagado).toBe('2026-07-17');
  });

  test('un primer corte anterior al inicio se rechaza y no pregunta el mes', () => {
    const cuerpo = { ...contrato, inicio: '2026-03-10', fin: '2027-03-10', fecha_inicio_corte: '2026-03-09', nunca_pagado: true };
    const { datos, errores } = validarContrato(cuerpo, dia);
    expect(campos(errores)).toEqual(['fecha_inicio_corte']);
    expect(datos.ultimo_periodo_pagado).toBeUndefined();
  });

  test('un primer corte que aún no llega no pregunta: no hay nada pagado', () => {
    expect(errorEn({ ...contrato, inicio: '2026-08-01', fecha_inicio_corte: '2026-12-01' })).toEqual([]);
  });

  test.each([
    ['anterior al primer corte', '2020-01'],
    ['posterior al periodo que toca', '2026-12'],
    ['mal formado', '2026-13'],
    ['fecha completa', '2026-08-17'],
  ])('mes %s', (_caso, ultimo_periodo_pagado) => {
    expect(errorEn({ ...antiguo, ultimo_periodo_pagado, nunca_ajustado: true })).toEqual(['ultimo_periodo_pagado']);
  });

  test('pasado el corte por más de dos días, el tope es el mes siguiente', () => {
    const cuerpo = { ...antiguo, ultimo_periodo_pagado: '2026-12', nunca_ajustado: true };
    expect(errorEn(cuerpo, '2026-11-19')).toEqual(['ultimo_periodo_pagado']);
    expect(errorEn(cuerpo, '2026-11-20')).toEqual([]);
  });

  test('con 12 meses o más exige la fecha del último ajuste o la casilla', () => {
    const conMes = { ...antiguo, ultimo_periodo_pagado: '2026-08' };
    expect(errorEn(conMes)).toEqual(['fecha_ultimo_ajuste']);
    expect(errorEn({ ...conMes, nunca_ajustado: true })).toEqual([]);
    expect(validarContrato({ ...conMes, fecha_ultimo_ajuste: '2026-02-17' }, dia).datos.fecha_ultimo_ajuste).toBe('2026-02-17');
  });

  test('a un día de los 12 meses no se pide; el día justo, sí', () => {
    const cuerpo = { ...contrato, inicio: '2025-11-03', fin: '2026-11-03', ultimo_periodo_pagado: '2026-10' };
    expect(errorEn(cuerpo)).toEqual([]);
    expect(errorEn(cuerpo, '2026-11-03')).toEqual(['fecha_ultimo_ajuste']);
  });

  test.each([
    ['anterior al inicio', '2020-02-16'],
    ['posterior a hoy', '2026-11-03'],
    ['inexistente', '2026-02-30'],
  ])('fecha de ajuste %s', (_caso, fecha_ultimo_ajuste) => {
    expect(errorEn({ ...antiguo, ultimo_periodo_pagado: '2026-08', fecha_ultimo_ajuste })).toEqual(['fecha_ultimo_ajuste']);
  });
});

describe('cuentasPendientes', () => {
  test('llega hasta el último corte que ya llegó o está a dos días', () => {
    expect(cuentasPendientes(17, '2026-08', '2026-11-02')).toEqual([
      { inicio: '2026-09-17', fin: '2026-10-16' },
      { inicio: '2026-10-17', fin: '2026-11-16' },
    ]);
    expect(cuentasPendientes(17, '2026-08', '2026-11-14')).toHaveLength(2);
    expect(cuentasPendientes(17, '2026-08', '2026-11-15')).toHaveLength(3);
    expect(cuentasPendientes(17, '2026-11', '2026-11-02')).toEqual([]);
  });
});

describe('mesesElegibles', () => {
  test('del más reciente al primer corte, con el periodo real de cada uno', () => {
    expect(mesesElegibles('2026-08-17', '2026-11-02')).toEqual([
      { mes: '2026-11', inicio: '2026-11-17', fin: '2026-12-16' },
      { mes: '2026-10', inicio: '2026-10-17', fin: '2026-11-16' },
      { mes: '2026-09', inicio: '2026-09-17', fin: '2026-10-16' },
      { mes: '2026-08', inicio: '2026-08-17', fin: '2026-09-16' },
    ]);
  });

  test('un día de corte que el mes no tiene se recorta', () => {
    expect(mesesElegibles('2026-01-31', '2026-02-10').at(0)).toEqual({ mes: '2026-02', inicio: '2026-02-28', fin: '2026-03-30' });
  });
});
