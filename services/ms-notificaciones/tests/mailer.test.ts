/**
 * A un dominio reservado no se envía: no tiene buzón y el rebote llega al remitente.
 */

import { enviarCorreo, esDominioReservado } from '../src/config/mailer';

describe('Dominios reservados', () => {
  test.each([
    'propietario@arriendos360.test',
    'MOROSO@ARRIENDOS360.TEST',
    'alguien@example',
    'alguien@sub.example.org',
    'alguien@example.com',
    'alguien@nada.invalid',
    'alguien@localhost',
  ])('%s es reservado', (correo) => {
    expect(esDominioReservado(correo)).toBe(true);
  });

  test.each(['alguien@gmail.com', 'alguien@test.com', 'alguien@mytest', 'alguien@b.testing'])(
    '%s no es reservado',
    (correo) => {
      expect(esDominioReservado(correo)).toBe(false);
    },
  );

  test('enviarCorreo no lo manda y lo da por simulado', async () => {
    await expect(
      enviarCorreo('inquilino@arriendos360.test', 'Asunto', '<p>Hola</p>'),
    ).resolves.toEqual({ messageId: 'dominio-reservado', simulado: true });
  });
});
