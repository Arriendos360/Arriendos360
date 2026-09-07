# ADR 0004 — `POST /api/usuarios/inquilinos` para el alta de inquilinos

- Estado: Aceptada
- Fecha: 2026-09-06
- Paso de la migración: 3a (modelo de identidad y capa de autenticación)

> **Desviación de la línea base.** Este endpoint **no aparece en el Capítulo 2**. Ver
> la sección "Estado frente a la línea base" al final: debe incorporarse al documento
> en su próxima revisión, por el proceso de la sección 13.3.2 del PMP.

## Contexto

### Un inquilino no es un recurso del modelo canónico

El modelo canónico del Capítulo 2 tiene ocho tablas de dominio. **`Inquilinos` no es
una de ellas**, y no por olvido: el propio documento manda eliminarla. El mapeo desde
el código actual lo dice explícitamente:

| Hoy en el código | Destino |
|---|---|
| `Usuario`, `Propietario`, `Inquilino` (3 tablas) | `Usuarios` + `Roles` + `RolesUsuario` |

Ser inquilino dejó de ser una entidad y pasó a ser **una fila en `RolesUsuario`**. La
consecuencia está escrita en CLAUDE.md sin ambigüedad: *"Las tablas `propietarios` e
`inquilinos` desaparecen. La distinción pasa a ser un rol en `RolesUsuario`. Un mismo
usuario puede ser ambas cosas."*

Eso descarta de raíz un recurso REST `/api/inquilinos`. La convención del proyecto es
`/api/{recurso}` en plural sobre recursos del dominio, y "inquilino" no es un recurso:
es un **rol que un usuario tiene**. Una ruta `/api/inquilinos` afirmaría, en la forma
misma de la API, exactamente lo que el modelo canónico acaba de negar. Peor aún, sería
una mentira con consecuencias: sugiere que existe una colección de inquilinos separada
de la de usuarios, y el caso que el nuevo modelo habilita —una persona que arrienda un
inmueble propio y vive en otro alquilado— dejaría de tener representación obvia.

Por eso el recurso es `usuarios` y el rol es un detalle del sub-recurso:
`POST /api/usuarios/inquilinos` se lee como *"crea, dentro de usuarios, uno con rol
INQUILINO"*.

### Por qué hace falta un endpoint aparte

El contrato de interfaz de `POST /api/auth/registro`, tal como lo fija el Capítulo 2,
no lleva campo `rol`:

```json
{ "nombres": "string", "apellidos": "string", "email": "string",
  "contrasena": "string", "telefono": "string", "documento": "string" }
```

y el documento añade: *"La asignación del rol en `RolesUsuario` se maneja
internamente."* Aceptar el rol desde el cuerpo de una ruta pública sería un agujero de
autorización: cualquiera podría darse de alta como inquilino sin contrato alguno. El
registro público, por tanto, crea **siempre PROPIETARIO** — que además es lo que la SPA
ya ofrecía, con el toggle rotulado *"Soy propietario"* y el comentario *"solo
propietarios se registran"*.

Pero **RF-02 exige registrar inquilinos desde la pantalla de Contratos**. Ese flujo es
real y está implementado: el propietario escribe la cédula del inquilino en el
formulario de contrato y, si esa persona no existe todavía, se abre un modal para darla
de alta antes de poder firmar. Si el registro público solo crea propietarios y no hay
otra vía, RF-02 queda sin implementación.

Hasta el paso 3a ese hueco no existía porque el registro aceptaba `rol` en el cuerpo:
el modal llamaba a `POST /api/auth/register` con `rol: 'inquilino'`. Cerrar ese agujero
es lo que obliga a abrir la puerta correcta en otro sitio.

## Decisión

Añadir **`POST /api/usuarios/inquilinos`**, bajo el prefijo `/api/usuarios`, con
`verificarToken` + `esPropietario`. Crea el usuario y le asigna el rol INQUILINO en
`RolesUsuario`, dentro de la misma transacción.

Dos consecuencias deliberadas:

- **No es público.** Dar de alta a otra persona es una operación de un propietario en
  curso de firmar un contrato, no un autoservicio.
- **La auditoría registra quién lo hizo.** `creado_por` lleva el `sub` del propietario,
  no el UUID del propio inquilino. Es lo contrario del autorregistro, donde el autor es
  el propio usuario creado, y la diferencia importa: en un alta hecha por un tercero,
  ese tercero es el responsable del dato.

El mismo prefijo aloja **`GET /api/usuarios/buscar?documento=`**, que traduce cédula a
UUID. Existe porque `Contratos.id_inquilino` pasó a guardar un UUID y nadie teclea un
UUID; el propietario sigue conociendo a su inquilino por la cédula. Devuelve solo
nombre, apellidos y documento: quien busca no es necesariamente alguien con derecho al
email o al teléfono de un tercero, y el nombre basta para confirmar que se encontró a la
persona correcta.

`/api/usuarios` se declara en la tabla de enrutamiento del gateway apuntando a
`ms-identidad` y compartiendo `MS_IDENTIDAD_URL` con `/api/auth`: los dos prefijos se
extraen juntos en el paso 3b.

## Alternativas descartadas

**Mantener `rol` en el cuerpo del registro público.** Es el diff más pequeño —las seis
suites casi no se tocan— pero contradice el contrato de interfaz del documento y deja
en pie el agujero: cualquiera se registra como inquilino sin contrato. Se descartó por
eso, no por estética.

**Un recurso `POST /api/inquilinos`.** Descartado por lo dicho arriba: consagra en la
API una entidad que el modelo canónico eliminó. Además añadiría un octavo prefijo a la
tabla de enrutamiento para algo que pertenece a `ms-identidad`, que ya tiene el suyo.

**Crear el inquilino dentro de `POST /api/contratos`.** Si la cédula no existe, el
propio endpoint de contratos crea el usuario y le asigna el rol en la misma
transacción. Menos endpoints y menos viajes de red, pero mete creación de usuarios en
el dominio de Contratos — justo lo que el paso 6 tendría que deshacer, porque
`ms-contratos` no puede escribir en el esquema de `ms-identidad` (regla dura 3). Se
descartó por no crear deuda a sabiendas.

**Un endpoint genérico `POST /api/usuarios` con el rol en el cuerpo.** Traslada el
problema en vez de resolverlo: habría que validar en el controlador qué roles puede
asignar quien llama, y el primer error de esa validación es una escalada de
privilegios. Con la ruta específica, el rol no es un dato de entrada: está en la URL y
lo fija el servidor.

## Consecuencias

**A favor**

- Ninguna ruta pública puede asignar un rol distinto de PROPIETARIO.
- RF-02 sigue implementado, y la trazabilidad del alta queda en las columnas de
  auditoría.
- Al extraer `ms-identidad`, las cuatro rutas de identidad (`registro`, `login`,
  `logout`, más las dos de `/api/usuarios`) se van juntas y con una sola variable de
  entorno.

**En contra**

- El flujo de contrato pasa de una llamada a dos: buscar por documento y, si no existe,
  dar de alta. Es un viaje de red más en un flujo que ocurre pocas veces al mes.
- Hay dos formas de crear un usuario en el sistema. Comparten `crearUsuarioConRol()`,
  así que la lógica no está duplicada, pero sí las dos rutas.

**Sin resolver**

No hay forma de **añadir** un rol a un usuario que ya existe. El seed crea al usuario de
doble rol insertando directamente en `RolesUsuario`, y las pruebas hacen lo mismo. En
producción, un inquilino que compre un inmueble no puede convertirse en propietario sin
tocar la base a mano. No se inventó el endpoint aquí porque nadie lo necesita todavía;
es candidato natural del paso 3b, junto con la matriz RBAC.

## Estado frente a la línea base

Este endpoint **no está en el Capítulo 2**. El documento fija el contrato de
`POST /api/auth/registro` y dice que el rol se asigna internamente, pero **no describe
por qué vía se da de alta a un inquilino**, pese a que RF-02 lo exige desde la pantalla
de Contratos. Es un vacío del documento, no una contradicción con él: nada de lo que
aquí se decide se opone a lo escrito.

Aun así, es una desviación de la línea base y se registra como tal:

- **Debe incorporarse al Capítulo 2 en su próxima revisión**, en la sección "Contratos
  de interfaz" de MS-Identidad, junto a `registro`, `login` y `logout`.
- El cambio pasa por el **proceso formal de control de configuración de la sección
  13.3.2 del PMP**. Este ADR es el insumo de esa solicitud, no su sustituto.
- Hasta que eso ocurra, la autoridad sigue siendo el documento: si la revisión resuelve
  otra vía para RF-02, manda esa y este ADR queda como decisión superada.

Lo mismo aplica a `GET /api/usuarios/buscar?documento=`, que tampoco figura en el
documento y que es consecuencia directa de una decisión que sí está en él: el paso a
UUID.
