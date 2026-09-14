# ADR 0010 — Recuperación de contraseña

- Estado: Aceptada
- Fecha: 2026-09-07
- Paso de la migración: previo al 4

Resuelve dos decisiones abiertas: **«reemisión de la contraseña temporal»** y
**«recuperación de contraseña»**, ambas anotadas al implementar el ADR 0007.

> **Desviación de la línea base.** El Documento Principal no contempla la recuperación
> de contraseña, y el mecanismo añade **una columna a `Usuarios`** y una tabla al esquema
> de identidad. Además, el envío del correo desde `ms-identidad` contradice el diseño de
> notificaciones del Capítulo 2. Ver "Estado frente a la línea base".

## Contexto

Hasta aquí, **perder la contraseña era perder la cuenta**. No había recuperación para
ningún rol, y el ADR 0007 añadió un segundo agujero por el mismo hueco: la temporal del
inquilino se muestra una vez y no se puede volver a consultar, así que si el propietario
cerraba la ventana sin anotarla, ese usuario quedaba creado y sin forma de entrar.

Son dos problemas con la misma forma —«no puedo entrar y no hay salida»— pero con dueños
distintos: uno lo resuelve la persona con su correo, el otro su arrendador.

## Decisiones

### 1. Reemisión por el propietario: vive en el gateway, no en `ms-identidad`

`POST /api/contratos/:id/contrasena-inquilino` regenera la temporal del inquilino de ese
contrato y la devuelve una sola vez, con las mismas garantías que el alta.

**Por qué en el gateway.** La regla de autorización es *«sólo sobre inquilinos con
contrato en mis inmuebles»*, y eso son datos de contratos e inmuebles. `ms-identidad` es
subdominio de **Soporte**: si tuviera que comprobarlo, dependería de un servicio de
dominio e invertiría la dirección de las dependencias. En el gateway la comprobación es
una consulta local y trivial, y la regeneración se delega por HTTP a
`POST /interno/usuarios/:id/contrasena-temporal`, que no comprueba nada porque su
llamante ya lo hizo.

**Por qué la ruta cuelga del contrato.** Porque el contrato *es* lo que autoriza. Una
ruta como `/api/usuarios/:id/contrasena-temporal` habría sido más obvia, pero
`/api/usuarios` lo reenvía la costura a `ms-identidad`, que es justo donde no puede
resolverse. Colgarla del contrato hace la autorización evidente en la propia URL.

Responde `404` y no `403` cuando el contrato no es del solicitante: confirmar que existe
ya sería información.

**La auditoría registra a la persona, no al servicio.** El gateway envía
`solicitado_por` con el `sub` del propietario. Usar el `iss` del token de servicio
—`"gateway"`— además de no ser un UUID, perdería el dato que importa auditar en una
reemisión de credencial: qué persona la provocó.

### 2. Recuperación por correo

`POST /api/auth/recuperar` recibe un email; `POST /api/auth/restablecer` recibe el token
del enlace y la contraseña nueva. Las dos públicas: quien las usa, por definición, no
puede entrar.

**`/recuperar` responde siempre lo mismo.** Exista o no la cuenta, y **también cuando
falla por dentro**. Si la respuesta cambiara, la API sería un verificador de cuentas
registradas: se prueban correos y se apunta cuáles existen. Por eso tampoco hay `404`
para un email desconocido ni un mensaje distinto si el envío falla — cualquier
diferencia observable sirve de oráculo.

Queda un canal lateral que **no** se cierra: el tiempo de respuesta. Con cuenta se hace
una escritura y un envío; sin cuenta, nada. Cerrarlo exigiría igualar tiempos
artificialmente, y con el correo saliendo de forma asíncrona la diferencia ya es pequeña.
Anotado, no resuelto.

**El token se guarda hasheado.** SHA-256, nunca en claro. Quien consiga leer la tabla no
debe poder restablecer la contraseña de nadie.

Se usa SHA-256 y no bcrypt a propósito, que es lo contrario de lo que se hace con
contraseñas. Bcrypt es lento por diseño para resistir fuerza bruta sobre secretos que las
personas eligen mal; aquí el secreto tiene 256 bits de entropía y no hay nada que
adivinar. Y la búsqueda al restablecer es *por* el hash: con bcrypt, que sala cada
cálculo, habría que recorrer la tabla comparando fila a fila.

**Un solo uso y 30 minutos.** Un enlace usado no vuelve a servir aunque no haya vencido;
sin eso, quien tuviera acceso al buzón podría restablecer la contraseña tantas veces como
quisiera durante media hora. Pedir recuperación otra vez invalida el enlace anterior.

**Restablecer no da sesión.** Devuelve un mensaje, no un token: hay que iniciar sesión.
Darle sesión convertiría el enlace del correo en un acceso directo a la cuenta.

### 3. Al restablecer caen todas las sesiones

Columna `contrasena_cambiada_en` en `Usuarios`. Todo token con `iat` anterior a esa marca
deja de valer.

**Por qué no revocar `jti` uno por uno.** Porque no se sabe cuáles hay. Quien restablece
su contraseña normalmente lo hace porque sospecha que alguien más está dentro, y esa
sesión es precisamente la que no aparece en ninguna lista. Una comparación de fechas las
tira todas, incluidas las que nadie sabía que existían, y cuesta una columna en vez de
una tabla creciente.

El gateway lo consume por la misma vía que ya tenía: `/interno/revocados` devuelve ahora
dos listas —los `jti` revocados y las marcas de cambio— y la caché guarda las dos. Mismo
refresco, misma ventana de 15 s del ADR 0008.

**El empate de un segundo.** El `iat` de un JWT viene en segundos enteros, así que no se
puede distinguir un token emitido 100 ms antes del cambio de uno emitido 100 ms después.
Hay que elegir quién pierde el empate, y **lo pierde el token viejo**: la marca se
redondea *hacia arriba*. Una sesión ajena que sobreviva un segundo más es peor que
cualquier otra cosa que pueda pasar aquí.

Eso dejaría al token que emite `cambiar-contrasena` invalidándose a sí mismo, así que no
se deja al azar: se ancla su `iat` a esa misma marca (`noAntesDe`).

### 4. El correo sale de `ms-identidad`, detrás de una interfaz

`ms-identidad` **no debería saber que existe un servidor SMTP**. El Capítulo 2 pone las
notificaciones en `ms-notificaciones` (paso 7), avisado por un evento en el bus.

Pero la recuperación necesita mandar un correo hoy, y ni el bus ni ese servicio existen.
Se manda directo y se aísla tras `Notificador`, con un único método `notificar` —el
nombre no se compromete con el canal— para que el paso 7 sea sustituir la implementación
por una que publique `RecuperacionSolicitada`, **sin tocar una línea de la lógica de
recuperación**.

Es una desviación temporal, deliberada y con fecha de caducidad.

## Consecuencias

**A favor**

- Perder la contraseña deja de ser perder la cuenta, para cualquier rol.
- La temporal del inquilino deja de ser irrecuperable.
- Restablecer sirve de verdad para expulsar a un intruso, que es para lo que se usa.

**En contra**

- Una columna más en `Usuarios` y una tabla más en el esquema de identidad.
- El correo depende de que el buzón funcione. Con `EMAIL_USER` sin definir apunta a
  Ethereal y **no llega a nadie**: en desarrollo hay que leer el enlace del log o de la
  base. Es la misma razón por la que el ADR 0007 no envía la temporal por correo.
- La ruta de reemisión cuelga del contrato, que no es donde uno la buscaría primero.

**Sin resolver**

- **El canal lateral de tiempo en `/recuperar`**, descrito arriba.
- **No hay límite de intentos.** Nada impide pedir mil enlaces para un correo. Cada
  petición invalida la anterior, así que no se acumulan tokens, pero sí correos. Hace
  falta limitación de tasa; es un problema de toda la API, no sólo de aquí, y no se
  resuelve en este PR.
- **Los tokens usados o vencidos no se borran.** Igual que con `tokens_revocados`, dejan
  de tener efecto por la consulta y no estorban. Si algún día molestan, un `DELETE`.

## Alternativas descartadas

**Código corto por SMS o correo** en vez de enlace. Más cómodo en móvil, pero exige
limitación de tasa de verdad —seis dígitos se adivinan— y un proveedor de SMS que no hay.

**Preguntas de seguridad.** Cero infraestructura. Descartada: las respuestas suelen ser
adivinables o públicas, y añaden datos personales que después hay que custodiar.

**Que el propietario pueda fijar la contraseña del inquilino** en lugar de reemitir una
temporal. Descartada por lo mismo que en el ADR 0007: nadie debe elegir la credencial de
otra persona, y una temporal que muere al primer uso es preferible a una que el
propietario conoce indefinidamente.

**Revocar los `jti` conocidos al restablecer**, en vez de la marca de tiempo. Descartada
por lo dicho: no cubre la sesión que motiva el restablecimiento.

## Estado frente a la línea base

Tres desviaciones, todas por vacío o por adelanto del documento:

1. **La recuperación de contraseña no está en el Capítulo 2.** Ni el flujo, ni los
   endpoints, ni la tabla de tokens.
2. **`contrasena_cambiada_en` es una columna que el modelo canónico no lista**, como ya
   ocurrió con `debe_cambiar_contrasena` (ADR 0007).
3. **El envío directo desde `ms-identidad` contradice el diseño de notificaciones**, que
   asigna esa responsabilidad a `ms-notificaciones` vía bus de eventos. Es temporal y está
   aislada tras `Notificador` precisamente para poder revertirla en el paso 7.

Las tres **deben incorporarse al Capítulo 2 en su próxima revisión**, por el proceso de la
sección 13.3.2 del PMP. La tercera, en cambio, debe **desaparecer** en el paso 7 en lugar
de documentarse como permanente.

## Verificación

`services/ms-identidad/tests/recuperacion.test.ts`: respuesta idéntica con email
inexistente, token hasheado en la base, un enlace nuevo invalida el anterior, token ya
usado, token vencido, vigencia de 30 minutos, que restablecer no devuelva sesión, que un
token emitido antes del cambio quede inválido —comprobado contra la API y contra
`tokenInvalidado`— y la reemisión completa.

`apps/gateway/tests/cacheRevocados.test.js`: la invalidación en bloque, incluido el caso
del empate en el mismo segundo y la convivencia de las dos formas de invalidar.

## Anotaciones posteriores (2026-09-14)

- **Decisión 1 — el emplazamiento cambió en el paso 6d.** La reemisión de la
  contraseña temporal se mudó a ms-contratos junto con los contratos: el argumento
  de este ADR sigue valiendo, pero quien tiene los datos ya no es el gateway. Ver
  `docs/adr/0017`, «Lo que esto arrastra».
- **Decisión 4 — SALDADA en el paso 7.** ms-identidad ya no envía correo: publica
  `RecuperacionSolicitada` y `ContrasenaTemporalEmitida`, y `Notificador` se retiró
  con su interfaz. Ver `docs/adr/0019`. Sigue pendiente de incorporar al Capítulo 2
  el resto: los endpoints, la tabla de tokens y la columna `contrasena_cambiada_en`.
