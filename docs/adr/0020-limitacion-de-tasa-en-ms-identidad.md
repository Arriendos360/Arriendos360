# ADR 0020 — La limitación de tasa de las rutas de autenticación vive en ms-identidad

- **Estado:** aceptada
- **Fecha:** 2026-09-14
- **Paso:** 8 (preparación del despliegue)
- **Se aparta del Capítulo 2:** no. Resuelve una decisión abierta. La tabla nueva es
  operativa, no de dominio, y el cambio del login cierra una fuga, no cambia el contrato.

## Contexto

Nada impedía mil intentos por segundo contra las cuatro rutas públicas:
`POST /api/auth/login`, `/registro`, `/recuperar` y `/restablecer`. CLAUDE.md lo tenía
como decisión abierta, con dos lugares candidatos: el gateway o el ingreso de Container
Apps.

Había dos condiciones. Tenía que funcionar con varias réplicas, así que un contador en
memoria por instancia no servía. Y el login tenía que contar también **por cuenta**: con
10 intentos por IP, una oficina o una universidad detrás de una NAT se bloquean entre sí.

## Decisión

### Dónde: en ms-identidad

**Contar por cuenta exige leer el correo del cuerpo y saber si la contraseña coincidió.**
El gateway no puede hacer ninguna de las dos cosas: reenvía el cuerpo en streaming sin
leerlo —es lo que permite los anexos en multipart— y no sabe cómo acabó el login. Así que
el gateway no era sólo peor: no cumplía el requisito.

Ponerlo en ms-identidad, además:

- **no añade ningún salto de red**, porque las cuatro rutas ya llegaban allí;
- **mantiene al gateway sin base** y arrancando con PostgreSQL caído;
- **no gasta conexiones** del cupo del servidor de base de datos;
- y proteger credenciales contra la fuerza bruta es asunto del servicio de identidad.
  El gateway decide quién puede llamar qué, no cuántas veces.

El ingreso de Container Apps **no ofrece limitación de tasa**: sólo restricción por IP,
CORS y afinidad de sesión. Front Door o API Management sí la tienen, pero con coste.

### Los contadores

| Ruta | Clave | Cuenta | Límite |
|---|---|---|---|
| login | IP | todos los intentos | 100 / 15 min |
| login | cuenta + IP | sólo los fallidos | 5 / 15 min |
| registro | IP | todos | 10 / hora |
| recuperar | IP | todos | 5 / hora |
| recuperar | cuenta | todos, **en silencio** | 3 / hora |
| restablecer | IP | todos | 5 / hora |

- **No hay contador de login sólo por cuenta.** Sería un mecanismo de bloqueo a pedido:
  cualquiera dejaría fuera a otra persona fallando su contraseña cinco veces. Con cuenta
  e IP, fallar el login de alguien bloquea **la IP del atacante para esa cuenta**; la
  víctima entra desde la suya.
- **El registro va a 10 por hora**, no a un límite holgado: 60 por minuto permitiría
  ochenta mil cuentas al día desde una sola IP.
- **El límite por cuenta de `/recuperar` es silencioso.** Pasado el tercero no se emite
  enlace, pero se responde el mismo 200 de siempre. Un 429 diría que el correo existe, que
  es justo lo que ese endpoint defiende. Frena el bombardeo a una víctima desde muchas IP,
  y el último enlace enviado sigue valiendo. La primera vez que salta en una ventana
  queda en el log, con el correo enmascarado, para que se entienda por qué alguien no
  recibe su enlace.

### El login deja de decir qué cuentas existen

Respondía 404 «Usuario no encontrado» o 401 «Contraseña incorrecta», y con un correo
desconocido se saltaba `bcrypt.compare`, así que además respondía antes. Con eso los
contadores por cuenta perdían el sentido: el atacante ya sabía qué correos probar.

Se cierran **los dos canales**. Un único 401, «Correo o contraseña incorrectos», y la
comparación con bcrypt siempre, contra un hash ficticio del mismo coste cuando el correo
no existe. Igualar sólo el mensaje dejaba el oráculo intacto, sólo más lento de explotar.
Los contadores tratan igual un correo inexistente, así que el 429 tampoco lo delata.

La SPA no se ve afectada: muestra el `mensaje` de la respuesta, y el interceptor de 401
sólo vacía una sesión que en la pantalla de login no existe.

### La IP: firmada por el gateway

ms-identidad ve como origen al gateway, y `X-Forwarded-For` no sirve porque el gateway
copiaba las cabeceras entrantes: cualquiera podía inventarse su IP.

- El gateway resuelve la IP del cliente, con `PROXY_SALTOS_CONFIANZA` saltos de
  confianza, y la **firma en cada reenvío** con `SERVICIO_JWT_SECRET`, en la cabecera
  `x-origen-cliente`. Descarta las cabeceras de origen que traiga el cliente y reescribe
  `X-Forwarded-For` con la IP resuelta.
- ms-identidad usa la IP firmada **sólo si la firma es válida**; si no, la de su conexión.
  Quien llame directo al puerto del servicio queda limitado por su propia IP. Es la regla
  dura 7 aplicada a un dato.
- **El token de origen no es un token de servicio.** Su audiencia lleva el sufijo
  `#origen`, así que no vale como credencial de `/interno`, ni al revés.
- **Cada firma es única** (`jti` aleatorio) y no se guarda: reutilizarla contaría a todos
  los clientes bajo la IP del primero. Hay una prueba en el gateway que lo impide.
- Una IPv6 cuenta por su /64, que es lo que se asigna a un cliente y lo que se podría
  rotar gratis.

### El almacenamiento

Tabla `identidad.limites_tasa` en la migración `database/identidad/007`:

- **`UNLOGGED`:** si PostgreSQL se cae sin apagarse bien, los contadores vuelven a cero.
  Se pierde como mucho una ventana.
- **Una sola sentencia** `INSERT … ON CONFLICT DO UPDATE … RETURNING`, atómica aunque
  varias réplicas cuenten a la vez.
- **Ventana fija.** Permite una ráfaga del doble justo en el cambio de ventana; se acepta
  a cambio de la simplicidad.
- Claves con SHA-256: ni correos ni IP en claro.
- Las ventanas vencidas se purgan cada cinco minutos desde el arranque del servicio.

**La respuesta:** 429 con `Retry-After` igual a la ventana entera, no a lo que falta, y
sin cabeceras de cuota: son rutas de autenticación, y decir cuándo se desbloquea le dice
al atacante cuándo volver. Si el almacén falla, 503: dejar pasar sin contar es lo que el
límite existe para impedir, y sin base esas rutas fallarían igual un paso después.

## Riesgos aceptados

- **Un ataque repartido entre muchas IP contra una sola cuenta no se frena.** Defenderse
  pide reputación de IP y está fuera de alcance. Un contador sólo por cuenta lo frenaría a
  cambio de permitir bloquear a cualquiera, que es peor.
- Quien comparta la NAT con un atacante puede quedar bloqueado para esa cuenta durante
  una ventana.
- El registro sigue diciendo «El email ya está registrado», porque el formulario lo
  necesita. Queda acotado a 10 intentos por hora por IP.

## Queda abierto

El límite holgado para el resto de la API se aplaza. Nunca fue lo bloqueante; si hace
falta, cada servicio se limita a sí mismo.

## Estado frente a la línea base

No se aparta del Capítulo 2. `limites_tasa` es infraestructura interna del servicio, de la
misma familia que `eventos_salida` o `eventos_procesados`, que tampoco se tramitaron: la
regla de no crear tablas fuera de las canónicas se refiere al modelo de dominio.
`tokens_recuperacion` sí se tramitó (`docs/adr/0010`), pero por el flujo de negocio nuevo
que traía, no por ser una tabla.
