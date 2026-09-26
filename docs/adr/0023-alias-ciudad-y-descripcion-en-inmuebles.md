# ADR 0023 — `Inmuebles` gana `alias`, `ciudad` y `descripcion`

- **Estado:** aceptada
- **Fecha:** 2026-09-26
- **Se aparta del Capítulo 2:** no en estos tres atributos, que ahora coinciden con
  el documento. Sí por adición en `departamento`, `barrio` y la ficha física
  (`area_m2`, `habitaciones`, `banos`, `deposito`, `parqueaderos`, `estrato`), que
  se conservan. Pendiente de incorporar por el proceso de la sección 13.3.2 del PMP.

## Contexto

El modelo canónico define para `Inmuebles` los atributos `alias`, `direccion`,
`ciudad`, `tipo`, `descripcion` y `estado`. ms-inmuebles guardaba `departamento`,
`municipio`, `barrio`, `direccion`, `tipo`, la ficha física y `estado`: no tenía
`alias` ni `descripcion`, y la ciudad se llamaba `municipio`.

En la SPA cada inmueble se identificaba por su dirección completa, y a un
propietario le cuesta más reconocer «Calle 63 # 9-45 Apto 502» que «Apartamento de
Chapinero».

## Decisión

1. **`alias VARCHAR(100) NOT NULL`.** Es obligatorio al crear y no se puede vaciar
   al editar. La migración `database/inmuebles/004` asigna a cada inmueble existente
   su dirección como alias inicial. Las pantallas nombran cada inmueble por su alias
   y, si no lo trae, por su dirección (`nombreDeInmueble`).
2. **`municipio` se renombra a `ciudad`** con `RENAME COLUMN`, en la misma migración.
   El formulario conserva el selector departamento → ciudad.
3. **`descripcion TEXT`**, opcional.
4. Se conservan `departamento`, `barrio` y la ficha física: los usa el producto y los
   comprobantes imprimen «barrio, ciudad».
5. Los eventos y los correos siguen nombrando el inmueble por `direccion_inmueble`:
   al inquilino lo identifica la dirección, no el alias que eligió el propietario.

## Consecuencias

- **Durante el despliegue hay una ventana de fallo.** El Job aplica la migración
  antes de publicar la revisión nueva. Mientras la revisión anterior de ms-inmuebles
  siga atendiendo, fallará al leer o escribir, porque busca `municipio` y no manda
  `alias`. Se aceptó a cambio de no repartir el renombre en dos despliegues. Es una
  excepción a la regla de que toda migración sea compatible con la versión anterior
  del servicio.
- La migración no tiene vuelta atrás: revertir el código no devuelve `municipio`.
- Los inmuebles que ya existen muestran su dirección como alias hasta que el
  propietario lo edite.
