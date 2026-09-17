# Desplegar Arriendos360 en Azure

Guía práctica. El **porqué** de cada decisión está en `docs/adr/0022`; el plan por cortes y el
estado, en CLAUDE.md. Aquí sólo está el **cómo**.

## Lo que hay desplegado

Todo vive en el grupo `rg-arriendos360` (`mexicocentral`), salvo la SPA, que es global con
metadatos en `eastus2`.

| Pieza | Qué es |
|---|---|
| `gateway` | Container App con ingreso público por HTTPS. Es la única puerta a la API. |
| `ms-identidad`, `ms-inmuebles`, `ms-contratos`, `ms-financiero`, `ms-notificaciones` | Container Apps internas, alcanzables sólo dentro del entorno por `http://<nombre>`. |
| `migrar-*`, `seed-identidad` | Jobs manuales: aplican migraciones y siembran los usuarios de demostración. |
| `motor-financiero` | Job programado, 00:01 de Bogotá (`1 5 * * *` en UTC). |
| `swa-arriendos360` | La SPA en Static Web Apps Free. |
| `psql-arriendos360-*`, `kv-arriendos360-*`, `starriendos360*`, `log-arriendos360` | Base, secretos, anexos y logs. |

Las apps escalan a cero: sin tráfico no hay réplicas encendidas. PostgreSQL no escala a cero,
así que se apaga a mano cuando no se va a usar.

## Desplegar

Lo normal es el workflow, que hace lo mismo que los scripts y en el mismo orden.

### Con el pipeline

**Fusionar un PR en `main` despliega**: el push dispara **Desplegar**, que hace, en orden,
pruebas → imágenes a GHCR → `base.bicep` → sitio de la SPA → Jobs de migración y su ejecución
→ apps y Job del motor → contenido de la SPA → humo. Sólo se reconstruye y se republica lo que
cambió, y un push que toca únicamente documentación (`**.md`, `docs/`) no dispara nada.

Si el entorno `produccion` tiene revisores, el trabajo que toca Azure espera la aprobación;
si no, entra solo. Las pruebas corren además en cada Pull Request hacia `main` (**Pruebas**),
antes de fusionar.

A mano —Actions → **Desplegar** → *Run workflow* sobre `main`— para repetir un despliegue sin
cambios o para marcar *sembrar* y recrear los usuarios de demostración; esa casilla sólo existe
en el disparo manual.

**Requisito de una sola vez:** en el entorno `produccion` del repositorio tienen que existir
tres *variables* (no secretos), que imprime `bootstrap.sh` al terminar:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` y `AZURE_SUBSCRIPTION_ID`.

### A mano

Desde Cloud Shell o Git Bash con `az login` hecho. `CONFIRMADO=si` delante de un
`desplegar-*` evita la pregunta tras el what-if.

```bash
gh workflow run imagenes.yml --ref main          # publica sólo las imágenes que cambiaron
bash infra/azure/desplegar-base.sh               # Log Analytics, PostgreSQL, Storage, entorno
PASO=sitio bash infra/azure/desplegar-spa.sh     # crea el Static Web App
bash infra/azure/servicios-a-migrar.sh           # qué esquemas cambiaron (ANTES del siguiente)
bash infra/azure/desplegar-trabajos.sh           # Jobs de migración y seed
bash infra/azure/ejecutar-trabajo.sh migrar-<esquema>   # uno por cada esquema que salió arriba
bash infra/azure/desplegar-apps.sh               # las seis apps y el Job del motor
PASO=contenido bash infra/azure/desplegar-spa.sh # compila la SPA y sube el build, si cambió
bash infra/azure/humo.sh                         # ¿quedó en pie?
```

`desplegar-apps.sh` toma por defecto la URL de la SPA para `CORS_ORIGENES` y `URL_APP`; se
pueden forzar por entorno.

### Desde cero, la primera vez

```bash
bash infra/azure/bootstrap.sh    # grupo, Key Vault, identidades, roles, credencial federada y secretos
```

Pide por teclado la dirección de Gmail y su contraseña de aplicación, y el token de GHCR
(`read:packages`, classic). Genera los secretos aleatorios sin mostrarlos y **nunca los rota**
al repetirlo. Al final imprime las tres variables para GitHub.

## Revertir un despliegue

**El camino normal es git**: `git revert <sha>`, PR y fusión. El push redespliega solo, y sólo
el servicio afectado —el revert vuelve a tocar sus rutas, así que su etiqueta cambia y se
reconstruye su imagen—. Tarda lo que tarde el pipeline, ~18 min con pruebas e imágenes.

**Si no puede esperar**, desde Git Bash con `az login` hecho, se publica la revisión anterior
en un par de minutos sin construir nada: las imágenes de ese commit siguen en GHCR y las
etiquetas se calculan con el `git log` del árbol en el que estés.

```bash
git checkout <sha-bueno>
CONFIRMADO=si bash infra/azure/desplegar-trabajos.sh   # los Jobs vuelven a esas etiquetas
CONFIRMADO=si bash infra/azure/desplegar-apps.sh       # las apps, con las imágenes de antes
git checkout main
```

Los Jobs primero: `desplegar-apps.sh` se niega si no llevan las mismas etiquetas. Y deja Azure
por detrás del repositorio hasta que fusiones el revert; el siguiente push a `main` vuelve a
poner lo que haya en `main`.

**Las migraciones no se revierten**: no hay `down`. Si el commit que rompió cambió el esquema,
volver atrás el código no deshace el `ALTER`, y la revisión anterior puede no arrancar contra
el esquema nuevo. Por eso una migración tiene que ser compatible con la versión anterior del
servicio; cuando no lo sea, la salida es una migración nueva que corrija, no un revert.

## Comprobar

| Script | Qué comprueba | Cuánto tarda |
|---|---|---|
| `humo.sh` | Gateway, login, SPA y CORS. | 2–3 min |
| `verificar-base.sh` | Secretos, tope de logs, entorno, Storage y TLS de PostgreSQL. | 3 min |
| `verificar-trabajos.sh` | Dos rondas de los seis Jobs; relanzar no migra nada. | 5 min |
| `verificar-apps.sh` | Arranque en frío medido, HTTPS, servicios inalcanzables, motor y correo. | ~30 min |
| `verificar-spa.sh` | Portada, ruta interna recargada, estáticos y CORS. | 1 min |

`verificar-base.sh` sólo pasa entero desde Cloud Shell: la prueba de TLS necesita conectarse
a PostgreSQL, que sólo admite servicios de Azure.

## Datos de demostración

Los tres usuarios del seed no alcanzan para enseñar nada: la cartera la siembra
`infra/demo/sembrar-demo.js`, que entra por el gateway como una persona —no escribe en
ninguna base— y deja seis inmuebles con un caso de cada estado: contratos activos y uno
finalizado, cuentas `PAGADA`, `PENDIENTE`, `PARCIAL` y `EN_MORA`, y una transacción anulada
junto a la buena que la reemplazó.

```bash
npm run demo                                                        # contra el Compose local
URL_GATEWAY=https://gateway-...azurecontainerapps.io npm run demo   # contra Azure
CORREO_DEMO=tu@correo.com npm run demo                              # avisos a un buzón real
```

Al terminar **hay que correr el motor**, que es lo que marca la mora y, en la misma
transacción, avisa por correo a las dos partes: `npm run motor --workspace=services/ms-financiero`
en local y `bash infra/azure/ejecutar-trabajo.sh motor-financiero` en Azure. El atajo
`POST /api/pagos/verificar-mora` no sirve para esto: marca la mora sin avisar, y deja las
cuentas fuera del alcance del motor, que sólo mira las `PENDIENTE` y `PARCIAL`.

Antes hay que tener aplicado el seed de ms-identidad —en Azure, el Job `seed-identidad`—,
porque el sembrador entra como su propietaria. Es idempotente: repetirlo no duplica nada y
completa lo que haya quedado a medias. Contra Azure tarda unos minutos, porque las apps están
dormidas y él las despierta esperando.

Los correos van a direcciones `@arriendos360.test`, que no existen y rebotan. Con
`CORREO_DEMO`, la inquilina del sexto inmueble —que no paga nada— recibe de verdad sus avisos
de cobro y de mora, que es lo que conviene poder abrir delante del jurado. Ninguna dirección
personal entra al repositorio.

## Antes de una sustentación

1. Enciende PostgreSQL si lo detuviste:
   `az postgres flexible-server start -g rg-arriendos360 -n psql-arriendos360-8b4d5b`.
2. Actions → **Calentar** → *Run workflow*, con los minutos que dure la sesión. Sube a una
   réplica gateway e identidad y los devuelve a cero al terminar. Sin eso, el primer login
   tarda ~37 s.
3. Entra a la SPA y haz un login de prueba.

## Apagar la base entre sesiones

```bash
az postgres flexible-server stop  -g rg-arriendos360 -n psql-arriendos360-8b4d5b
az postgres flexible-server start -g rg-arriendos360 -n psql-arriendos360-8b4d5b
```

Azure la vuelve a encender sola a los siete días. **Con la base apagada no arranca ningún
servicio**: enciéndela antes de una demostración y dale unos minutos.

## Cuando algo falla

- **Una app no arranca tras desplegar.** Casi siempre es una migración pendiente: en Azure
  los servicios no migran al arrancar y se niegan a levantar. Ejecuta `migrar-<servicio>`.
- **Un Job queda en `Failed`.** Mira su salida:
  `bash infra/azure/ejecutar-trabajo.sh <job>` la vuelve a lanzar y la imprime.
- **La imagen no se descarga.** El token de GHCR vence: renuévalo y guárdalo con
  `az keyvault secret set --vault-name kv-arriendos360-8b4d5b -n ghcr-token`.
- **El primer login tarda o da 502.** Es el arranque en frío. El proxy espera 60 s y los
  clientes internos 30 s; la SPA reintenta y avisa.
- **Recargar la SPA devuelve al login.** Es el diseño: el token vive en memoria.
- **Buscando en los logs no aparece nada.** En Log Analytics, `has` compara palabras
  completas: busca `RecuperacionSolicitada`, no `Recuperacion`. La ingesta tarda minutos.
- **El entorno de Container Apps aparece en modo Express.** No admite Jobs ni referencias a
  Key Vault y no se convierte: hay que borrarlo y recrearlo con `base.bicep`, que lo declara
  con perfil `Consumption` explícito.
