# Arriendos360 — Identidad de marca

Referencia de implementación. Los valores de esta página son los vigentes.



```css
:root {
  /* Marca */
  --indigo-profundo: #3D3480;   /* sidebar, paneles oscuros, panel del login */
  --indigo-medio:    #5B52A3;   /* botones primarios, links, iconos activos, cifras KPI */
  --indigo-hover:    #4A4289;   /* hover del boton primario */
  --lavanda:         #F4F3FC;   /* fondo general de la aplicacion */
  --chip-pastel:     #E8E5F9;   /* fondos de iconos en tarjetas KPI */
  --superficie:      #FFFFFF;   /* tarjetas, tablas, contenedor de la app */
  --borde:           #EDEBF7;   /* separadores */

  /* Texto */
  --texto:           #241F4D;   /* titulos y texto de alto contraste */
  --texto-suave:     #6B6580;   /* descripciones, metadatos */
  --texto-label:     #6F6690;   /* labels de formulario y KPI */

  /* Semanticos — SOLO estados de pago y contrato.
     Saturado = relleno (puntos, barras). -texto = texto y cifras. -tenue = fondo de badge.
     Los saturados NO cumplen AA como color de texto: no usarlos para eso. */
  --verde:       #10B981;   --verde-texto: #047857;   --verde-tenue: #E6F7F1;
  --ambar:       #F59E0B;   --ambar-texto: #B45309;   --ambar-tenue: #FEF3E2;
  --rojo:        #EF4444;   --rojo-texto:  #B91C1C;   --rojo-tenue:  #FDECEC;

  /* Geometria */
  --radio-app:     24px;   /* contenedor de la app */
  --radio-tarjeta: 14px;
  --radio-control: 10px;   /* botones, inputs */
  --radio-chip:     8px;
}
```

## Regla semántica

Verde, ámbar y rojo **solo** para estados de pago y contrato. No para badges de rol,
iconos decorativos, ingresos totales ni conteos de inmuebles.

Todo color semántico pasa por el componente `Badge`. Fuera de `components/ui/` no debe
aparecer ningún hex semántico:

```bash
grep -rn "#10B981\|#F59E0B\|#EF4444" apps/web/src --exclude-dir=ui   # debe dar cero
```

| Estado | Tokens |
|---|---|
| `pagado`, `activo` | `--verde-tenue` + `--verde-texto` |
| `pendiente`, `parcial` | `--ambar-tenue` + `--ambar-texto` |
| `mora` | `--rojo-tenue` + `--rojo-texto` |
| `finalizado` | `--borde` + `--texto-suave` |

## Tipografía

Inter. **Peso máximo 500** en toda la aplicación.

| Elemento | Tamaño | Peso | Color |
|---|---|---|---|
| H1 | 22–24px | 500 | `--texto` |
| H2 | 18–20px | 500 | `--texto` |
| Cuerpo | 13–14px | 400 | `--texto` / `--texto-suave` |
| Labels y cabeceras de tabla | 11–12px, mayúsculas, `letter-spacing: 0.45px` | 500 | `--texto-label` |
| Cifras KPI | 20–22px | 500 | `--indigo-medio` o `--texto` |

## Componentes

| | |
|---|---|
| **Sombras y degradados** | Ninguno. Sin `box-shadow`, sin `linear-gradient`, sin `transform` en hover. |
| **Botón primario** | Fondo `--indigo-medio`, texto blanco, `--radio-control`, hover `--indigo-hover` |
| **Badge** | Fondo `-tenue` + texto `-texto`. Nunca texto negro sobre color. |
| **Sidebar** | Fondo sólido `--indigo-profundo`; ítem activo con fondo sólido `--indigo-medio` y `--radio-control`; texto inactivo en lavanda clara |
| **Contenedor app** | `--radio-app` con margen sobre fondo `--lavanda`: tarjeta flotante |
| **Inputs** | `--radio-control`, borde `--borde`, foco `--indigo-medio` |
| **Logo** | Icono en cuadrado de radio 9px + "Arriendos360" peso 500. Claro: icono `--indigo-medio` sobre blanco, texto `--texto`. Oscuro: icono blanco sobre fondo semitransparente. Nunca sobre color semántico. |

```bash
grep -rn "box-shadow\|linear-gradient" apps/web/src   # debe dar cero
```
