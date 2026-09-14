# ADR 0008 — Caché de tokens revocados en el gateway

- Estado: Aceptada
- Fecha: 2026-09-07
- Paso de la migración: 3b (extracción de `ms-identidad`)

Resuelve la decisión abierta **«Frecuencia de refresco de la caché de revocados en el
gateway»** de CLAUDE.md.

## Contexto

El gateway comprueba en **cada petición autenticada** si el token está revocado. Mientras
`tokens_revocados` vivía en su misma base, eso era un `SELECT` local por una clave
primaria: barato y sin más consecuencias.

Al extraer `ms-identidad`, esa tabla se fue a otro esquema y a otro servicio. Consultarla
directamente violaría la regla dura 3, así que sólo quedan dos formas de saberlo:
preguntar por HTTP en cada petición, o mantener una copia.

Preguntar en cada petición tiene dos problemas que se refuerzan:

1. **Mete un salto de red en el camino crítico de toda la API.** Cada `GET /api/pagos`
   pasaría a costar una llamada extra antes de empezar a trabajar.
2. **Convierte a `ms-identidad` en punto único de fallo.** Si no responde, no hay forma
   de autorizar nada, en ningún servicio. Es justo lo que el Capítulo 2 evita al decidir
   que la firma del JWT se verifica en local: sin esa decisión, MS-Identidad sería un
   cuello de botella para toda petición autenticada del sistema.

El propio documento anticipa la solución: *«para que la consulta no pese en cada
petición, el gateway mantiene una copia en memoria de los `jti` vigentes y la refresca
periódicamente»*. Lo que no fija es cada cuánto, ni qué hacer cuando el refresco falla.
Eso es lo que se decide aquí.

## Decisión

### Copia en memoria, refrescada cada 15 segundos

`ms-identidad` expone `GET /interno/revocados` con los `jti` cuyo `expira_en` todavía no
ha pasado. El gateway la trae al arrancar y luego cada **15 segundos**, y reemplaza su
copia entera.

**Por qué reemplazo y no unión.** Al sustituir la lista completa, un `jti` que caduca
desaparece solo de la caché en cuanto el origen deja de listarlo. No hace falta barrido
ni control de expiración por entrada: la misma decisión que evita el barrido en la tabla
(`expira_en > NOW()`) evita también el de la caché.

**Por qué la lista no crece.** Sólo contiene los cierres de sesión de la última hora,
porque los tokens duran 3600 segundos y el origen filtra por vigencia. Para este
proyecto son unidades, no miles; traerla entera cada vez es más simple y más barato que
cualquier esquema incremental.

### 15 segundos: qué se compra y qué se paga

| | |
|---|---|
| **Ventana de inconsistencia** | Hasta 15 s entre el logout y su efecto en el gateway |
| **Coste** | 240 peticiones/hora a `ms-identidad`, con una respuesta de unos pocos cientos de bytes |
| **Alternativa a 60 s** | 4× menos tráfico, pero un token cerrado sigue sirviendo casi un minuto |
| **Alternativa a 2 s** | Ventana casi imperceptible, a cambio de 1.800 peticiones/hora para una lista que casi nunca cambia |

15 segundos es el punto donde la ventana deja de ser relevante para la amenaza que el
logout atiende —alguien que cierra sesión en un equipo compartido y se levanta— y el
tráfico sigue siendo despreciable. Un atacante que tuviera el token ya lo tendría antes
del logout; lo que se acorta es el margen en que puede usarlo sin que el sistema lo sepa.

Se configura con `REVOCADOS_INTERVALO_MS`, para poder bajarlo en una demostración sin
tocar código.

### Si `ms-identidad` no responde, se conserva la última copia buena

Es la decisión de fondo de este ADR, y no es obvia.

**Se descarta fallar cerrado** (rechazar todo mientras no se pueda comprobar). Convierte
un hipo de la red o un reinicio de `ms-identidad` en una caída total de la plataforma:
nadie puede ver un contrato ni registrar un pago porque no se pudo confirmar que su
token *no* estaba revocado. El remedio sería peor que la enfermedad.

**Se descarta vaciar la caché** ante el fallo. Sería lo contrario: dar por bueno todo
token cerrado durante el incidente, y encima de forma silenciosa.

**Se conserva la última copia buena**, se registra el fallo en el log con la marca de
tiempo del último refresco correcto, y el estado queda expuesto en `estado()` para el log
de arranque y para depurar.

El riesgo que se acepta está acotado y se puede enunciar con precisión: durante una caída
de `ms-identidad`, un token cerrado **después** del último refresco correcto sigue
sirviendo, como mucho hasta que expire por su cuenta (una hora). No afecta a los ya
revocados antes del incidente, que siguen en la copia.

## Consecuencias

**A favor**

- El camino crítico de la API no gana ningún salto de red.
- Una caída de `ms-identidad` degrada el sistema en lugar de tumbarlo: los tokens ya
  emitidos siguen funcionando, y lo único que se pierde es la propagación de los cierres
  de sesión nuevos.
- La comprobación pasa a ser una consulta a un `Set` en memoria: más rápida incluso que
  el `SELECT` local que había antes.

**En contra**

- Un logout tarda hasta 15 s en surtir efecto. La SPA no lo nota, porque olvida el token
  al instante; lo notaría alguien que hubiera copiado el token y lo usara fuera del
  navegador, que es exactamente el escenario contra el que 15 s es un margen aceptable.
- Con varias réplicas del gateway, cada una tiene su propia copia y su propia ventana. No
  se agrava: siguen siendo 15 s como máximo, sólo que cada réplica se entera por su
  cuenta.
- La caché vive en memoria del proceso: un reinicio la vacía. Se vuelve a cargar antes de
  aceptar la primera petición, porque `iniciar()` hace una carga inmediata y no espera al
  primer intervalo.

## Alternativas descartadas

**Consulta HTTP por petición.** Descartada por lo dicho en el contexto: latencia en todo
el camino crítico y punto único de fallo.

**Que el gateway observe los logout que reenvía.** Como el cierre de sesión pasa por la
costura, el gateway podría añadir ese `jti` a su copia al instante y reducir la ventana a
cero para los logout propios. Es atractivo y barato, pero deja el caso a medias —los
logout de otras réplicas siguen tardando 15 s— y añade acoplamiento entre la costura de
enrutamiento y la semántica de autenticación, que hasta ahora están separadas. Queda
anotado como mejora posible; no cambia nada de lo que este ADR decide.

**Notificación activa de `ms-identidad` al gateway** (webhook o bus). Reduce la ventana a
casi cero y elimina el sondeo, pero exige que el bus exista —es el paso 5— y que
`ms-identidad` conozca a sus consumidores, que es justo la dependencia que la coreografía
evita. Reconsiderable cuando haya bus.

**Tokens de vida más corta con refresco.** Ataca el problema por la raíz: si un token
dura dos minutos, la revocación casi sobra. Descartada porque exige un mecanismo de
refresco que hoy no existe y que el Capítulo 2 no contempla, y porque con el token en
memoria de la SPA obligaría a rehacer el manejo de sesión entero.

## Verificación

`apps/gateway/tests/cacheRevocados.test.js` cubre el reemplazo completo, la conservación
de la copia buena ante un fallo, que el error no se propague, que `iniciar()` cargue de
inmediato y que el temporizador no impida terminar el proceso.

La ventana real se comprueba de punta a punta en `tests/integracion/`, donde tras un
logout se espera al refresco y se confirma que el token deja de servir.

## Anotaciones posteriores (2026-09-14)

- **Ya no es una caché, son cuatro:** la del gateway y la de cada servicio que
  verifica tokens de usuario, las cuatro con el mismo intervalo de 15 s, así que la
  ventana observable es la misma en todas. `ms-notificaciones` no tiene: nunca le
  llega un token de usuario.
- **Trampa de configuración.** `REVOCADOS_INTERVALO_MS=` vacía en un `.env` llega
  como cadena vacía; `Number('')` es `0` y el refresco se convierte en un bucle. Los
  servicios caen al valor por defecto con `||`, no con `??`, justamente por eso.
  La misma trampa con `EMAIL_USER=` mantuvo roto el correo de desarrollo; ver la
  anotación de `docs/adr/0019`.
