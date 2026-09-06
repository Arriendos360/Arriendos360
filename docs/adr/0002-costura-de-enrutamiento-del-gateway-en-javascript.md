# ADR 0002 — La costura de enrutamiento del gateway se escribe en JavaScript

- Estado: Aceptada
- Fecha: 2026-09-06
- Paso de la migración: 2 (gateway y paquetes compartidos)

## Contexto

`CLAUDE.md`, sección "TypeScript incremental", dice: **"Todo código nuevo en `.ts`,
con `import`/`export`, no `require`"**. La regla viene del SRS, que especifica
TypeScript.

El paso 2 introduce código nuevo en dos sitios muy distintos:

1. `packages/contracts` y `packages/shared` — paquetes nuevos, sin historia, sin
   consumidores todavía.
2. `apps/gateway/src/routing/` — la costura de enrutamiento, que se monta dentro del
   monolito que hoy está en producción de la demo.

`apps/gateway` es CommonJS puro, sin paso de compilación. El `Dockerfile` ejecuta
`nodemon src/app.js` sobre el código fuente montado como volumen, y `jest` corre
directamente sobre los `.js` sin transformación.

## Decisión

**Los dos paquetes van 100% en TypeScript con `strict: true`.** Sin excepciones: son
código nuevo y aislado, y `packages/contracts` es TypeScript desde el primer día por
mandato explícito del documento.

**La costura del gateway (`apps/gateway/src/routing/`) va en JavaScript CommonJS**,
consistente con el resto de `apps/gateway`.

## Justificación

Escribir la costura en `.ts` obligaría, en este mismo paso, a:

- añadir `tsc` al `Dockerfile` del gateway y un `outDir`, cambiando lo que ejecuta el
  contenedor;
- reemplazar `nodemon src/app.js` por un watch de compilación, alterando el loop de
  desarrollo;
- añadir `ts-jest` o `babel-jest` a las 6 suites existentes, que hoy corren sin
  transformación;
- mezclar `require` y `import` dentro del mismo proceso, o convertir los ~30 archivos
  `.js` del monolito de golpe.

Eso es exactamente la "refactorización grande que lo deja roto una semana" que
`CLAUDE.md` manda evitar en favor del cambio incremental, y contradice el requisito de
este paso: **el comportamiento observable debe quedar idéntico**. El costo cae además
sobre un equipo de 2 personas con dedicación parcial y timebox de 16 semanas.

La regla del propio documento que resuelve el conflicto ya existe: *"Un `.js` se
convierte a `.ts` solo cuando ya lo estás modificando por otra razón. Nunca como tarea
aparte."* Migrar el gateway a TypeScript es precisamente una tarea aparte.

## Consecuencias

- La deuda queda acotada y localizada: `apps/gateway/src/routing/` (3 archivos, ~200
  líneas) es lo único nuevo que no es TypeScript.
- El momento natural para saldarla es el paso 2 de la migración cuando el gateway deje
  de ser el monolito y pase a ser solo BFF: ahí se toca el `Dockerfile` de todos modos y
  la conversión sale casi gratis.
- Mientras tanto, la costura documenta sus tipos con JSDoc, de modo que el editor da
  ayuda de tipos aunque no haya compilador.
- `packages/shared` sí ofrece ya, en TypeScript, la verificación local del JWT que el
  gateway consumirá cuando se convierta. No hay lógica duplicada por decisión: hay una
  implementación heredada (`auth.middleware.js`) y una nueva que la replica y la
  reemplazará.

## Alternativas descartadas

**Compilar todo el gateway a TypeScript ahora.** Descartada por el impacto en
`Dockerfile`, jest y el loop de desarrollo, con cero beneficio observable en este paso.

**Escribir la costura en `.ts` y compilarla a un `dist/` que el `.js` requiera.**
Añade un artefacto compilado dentro de un árbol sin compilar; confunde más de lo que
aporta y sigue obligando a tocar el `Dockerfile`.
