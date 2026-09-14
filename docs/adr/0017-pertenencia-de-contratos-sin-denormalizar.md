# ADR 0017 — La pertenencia de un contrato se resuelve en ms-contratos, sin denormalizar `id_propietario`

- **Estado:** aceptada
- **Fecha:** 2026-09-08
- **Paso:** 6d (extracción de ms-contratos)
- **Se aparta del Capítulo 2:** no. Resuelve una decisión abierta que el propio
  código dejó anotada, y en sentido contrario a lo que ahí se recomendaba.

## Contexto

«¿Este contrato es de este propietario?» es la pregunta que gobierna casi todo el
control de acceso del sistema: quién ve un contrato, quién puede finalizarlo,
quién descarga sus anexos, quién emite un cobro contra él, quién reemite la
contraseña temporal de su inquilino, y si un inmueble se puede borrar.

Hasta el paso 6d se contestaba **cuatro veces**, en cuatro sitios del gateway,
con cuatro formas distintas y ninguna igual a otra:

| Dónde | Cómo |
|---|---|
| `contrato.controller.js` → `contratoPropio()` | `findByPk` + `propioDe(id_inmueble, sub)` |
| `anexo.controller.js` → `contratoAccesible()` | la disyunción completa, con el orden invertido para ahorrar una llamada |
| `contrato.controller.js` → `visiblePara()` | un `Op.or` dentro de un `where` |
| `routing/guardias.js` | `Contrato.count()` — la misma pregunta del revés |

Cuatro copias que tenían que coincidir y que nada obligaba a coincidir.

Al extraer el servicio la pregunta se parte físicamente en dos: `id_inquilino` es
columna de `contratos`, pero `id_propietario` es de `inmuebles`, en otro esquema
y en otro proceso. La cabecera de `anexo.controller.js` anticipaba el problema y
dejaba escrita una recomendación:

> **La salida recomendada es denormalizar `id_propietario` en `Contratos`**, que
> se conoce en el momento de firmar y sale del `sub` del token (regla dura 4).
> Con eso los dos caminos del ABAC quedan locales y la descarga deja de tener
> saltos de red. El precio es una copia que puede quedarse vieja si un inmueble
> cambia de dueño; se acepta porque un contrato es un documento entre las partes
> que lo firmaron, así que la copia describe mejor el hecho jurídico que una
> consulta al dueño de hoy.

## Decisión

**No se denormaliza.** `contratos` no tiene `id_propietario`. La pertenencia la
resuelve ms-contratos preguntando a ms-inmuebles de quién es el inmueble, cada
vez, y esa lógica vive **en un solo módulo**: `services/pertenencia.ts`.

Ese módulo expone las cuatro formas de la pregunta y las cuatro se apoyan en la
misma consulta:

- `contratosDondeEsParte(sub)` — la disyunción completa: dueño **o** inquilino.
- `contratosDePropietario(sub)` — sólo la mitad de propietario.
- `contratoPropio(id, sub)` / `contratoDondeEsParte(id, sub)` — el caso puntual.
- `contratosActivosDeInmueble(id)` — la pregunta del guardia de borrado.

Y se expone hacia fuera por `GET /interno/contratos`, con credencial de servicio,
para que el gateway pueda filtrar cuentas de cobro y vetar borrados sin tener que
saber nada de inmuebles.

## Por qué se rechazó la denormalización

**El argumento del hecho jurídico no se sostiene para una decisión de acceso.**
Es cierto que un contrato lo firmaron dos partes concretas y que eso no cambia
cuando el inmueble se vende. Pero de este dato no cuelga el *relato* del
contrato: cuelga **quién puede leerlo y modificarlo hoy**. Y para eso la pregunta
correcta no es «quién era el dueño cuando se firmó» sino «quién es el dueño
ahora». Un propietario que vende su inmueble deja de tener derecho sobre el
arriendo; el comprador lo gana.

**El fallo sería mudo.** Con la copia, el vendedor seguiría descargándose los
contratos y los anexos de un inmueble que ya no es suyo, y el comprador
recibiría un 404 sobre lo que sí lo es. Ninguna de las dos cosas produce un
error, un log ni una alarma: producen respuestas creíbles y equivocadas. Es
exactamente la clase de defecto que este proyecto ha ido persiguiendo —el
`actualizado_por` congelado, el `?token=` que no protegía nada— y meterlo a
propósito en la ruta de autorización sería el peor sitio posible.

**El ahorro es menor de lo que parece.** La denormalización se justificaba por la
descarga de anexos, que es el caso puntual. Pero:

- El camino del **inquilino** ya es local sin denormalizar nada: `id_inquilino`
  está en la misma fila, y se comprueba **primero**. Un inquilino descarga su
  contrato sin ningún salto de red, y sigue pudiendo hacerlo aunque ms-inmuebles
  esté caído.
- El camino del **propietario** cuesta una petición a un servicio que está en la
  misma red, ya consultado en la misma operación en la mayoría de los flujos.
- Los **listados** —que son el volumen real— necesitan la lista de inmuebles del
  propietario de todos modos, así que la copia no ahorraría nada ahí.

**Y hay una alternativa peor que ninguna de las dos**: dejar que el gateway pida
las dos piezas y las cruce él. Sería una quinta copia de la regla, dos saltos de
red donde cabe uno, y volvería a poner en el gateway el conocimiento de qué es un
contrato justo después de habérselo quitado.

## Consecuencias

- **La dirección de las dependencias es la correcta y conviene dejarlo dicho.**
  Contratos es subdominio **Core**, Inmuebles es **Soporte**: Core dependiendo de
  Soporte es lo natural. Lo que no vale es lo contrario, y por eso ms-inmuebles
  sigue sin saber que existen los contratos —deduce el estado de ocupación de un
  evento— y por eso el guardia de borrado sigue viviendo en el gateway.

- **Un fallo de ms-inmuebles se propaga y sale como 502.** Nunca como 403 ni como
  lista vacía. Decirle a alguien «no tienes permisos» cuando no se ha podido
  comprobar es la peor de las tres respuestas, y una lista vacía le diría a un
  propietario «no tienes contratos», que es creíble y falso.

- **La única excepción es el inquilino**, cuya mitad es local. Se comprueba
  primero a propósito: además de ahorrar una petición, hace que un inquilino
  pueda seguir bajándose su contrato firmado con Inmuebles caído. La disyunción
  se evalúa en el orden en que se puede.

- **Se prueba, y la prueba es explícita.** `tests/pertenencia.test.ts` cambia el
  dueño de un inmueble en ms-inmuebles sin tocar la tabla de contratos, y
  comprueba que en la petición siguiente el comprador ve el contrato y el
  vendedor deja de verlo. Con la copia, esa prueba fallaría — y es la que impide
  que alguien introduzca la denormalización más adelante «para ahorrar una
  llamada».

- **El doble de ms-contratos también resuelve la pertenencia preguntando**, no
  guardándola. Si el doble usara una regla propia, las suites del gateway
  pasarían en verde contra un comportamiento que el servicio real no tiene.

- **Si algún día el coste importa**, la salida no es denormalizar: es cachear la
  respuesta de ms-inmuebles con una ventana corta, igual que se hizo con la lista
  de revocados (`docs/adr/0008`). Eso acota el desfase a un número que se puede
  elegir y documentar, en vez de dejarlo indefinido.

## Lo que esto arrastra: la reemisión de la contraseña temporal

El `docs/adr/0010` puso `POST /api/contratos/:id/contrasena-inquilino` en el
gateway con este argumento: la regla es «sólo sobre inquilinos con contrato en
mis inmuebles», y ms-identidad no puede comprobarla sin depender de un servicio
de dominio e invertir la dirección de las dependencias.

**El argumento sigue siendo válido y la conclusión cambia**, porque cambió quién
tiene los datos. Los contratos son ahora de ms-contratos, y preguntar por el
inmueble es Core → Soporte. El endpoint se muda con ellos y usa el mismo
`contratoPropio()` que todo lo demás. El gateway ya no aportaba nada: sólo
reenviaba.

Ms-identidad sigue sin comprobar nada, que es lo que el ADR 0010 protegía. Lo
único que cambia es cuál de los dos servicios de dominio se lo pide.

## Relación con otras decisiones

- `docs/adr/0005` — el filtro de pertenencia de Inmuebles se aplica siempre.
- `docs/adr/0008` — la caché de revocados, que es el patrón a seguir si algún día
  hace falta cachear esto.
- `docs/adr/0010` — la reemisión de la contraseña temporal, cuyo emplazamiento
  este ADR corrige.

## Anotaciones posteriores (2026-09-14)

- **La forma del endpoint.** `GET /interno/contratos?parte=<sub>` devuelve la lista
  de identificadores de los contratos donde `sub` es parte, y quien pregunta la usa
  en un `IN` contra su base local. Un salto de red donde habría habido dos. Si algún
  día la lista pesa, la salida es paginar en `/interno`; hoy no.
  `?incluir=inmueble` adjunta el `Inmueble` de cada contrato en un solo lote: lo usa
  ms-financiero para los comprobantes y el motor, y existe para no encadenar dos
  saltos, porque hasta que Contratos no dice de qué inmueble es cada contrato nadie
  sabe qué inmuebles pedir.
- **Los clientes cambiaron en el paso 6e.** Donde este ADR dice que el gateway filtra
  cuentas de cobro, desde el 6e lo hace **ms-financiero** contra su propia base. El
  gateway sólo conserva la mitad de propietario, para vetar borrados y componer el
  dashboard.
- **Cerró la decisión abierta de los listados con doble rol.** La visibilidad es una
  disyunción —dueño del inmueble **o** inquilino del contrato— y hasta el 6d se
  resolvía con `Op.or` sobre columnas alcanzadas por `include`, es decir, JOINs que
  cruzaban contextos, en tres sitios: `contrato.controller.js`
  (`$Inmueble.id_propietario$`, Contratos → Inmuebles) y dos en `pago.controller.js`
  (`$Contrato.Inmueble.id_propietario$` para cuentas y
  `$CuentaCobro.Contrato.Inmueble.id_propietario$` para transacciones, Financiero →
  Contratos → Inmuebles).
- **El calendario subió a `packages/shared` en el mismo paso** (`fechas.ts`), porque
  al separarse Contratos y Financiero la alternativa era copiarlo. La justificación
  está en la cabecera del archivo.
