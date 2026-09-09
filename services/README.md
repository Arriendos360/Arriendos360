# services/

Los microservicios extraidos del monolito (`apps/gateway`).

| Servicio | Puerto | Esquema | Estado |
|---|---|---|---|
| `ms-identidad` | 3011 | `identidad` | **Extraido y cableado.** Sirve `/api/auth` y `/api/usuarios`. |
| `ms-inmuebles` | 3012 | `inmuebles` | **Extraido y cableado.** Sirve `/api/inmuebles`. Consume `ContratoFormalizado` y `ContratoFinalizado`. |
| `ms-contratos` | 3013 | `contratos` | **Extraido y cableado.** Sirve `/api/contratos` y sus anexos. **Productor del bus.** |
| `ms-financiero` | 3014 | `financiero` | **Extraido y cableado.** Sirve `/api/pagos`, los comprobantes y el motor. Consume `ContratoFormalizado`. |
| `ms-notificaciones` | 3015 | ninguno | Paso 7 |

Con el paso 6e **el gateway se quedo sin tablas propias**, que es lo que el Capitulo 2
dice que tiene que ser: los cinco prefijos de la API los sirven los servicios y lo unico
que queda en el gateway es `/api/dashboard`, que agrega sus respuestas y no persiste
nada (regla dura 5).

Cada servicio es su propio workspace (`services/*` en el `package.json` raiz) con su
`package.json`, `Dockerfile`, `tsconfig.json` y `tests/`. TypeScript con `strict: true`.
La unica excepcion es `ms-financiero/src/services/pdfService.js`, que se mudo intacto
desde el gateway para que los comprobantes imprimieran exactamente lo mismo; ver
`docs/adr/0018`.

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
- **Aplican sus propias migraciones al arrancar**, y solo las suyas. El healthcheck de
  Compose responde despues, asi que «sano» significa «ya migre».

## El bus, en una tabla

| Evento | Emisor | Consumidores |
|---|---|---|
| `ContratoFormalizado` | `ms-contratos` | `ms-inmuebles` (pone `arrendado`) y `ms-financiero` (crea la primera cuenta de cobro) |
| `ContratoFinalizado` | `ms-contratos` | `ms-inmuebles` (pone `disponible`) |

`ContratoFormalizado` tiene **dos** consumidores desde el paso 6e, que es el caso para
el que se diseno el bus. Consecuencia a tener presente: la fila de la tabla de salida se
marca entregada cuando aceptan los DOS, asi que un fallo de uno hace que el otro reciba
el evento otra vez. Por eso cada consumidor lleva su tabla `eventos_procesados` y
descarta repetidos por `id_evento`.

## Como se prueban

Contra dobles HTTP, no contra el stack levantado. Ver "Como se prueba" en `CLAUDE.md`.

```bash
npm test --workspace=services/ms-financiero
npm test --workspaces --if-present      # todas
```

Necesitan PostgreSQL en pie y la base `arriendos360_test`, que **Compose no crea**: si
hiciste `down -v`, hay que recrearla a mano. Las suites del gateway ya NO la necesitan
desde el paso 6e — no tiene base.
