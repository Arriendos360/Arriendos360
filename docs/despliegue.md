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

1. Fusiona el PR en `main`.
2. Actions → **Desplegar** → *Run workflow* sobre `main`. Marca *sembrar* sólo si quieres
   recrear los usuarios de demostración.
3. Apruébalo cuando GitHub lo pida: el trabajo que toca Azure está en el entorno
   `produccion`.

Hace, en orden: pruebas → imágenes a GHCR → `base.bicep` → sitio de la SPA → Jobs de
migración y su ejecución → apps y Job del motor → contenido de la SPA → humo.

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
