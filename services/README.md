# services/

Los microservicios, a medida que se van extrayendo del monolito (`apps/gateway`).

| Servicio | Puerto | Esquema | Estado |
|---|---|---|---|
| `ms-identidad` | 3011 | `identidad` | **Extraido y cableado.** El gateway le reenvia `/api/auth` y `/api/usuarios`. |
| `ms-inmuebles` | 3012 | `inmuebles` | **Extraido, sin cablear.** Levanta y sirve, pero `MS_INMUEBLES_URL` esta vacia y el gateway resuelve `/api/inmuebles` en local. |
| `ms-contratos` | 3013 | — | Paso 6 |
| `ms-financiero` | 3014 | — | Paso 6 |
| `ms-notificaciones` | 3015 | — | Paso 7 |

Cada servicio es su propio workspace (`services/*` en el `package.json` raiz) con su
`package.json`, `Dockerfile`, `tsconfig.json` y `tests/`. TypeScript con `strict: true`.

## Lo que todos tienen en comun

- **Verifican el token por su cuenta** (regla dura 7), con `packages/shared`. No confian
  en que el gateway ya lo hizo.
- **Comprueban la revocacion**, no solo la firma. `ms-identidad` consulta su propia
  tabla; los demas leen la copia en memoria que refrescan contra
  `/interno/revocados` cada 15 s (`docs/adr/0008`).
- **Validan la pertenencia en el controlador** (ABAC, regla dura 8). El rol dice que
  puedes tener inmuebles; no que este sea tuyo.
- **`/interno` exige credencial de servicio**, montada con `router.use` para que un
  endpoint nuevo nazca protegido (`docs/adr/0009`).
- **Son duenos exclusivos de su esquema** (regla dura 3), con el `search_path` fijado en
  la conexion para que ninguna consulta alcance `public` por descuido.

## Como se prueban

Contra dobles HTTP, no contra el stack levantado. Ver "Como se prueba" en `CLAUDE.md`.

```bash
npm test --workspace=services/ms-inmuebles
```

Necesitan PostgreSQL en pie y la base `arriendos360_test`, que **Compose no crea**: si
hiciste `down -v`, hay que recrearla a mano.
