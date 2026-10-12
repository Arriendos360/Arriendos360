import {
  errorDeValidacion,
  validarAltaInquilino,
  validarContrato,
  validarCuentaCobro,
  validarInmueble,
  validarPago,
  validarRegistro,
} from '../src/validacion/cuerpos';

const campos = (errores: { campo: string }[]): string[] => errores.map((error) => error.campo);

const persona = {
  nombres: 'Ana María',
  apellidos: 'Ruiz',
  documento: '1020304050',
  telefono: '3001234567',
  email: 'ana@correo.com',
};

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
    const { datos, errores } = validarContrato({ ...contrato, nombre_deudor_solidario: ' Jorge  Enrique Ruiz ' });
    expect(errores).toEqual([]);
    expect(datos).toMatchObject({ canon: 1500000, fecha_limite_pago: 5, nombre_deudor_solidario: 'Jorge Enrique Ruiz' });
  });

  test('fin anterior a inicio y deudor basura, en orden', () => {
    const { errores } = validarContrato({ ...contrato, fin: '2025-01-01', documento_deudor_solidario: 'adada' });
    expect(campos(errores)).toEqual(['fin', 'documento_deudor_solidario']);
    expect(errores[0]?.mensaje).toBe('La fecha de fin debe ser posterior a la de inicio');
  });

  test('mensaje heredado del día límite', () => {
    const { errores } = validarContrato({ ...contrato, fecha_limite_pago: 32 });
    expect(errores[0]?.mensaje).toContain('día del mes');
  });

  test.each([
    ['nombre_deudor_solidario', { nombre_deudor_solidario: '12-31' }],
    ['inicio', { inicio: '2026-02-30' }],
    ['canon', { canon: 'abc' }],
    ['canon', { canon: 1e10 }],
    ['fecha_inicio_corte', { fecha_inicio_corte: 'mañana' }],
  ])('%s inválido', (campo, cambio) => {
    expect(campos(validarContrato({ ...contrato, ...cambio }).errores)).toEqual([campo]);
  });

  test('deudor incompleto falla en el campo que falta, en los dos sentidos', () => {
    expect(campos(validarContrato({ ...contrato, documento_deudor_solidario: '' }).errores)).toEqual([
      'documento_deudor_solidario',
    ]);
    expect(campos(validarContrato({ ...contrato, nombre_deudor_solidario: undefined }).errores)).toEqual([
      'nombre_deudor_solidario',
    ]);
  });

  test('sin deudor, o con los dos vacíos, es válido', () => {
    const sinDeudor = { ...contrato, nombre_deudor_solidario: '', documento_deudor_solidario: '' };
    expect(validarContrato(sinDeudor).errores).toEqual([]);
    expect(validarContrato(sinDeudor).datos.nombre_deudor_solidario).toBeUndefined();
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
