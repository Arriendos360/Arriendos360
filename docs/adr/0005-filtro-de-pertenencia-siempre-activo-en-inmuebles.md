# ADR 0005 — El filtro de pertenencia de Inmuebles se aplica siempre

- Estado: Aceptada
- Fecha: 2026-09-06
- Paso de la migración: 3a (modelo de identidad y capa de autenticación)

> **Cambio de comportamiento observable** respecto de la línea base. No es una
> refactorización: hay respuestas que antes tenían contenido y ahora vienen vacías. Ver
> "Impacto observable".

## Contexto

### Comportamiento anterior

`GET /api/inmuebles` y `GET /api/inmuebles/:id` filtraban por propietario **solo si el
rol del token era `propietario`**:

```js
const { rol, id_perfil } = req.usuario;
let whereClause = {};

// Si es propietario, solo ve sus propios inmuebles
if (rol === 'propietario') {
    whereClause.id_propietario = id_perfil;
}

const inmuebles = await Inmueble.findAll({ where: whereClause, ... });
```

El comentario describe la intención correcta. El código no la implementa: describe lo
que pasa en la rama `if` y guarda silencio sobre el `else`, que es donde está el
problema. Sin rama `else`, `whereClause` se queda en `{}` y la consulta devuelve **la
tabla entera**.

Las dos rutas están montadas solo con `verificarToken`, sin `esPropietario`:

```js
router.get('/',    verificarToken, obtenerTodos);
router.get('/:id', verificarToken, obtenerPorId);
```

Esto no es un descuido de las rutas: son deliberadamente accesibles a cualquier
autenticado, porque un inquilino necesita poder ver el inmueble de *su* contrato.

### Por qué era un agujero

Cualquier usuario autenticado que no fuera propietario —en la práctica, **todo
inquilino**— recibía el listado completo de inmuebles de la plataforma: dirección,
barrio, municipio, estrato, número de habitaciones y el identificador de su dueño. Con
`GET /api/inmuebles/:id` podía además pedir cualquiera de ellos uno por uno.

Tres cosas lo agravan:

1. **Se llega con credenciales legítimas.** No hay que romper nada: basta registrarse.
   Antes del paso 3a el registro público aceptaba `rol` en el cuerpo, así que cualquiera
   podía darse de alta como inquilino y consultar el inventario completo.
2. **Son datos personales de terceros.** Direcciones de vivienda asociadas a un
   propietario identificable. En Colombia eso cae bajo la Ley 1581 de 2012.
3. **Contradice una regla dura del proyecto.** La regla 8 exige validación ABAC en el
   controlador: *"no basta el rol. Antes de ejecutar la lógica hay que confirmar la
   pertenencia del recurso"*. Aquí la pertenencia solo se confirmaba para quien ya tenía
   el rol correcto, que es precisamente al revés.

El paso 3a fuerza la decisión por dos vías. Primero, `rol` singular desaparece de los
claims: hay que reescribir la condición de todas formas, y traducirla literalmente a
`roles.includes('PROPIETARIO')` sería replicar el defecto a conciencia. Segundo, este
es el PR del módulo de seguridad; dejar en pie una fuga de datos mientras se endurece el
manejo del token sería incoherente.

## Decisión

El filtro por `id_propietario` se aplica **siempre**, sin ramificar por rol:

```js
const { sub } = req.usuario;

const inmuebles = await Inmueble.findAll({
    where: { id_propietario: sub },
    include: conPropietario
});
```

Un inmueble lo ve su dueño. Punto.

La autorización deja de leerse del rol declarado y pasa a leerse de la **pertenencia
real del recurso**, que es lo que la regla dura 8 pide y lo que hace que el resultado
sea correcto también para un usuario con los dos roles: si es propietario de algo, ahí
está; si no lo es, no ve nada, tenga el rol que tenga.

Las rutas se dejan como estaban, con `verificarToken` y sin `esPropietario`. Añadir
`esPropietario` habría devuelto `403` en vez de una lista vacía, lo cual es defendible,
pero cerraría la puerta a que un inquilino consulte el inmueble de su contrato — un
caso que la UI todavía no usa pero que el modelo contempla. La lista vacía es la
respuesta honesta: la ruta existe y estás autorizado a llamarla; simplemente no eres
dueño de nada.

Queda cubierto por una prueba en `apps/gateway/tests/security.test.js`
(*"Un inquilino no ve los inmuebles de nadie en el listado"*), para que la regresión no
vuelva en silencio.

## Impacto observable

Frente a la línea base:

| Petición | Antes | Ahora |
|---|---|---|
| `GET /api/inmuebles` con token de inquilino | `200` con **todos** los inmuebles | `200` con `[]` |
| `GET /api/inmuebles/:id` con token de inquilino | `200` con cualquier inmueble | `404` "no tienes permisos para verlo" |
| `GET /api/inmuebles` con token de propietario | `200` con los suyos | Igual |
| `GET /api/inmuebles/:id` con token de propietario | Igual | Igual |

Para un propietario **no cambia nada**. El cambio afecta únicamente a peticiones que
antes devolvían datos ajenos.

Nada del frontend depende del comportamiento anterior: `Inmuebles.js` es una pantalla de
propietario, y el guardián de ruta ahora exige el rol PROPIETARIO para llegar a ella. El
único consumidor que notaría la diferencia es una petición hecha a mano con un token de
inquilino, que es exactamente el caso que se quería cerrar.

> **Actualización (2026-09-06).** Con la matriz RBAC del gateway, un inquilino ya no
> llega al controlador de Inmuebles: `todo /api/inmuebles` está declarado como
> PROPIETARIO, así que la respuesta pasó de `200` con lista vacía a `403`. Las dos
> filas de la tabla que hablan del token de inquilino quedan superadas por ese motivo.
>
> El filtro que decide este ADR **no** queda obsoleto: es el segundo nivel de la regla
> dura 8 y es el que separa a un propietario de otro, cosa que la matriz no puede hacer
> porque el rol de los dos es el mismo. Los dos niveles conviven y ninguno reemplaza al
> otro; hay una prueba por cada uno en `security.test.js`.

## Alternativas descartadas

**Preservar el comportamiento y anotarlo como deuda.** Habría mantenido la línea base
intacta, que es el criterio que rige los pasos 1 y 2. Se descartó porque el defecto es
una fuga de datos personales, no una diferencia de forma: posponerlo tiene un costo
que crece con cada demo, y el paso 3a ya obligaba a reescribir esa condición.

**Añadir `esPropietario` a las dos rutas.** Más simple de leer y devuelve `403`, que
comunica mejor. Se descartó porque cierra el caso legítimo del inquilino consultando el
inmueble de su contrato, y porque volvería a poner la decisión en el rol en vez de en la
pertenencia — el mismo error de fondo, con mejor puntería.

**Una disyunción como en Contratos** (dueño del inmueble **o** inquilino de un contrato
sobre ese inmueble). Es lo correcto a futuro y es lo que se hizo en
`contrato.controller.js` y `pago.controller.js`, donde el caso ya existe. Aquí exigiría
que Inmuebles consultara Contratos, que es cruzar un bounded context justo en el
agregado que el paso 4 va a extraer primero. Se deja para cuando exista `ms-inmuebles` y
la composición se resuelva en el gateway.

## Consecuencias

**A favor**

- Se cierra una fuga de datos personales alcanzable con credenciales legítimas.
- La regla dura 8 se cumple en Inmuebles: pertenencia comprobada en el controlador,
  explícitamente y no como efecto colateral de un filtro.
- La condición deja de depender del rol, así que el usuario de doble rol funciona sin
  casos especiales.

**En contra**

- Es una divergencia observable frente a la línea base, en un proyecto cuya regla ha
  sido preservarla paso a paso. Por eso este ADR.
- Un inquilino no puede consultar por API el inmueble de su contrato. Hoy no lo
  necesita: `GET /api/contratos` ya devuelve el inmueble embebido. Si el paso 4 lo
  requiere, se resuelve con la disyunción descrita arriba.

## Nota

`obtenerPorId` tenía el mismo defecto por la misma causa y se corrigió igual, aunque el
título del ADR nombre el listado. El resto de operaciones sobre inmuebles (`POST`,
`PUT`, `DELETE`) ya filtraban por propietario en todos los caminos y no cambian; lo
único que se les añadió es que `PUT` deja de aceptar `id_propietario` desde el cuerpo,
para que actualizar un inmueble no pueda usarse para cedérselo a otro usuario.
