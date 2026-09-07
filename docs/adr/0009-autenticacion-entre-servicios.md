# ADR 0009 — Autenticación entre servicios para los endpoints `/interno`

- Estado: Aceptada
- Fecha: 2026-09-07
- Paso de la migración: previo al 4

Resuelve la decisión abierta **«autenticación entre servicios para `/interno`»**, anotada
al extraer `ms-identidad`.

## Contexto

`ms-identidad` expone dos endpoints que no llama una persona sino otro servicio:

- `GET /interno/revocados` — la lista de `jti` que el gateway cachea.
- `GET /interno/usuarios?ids=` — nombres, apellidos, documento, **teléfono y email** de
  varios usuarios a la vez, para que el gateway componga sus respuestas.

Cuelgan de `/interno` y no de `/api` porque la costura del gateway sólo reenvía
prefijos `/api/*`, así que no son alcanzables *a través del gateway*. Eso se documentó
como si fuera la protección, y no lo era:

**`infra/docker-compose.yml` publica `3011:3011`.** Cualquier proceso de la máquina
podía pedir `/interno/usuarios` y recibir los datos de contacto de todos los usuarios,
sin credencial alguna. La red no estaba protegiendo nada, y aunque lo hiciera, la regla
dura 7 dice exactamente lo contrario: *ninguna petición se considera confiable por venir
de la red interna*.

## Decisión

Un **JWT de servicio de vida corta**, firmado por el llamante y verificado por el
destinatario. Las dos mitades viven en `packages/shared/src/servicio.ts`, para que los
cuatro servicios siguientes lo hereden sin reimplementarlo.

```
Authorization: Servicio <jwt>

{ iss: "gateway", aud: "ms-identidad", exp: ahora + 60s }
```

### Por qué no un secreto compartido en cabecera

Era la alternativa obvia: una variable de entorno, una comparación en tiempo constante,
cero criptografía. Funciona igual en Compose y en Container Apps y no depende de la
topología, que eran los criterios.

Se descartó por una razón concreta: **la credencial viaja en cada petición**. Basta con
que una traza de APM, un log de proxy inverso o un volcado de error capture una sola
llamada para que quien lo lea tenga una credencial válida **para siempre**, hasta que
alguien rote el secreto a mano y a la vez en todos los servicios.

Con el JWT, la clave **nunca sale del proceso**. Lo que viaja es un token derivado que
caduca en 60 segundos. El mismo log filtrado entrega algo inservible.

Además trae tres cosas que el secreto en cabecera no puede dar:

- **Identidad del llamante** (`iss`): el destinatario sabe que fue el gateway y no otro,
  puede registrarlo y, con `emisoresPermitidos`, autorizar por servicio.
- **Destinatario explícito** (`aud`): un token para `ms-identidad` no sirve contra
  `ms-financiero`.
- **Cero dependencias nuevas**: `packages/shared` ya usaba `jsonwebtoken`.

### Dos detalles que no son opcionales

**El secreto es distinto del de usuario.** `SERVICIO_JWT_SECRET` no es `JWT_SECRET`. Si
compartieran clave, **el token de cualquier inquilino serviría para llamar a `/interno`**
y leerse la tabla de usuarios entera. Esto es lo que separa una mejora de seguridad de un
agujero peor que el que se quería cerrar. Hay una prueba explícita de ello.

**El esquema es propio, no `Bearer`.** El verificador exige `Authorization: Servicio ...`,
de modo que un token de usuario no puede colarse ni por accidente. Es una segunda barrera
sobre la primera, barata y que no depende de que nadie configure bien nada.

### Detalles operativos

| | |
|---|---|
| Vigencia | 60 s. Sobra para una llamada entre contenedores; más corto y el desfase de reloj pesaría más que la ventana que se cierra |
| Tolerancia de reloj | 10 s |
| Respuesta ante cualquier fallo | `401` con el mismo mensaje, sin distinguir causa |
| Firma | En cada llamada. Cachear el token ahorraría microsegundos a cambio de gestionar su caducidad |

**Una sola respuesta para todos los fallos.** No se distingue entre «no mandaste
credencial», «la firma no cuadra» y «caducó». A un llamante legítimo le da igual —es una
máquina, no va a corregir nada leyendo el mensaje— y a quien esté probando no se le
regalan pistas.

**Se aplica con `router.use`, no ruta por ruta.** Así un endpoint `/interno` nuevo nace
protegido y no hay forma de olvidarse. Hay una prueba de que incluso una ruta inexistente
bajo `/interno` responde `401`.

### El puerto 3011 se queda publicado

Se consideró dejar de publicarlo. Se descartó: cerrarlo sería protegerse por topología,
que es justo lo que el criterio excluía, y quita la posibilidad de llamar a
`ms-identidad` directamente en una demostración. Con la autenticación en su sitio, que el
puerto esté abierto deja de importar.

## Consecuencias

**A favor**

- Los `/interno` dejan de ser públicos para cualquier proceso de la máquina.
- Funciona idéntico en Compose y en Container Apps: no depende de red, DNS ni malla.
- Los cuatro servicios siguientes lo heredan con dos líneas — una para firmar, una para
  exigir.

**En contra**

- Una variable de entorno más que mantener sincronizada entre servicios. Si se
  desincroniza, las llamadas internas fallan con `401` y el gateway degrada: los
  contratos salen sin nombre de inquilino y la caché de revocados se queda con su última
  copia. Lo delata el log, no una caída.
- Los tokens no son revocables individualmente. Con 60 s de vida no compensa el estado
  que haría falta para revocarlos.

**Lo que NO resuelve**

Con **una sola clave compartida** entre todos los servicios, cualquiera que la tenga
puede firmar como cualquier otro. Eso lo comparte con el secreto en cabecera: comprometer
un servicio permite suplantar a los demás.

El arreglo real son claves asimétricas por servicio (RS256), pero exige distribución y
rotación de claves —infraestructura que hoy no existe y que no cabe en el timebox ni en
el presupuesto. Queda preparado: el verificador resuelve la clave **en función del `iss`**
(`resolverClave`), así que pasar a clave por servicio es cambiar esa función y la
configuración, no rediseñar. Hay una prueba que ejercita ese camino.

## Alternativas descartadas

**mTLS.** Lo canónico entre servicios y lo que Container Apps facilita. Descartada porque
depende de la infraestructura: en Compose habría que montar una CA propia, emitir
certificados y distribuirlos, y el resultado no sería el mismo mecanismo en los dos
entornos. El criterio pedía justo lo contrario.

**Políticas de red / reglas de ingreso interno.** Cero código, pero es exactamente
«confiar en la red», que la regla dura 7 prohíbe, y no viaja entre Compose y Azure.

**Firma HMAC de la petición** (método + ruta + cuerpo + marca de tiempo). Protege también
contra manipulación del cuerpo, no sólo suplantación del llamante. Descartada por coste:
exige canonicalizar la petición en los dos extremos y equivocarse ahí es sutil. Los
`/interno` de hoy son `GET` sin cuerpo, así que no aporta sobre el JWT.

**Identidad administrada de Azure / OAuth client credentials.** Lo correcto en producción
sobre Azure, y sin secretos que rotar a mano. Descartada porque no existe fuera de Azure:
en Compose habría que emular un proveedor de identidad. Es la evolución natural cuando el
paso 8 despliegue en Container Apps.

## Verificación

`packages/shared/tests/servicio.test.ts` — 18 pruebas: firma, extracción, verificación,
que un token de usuario no valga, que uno dirigido a otro servicio no valga, que caduque,
que todos los fallos respondan lo mismo, resolución de clave por emisor y el middleware.

`services/ms-identidad/tests/usuarios.test.ts` — bloque «Autenticación entre servicios»:
`401` sin credencial y `200` con ella en los dos endpoints reales, un token de usuario
rechazado, una credencial dirigida a otro servicio rechazada, y la protección cubriendo
rutas inexistentes bajo `/interno`.

El doble de `ms-identidad` que usan las suites del gateway **también exige la
credencial**. Si no lo hiciera, esas suites pasarían aunque el gateway olvidara mandarla,
que es precisamente el fallo que nadie quiere descubrir en producción.
