# ADR 0007 — Contraseña temporal para inquilinos dados de alta por su propietario

- Estado: Aceptada — **pendiente de implementar en el paso 3b**
- Fecha: 2026-09-06
- Paso de la migración: 3b (extracción de `ms-identidad`)

> **Desviación de la línea base.** El Documento Principal no especifica cómo obtiene sus
> credenciales un usuario creado por otro, y el mecanismo que aquí se decide **añade una
> columna a `Usuarios`**, que es una de las ocho tablas canónicas. Ver "Estado frente a
> la línea base".

## Contexto

Hay dos formas de que exista un usuario:

1. **Autorregistro.** La persona elige su propia contraseña en el formulario público.
   Ahí no hay problema.
2. **Alta por un tercero.** El propietario, en mitad de la firma de un contrato,
   descubre que el inquilino no está registrado y lo da de alta desde un modal
   (`POST /api/usuarios/inquilinos`, ver `docs/adr/0004`).

En el segundo caso el formulario pide nombres, apellidos, email, teléfono y documento.
**No pide contraseña**, porque el propietario no tiene por qué elegir la credencial de
otra persona.

Pero la contraseña es obligatoria, así que hoy el frontend rellena el hueco en silencio:

```js
contrasena: documentoInquilino // La cédula es la contraseña inicial
```

Esto tiene tres problemas, en orden de gravedad:

1. **La cédula no es un secreto.** La conoce el propietario —acaba de teclearla—, y en
   Colombia circula en contratos, recibos y formularios. Usarla como credencial
   convierte un dato de identificación en un dato de autenticación, que es exactamente
   lo que no debe hacerse.
2. **Es adivinable.** Un atacante que conozca el documento de alguien tiene su
   contraseña, y el documento aparece en la propia respuesta de
   `GET /api/usuarios/buscar`.
3. **Nadie se lo dice al inquilino.** No hay correo de bienvenida ni pantalla que se lo
   comunique. El usuario existe y puede entrar, pero no sabe que puede ni cómo. En la
   práctica queda creado sin forma de entrar.

El Documento Principal describe el módulo de seguridad y los contratos de autenticación,
pero **no dice nada sobre cómo obtiene credenciales un usuario creado por un tercero**.
Es un vacío, no una contradicción.

## Decisión

### 1. `ms-identidad` genera la contraseña, no el cliente

`POST /api/usuarios/inquilinos` deja de aceptar `contrasena`. El servicio genera una
**contraseña temporal aleatoria**:

- Origen criptográfico (`crypto.randomBytes`), nunca `Math.random()`.
- Alfabeto sin caracteres ambiguos: fuera `0`/`O`, `1`/`l`/`I`. El propietario va a
  leerla en voz alta o a copiarla a mano, y una `l` confundida con un `1` produce un
  bloqueo que parece un fallo del sistema.
- Longitud suficiente para que el alfabeto reducido no baje la entropía por debajo de
  lo razonable para un secreto de un solo uso y vida corta.

Se guarda **sólo su hash bcrypt** en `usuarios.contrasena`, igual que cualquier otra.

### 2. Se devuelve exactamente una vez

La respuesta `201` del alta incluye la temporal en claro. Es la única vez que existe en
claro fuera de la memoria del proceso:

- No se guarda en ninguna columna.
- No se puede recuperar después: no hay endpoint que la devuelva, y consultar el usuario
  más tarde nunca la incluye.
- **No aparece en logs.** El endpoint queda excluido de cualquier registro de cuerpos de
  petición o respuesta, y ningún `console.log` la toca. La tabla de auditoría de
  consultas de `ADR 0004`/paso 3b registra *qué documento se buscó*, nunca credenciales.

La SPA la muestra al propietario en el modal, para que se la entregue al inquilino **por
fuera del sistema** (en persona, por teléfono, en el mismo acto de firmar). El sistema no
la envía por correo: sería mover el secreto a un canal que no controlamos, y ahora mismo
el mailer es un buzón de pruebas.

Si el propietario cierra el modal sin anotarla, se perdió. Es el comportamiento correcto
para un secreto de un solo uso; ver "Sin resolver".

### 3. El usuario queda marcado con cambio obligatorio

Columna nueva en `usuarios`:

```sql
debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT false
```

Se pone en `true` en las altas por terceros y en `false` cuando la persona elige su
propia contraseña. El autorregistro nace en `false`.

El estado viaja en los claims del token, para que el gateway pueda actuar sin consultar
a `ms-identidad` en cada petición.

### 4. Hasta que la cambie, sólo puede cambiarla

Con el indicador en `true`, el control de acceso del gateway deniega **todo** salvo una
lista corta:

| Ruta | Por qué se permite |
|---|---|
| `POST /api/auth/login` | Es como entra. |
| `POST /api/auth/cambiar-contrasena` | Es lo único que se le pide hacer. |
| `POST /api/auth/logout` | Poder salir nunca debe depender de otra cosa. |

Cualquier otra ruta responde `403` con un código legible por máquina
(`CAMBIO_CONTRASENA_REQUERIDO`, junto al `mensaje` de siempre) para que la SPA redirija a
la pantalla de cambio en vez de mostrar un error genérico. Hay precedente de ese patrón
en `TENANT_NOT_FOUND`.

**Dónde se aplica.** En el middleware de control de acceso, no como fila de la matriz.
La matriz cruza método, ruta y rol; esto es una condición transversal del sujeto, no una
política de recurso. Meterla en la matriz obligaría a duplicar cada fila.

### 5. Al cambiarla, se revoca el token que la usó

`POST /api/auth/cambiar-contrasena` recibe la actual y la nueva. Al tener éxito:

1. Guarda el hash de la nueva y pone `debe_cambiar_contrasena` en `false`.
2. **Revoca el `jti` del token en curso**, que todavía lleva el indicador en `true`.
3. Devuelve un token nuevo, ya sin el indicador.

Sin el paso 2, el token viejo seguiría siendo válido durante su hora de vida y seguiría
diciendo que hace falta cambiar la contraseña — el usuario quedaría atrapado en la
pantalla de cambio o, peor, con un token que afirma algo que ya no es cierto.

## Consecuencias

**A favor**

- La cédula vuelve a ser sólo un identificador.
- Ninguna credencial la elige alguien distinto de su dueño, y la temporal tiene una vida
  medida en el tiempo que tarda la persona en entrar por primera vez.
- El propietario sabe qué entregar: hoy no lo sabe, porque nadie le dice que la
  contraseña es la cédula.

**En contra**

- Aparece un paso manual: alguien tiene que transmitir la temporal fuera del sistema.
  Es deliberado — es el único canal que no depende de infraestructura que no tenemos.
- Una columna más en `Usuarios`, que es tabla canónica.
- El propietario ve, un instante, una credencial de otra persona. Es inevitable en
  cualquier alta por terceros, y por eso la temporal muere en el primer cambio.

**Sin resolver**

- **No hay reemisión.** Si la temporal se pierde antes de usarse, hoy no hay forma de
  generar otra. Hace falta un `POST /api/usuarios/:id/contrasena-temporal`, restringido
  al propietario que creó al usuario y registrado en la auditoría. Queda anotado como
  decisión abierta.
- **No hay recuperación por correo** para nadie, ni siquiera para propietarios. Es un
  vacío anterior a este ADR.
- **La temporal no caduca por sí sola.** Un inquilino que nunca entre conserva la suya
  indefinidamente. Ponerle vencimiento exige un `expira_en` y un barrido; se puede
  añadir después sin romper nada de lo aquí decidido.

## Alternativas descartadas

**Seguir usando la cédula.** Cero trabajo y es lo que hay hoy. Descartada por lo dicho
arriba: convierte un identificador público en credencial.

**Que el propietario elija la contraseña del inquilino.** Un campo más en el modal.
Descartada porque el propietario acabaría poniendo la misma para todos sus inquilinos, y
porque conocer la credencial ajena de forma persistente es peor que conocer una temporal
que muere al primer uso.

**Enviar la temporal por correo al inquilino.** Es lo natural en un producto maduro y
evita que el propietario la vea. Descartada *por ahora*: el mailer apunta a un buzón de
pruebas (Ethereal), así que hoy el correo no llega a nadie, y montar entrega fiable no
cabe en este paso. Cuando exista `ms-notificaciones` (paso 7) será la evolución obvia, y
el diseño no lo impide: bastará con dejar de devolverla en la respuesta.

**Enlace de activación de un solo uso en vez de contraseña.** Más seguro y sin secreto
que transcribir. Descartada por coste: exige tabla de tokens de activación, envío de
correo funcionando y una pantalla pública nueva. Es la alternativa a considerar el día
que se rehaga el onboarding.

## Estado frente a la línea base

Dos desviaciones, ambas por vacío del documento y no por contradicción:

1. **El mecanismo de credenciales para altas por terceros no está en el Capítulo 2.**
   El documento cubre registro, login, logout y revocación, pero no este caso, pese a
   que RF-02 lo exige.
2. **`debe_cambiar_contrasena` es una columna que el modelo canónico no lista.**
   `Usuarios` está definida con nombres, apellidos, email, contrasena, telefono y
   documento. CLAUDE.md prohíbe crear tablas fuera de las canónicas sin actualizar el
   documento primero; una columna en una tabla canónica cae en el mismo espíritu.

Las dos **deben incorporarse al Capítulo 2 en su próxima revisión**, por el proceso de
la sección 13.3.2 del PMP, junto con el endpoint `POST /api/auth/cambiar-contrasena`.
Hasta entonces manda el documento.

## Alcance de implementación (paso 3b)

Lo que este ADR compromete, para que no se pierda al escribir el servicio:

- `ms-identidad`: generación de la temporal, columna e indicador en claims, endpoint de
  cambio, revocación del `jti` al cambiar.
- Migración que añade `debe_cambiar_contrasena` a `usuarios`.
- Gateway: comprobación transversal en el control de acceso, con su lista de rutas
  permitidas y el código `CAMBIO_CONTRASENA_REQUERIDO`.
- SPA: el modal de alta deja de enviar `contrasena` y muestra la temporal devuelta;
  pantalla de cambio obligatorio; redirección al recibir el código.
- Pruebas: que la temporal no aparezca en ninguna consulta posterior, que el indicador
  bloquee el resto de la API, que el cambio lo levante y revoque el token anterior.
