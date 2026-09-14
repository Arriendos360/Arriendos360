# ADR 0014 — Almacenamiento de anexos: interfaz con disco y Azure Blob

- Estado: Aceptada
- Fecha: 2026-09-08
- Paso de la migración: 6b

## Contexto

CLAUDE.md tenía dos apuntes sobre esto, uno en decisiones abiertas y otro en trampas
conocidas, y son el mismo problema visto por sus dos lados:

> **Almacenamiento en la nube para anexos.** Azure Blob Storage es lo natural dado el
> hosting. Hoy los archivos van a disco local, que no sobrevive a scale-to-zero.

> **`/uploads/` se sirve sin autenticación.** `express.static('uploads')` va antes de
> cualquier middleware de token, así que los PDF de contrato son públicos para quien
> conozca la URL.

Hasta este paso, el PDF del contrato viajaba en el mismo `multipart` que lo creaba,
`multer.diskStorage` lo escribía en `uploads/contratos/` y la ruta resultante se guardaba
en `contratos.url_pdf`. Tres decisiones encadenadas, y las tres hay que deshacerlas a la
vez porque se sostienen entre sí: **quién decide dónde se guarda**, **dónde acaba el
archivo** y **cómo se sirve**.

El paso 6b añade además la tabla `Anexos`, que es lo que obliga a resolverlo ahora: un
contrato pasa de tener un archivo a tener varios, con tipo, y con un ciclo de vida propio.

## Decisión

**El acceso al almacenamiento va detrás de una interfaz, con dos implementaciones.** Es la
misma jugada que `Notificador` en ms-identidad (ADR 0010), y por el mismo motivo: hay algo
que el código necesita hacer hoy, un sitio distinto donde tendrá que hacerlo mañana, y
ninguna de las dos cosas debe filtrarse a la lógica de negocio.

```js
guardar({ contenido, tipoMime, carpeta, extension }) -> { referencia, tamano }
leer(referencia)   -> { flujo, tamano, tipoMime } | null
eliminar(referencia)
```

### 1. `AlmacenamientoDisco` para desarrollo y pruebas

No es un doble: es una implementación de verdad, con su lógica y sus pruebas. Que exista
es lo que mantiene en pie la regla que CLAUDE.md fija para todo el proyecto —**las suites
corren en un portátil sin Docker**— y ahora también sin credenciales de Azure.

Su raíz **no** es `uploads/`. Ese nombre arrastra la costumbre de servirlo con
`express.static`, y reutilizarlo invitaría a volver a exponerlo; se llama
`almacenamiento/` y nada lo publica.

### 2. `AlmacenamientoAzureBlob` para el despliegue

Cierra la decisión abierta. En Container Apps el disco del contenedor se borra cuando la
réplica se apaga, y con scale-to-zero eso pasa todos los días: un contrato escaneado
subido el lunes no está el martes. Azure Blob es lo natural dado el hosting —misma
suscripción, misma identidad administrada en el paso 8— y su capa gratuita cubre de sobra
un proyecto de grado.

**El SDK se carga dentro del método, no arriba del archivo.** Así el paquete no se toca en
desarrollo ni en las pruebas, que usan disco, y las suites nunca necesitan credenciales:
no llegan a esa línea.

### 3. La elección es una sola condición, y deliberadamente tonta

```js
process.env.AZURE_STORAGE_CONNECTION_STRING ? new AlmacenamientoAzureBlob() : new AlmacenamientoDisco()
```

Sin banderas que activar ni `NODE_ENV` que interpretar. El modo de fallo que se quiere
imposibilitar es **desplegar en Azure creyendo que se guarda en Blob mientras los archivos
van a un disco que se borra esa noche**, y ese fallo es silencioso: todo funciona hasta que
alguien pide un contrato viejo. Con una sola condición, si hay cadena de conexión hay Blob.

### 4. La referencia es opaca

`archivo_anexo` guarda lo que devuelve `guardar()`, y lo único que se promete de ese valor
es que `leer()` y `eliminar()` lo entienden: con disco es una ruta relativa a la raíz, con
Azure el nombre del blob. Guardar una ruta absoluta —lo que hacía `url_pdf`— ata la fila a
la máquina que la escribió.

El nombre del archivo lo **genera** el almacenamiento (un UUID), no lo trae quien sube. El
nombre original lo controla el cliente: puede traer `../`, caracteres que el sistema de
archivos rechaza, o el de un archivo ya guardado.

### 5. Se sirve desde el servicio, en streaming, sin URL firmadas

`GET /api/contratos/:id/anexos/:idAnexo` pide un flujo al almacenamiento y lo conecta a la
respuesta. **En streaming** porque diez descargas simultáneas de un contrato de 10 MB
serían 100 MB de memoria en un contenedor que no los tiene.

**Sin URL firmadas**, que era la alternativa obvia y es la que se descarta con más
convicción. Una URL firmada es un permiso que viaja solo: quien la tenga entra, aunque haya
dejado de ser inquilino de ese contrato, y no hay forma de revocarla antes de que caduque.
Es exactamente el agujero de `/uploads` con mejor presentación. Pasando por la API, cada
descarga cruza la matriz RBAC y el ABAC del controlador, así que dejar de ser parte del
contrato corta el acceso de inmediato.

El precio es que el archivo pasa por el gateway en vez de ir del navegador al blob. Con
contratos de 10 MB y un puñado de descargas al día, es un precio que no se nota.

### 6. Validación por contenido y tope de 10 MB

- **Solo PDF, comprobado en los primeros bytes** (`%PDF-`). La extensión y el
  `Content-Type` del multipart los declara quien sube: son afirmaciones suyas, no
  comprobaciones. Renombrar `virus.exe` a `contrato.pdf` era todo lo que hacía falta para
  pasar el filtro anterior.
- **10 MB por archivo, con `413`.** Un contrato escaneado son 5-15 páginas; a 300 ppp en
  escala de grises cada una ronda los 300 KB, así que 10 MB dan para unas treinta. El
  código 413 existe para esto y le dice al cliente que el problema es el tamaño y no el
  contenido; un 400 lo dejaría adivinando.

## Consecuencias

**Desaparece `express.static('uploads')`,** y con él la trampa que CLAUDE.md tenía anotada.
No queda ninguna ruta que sirva archivos sin pasar por la matriz.

**El flujo del usuario cambia**, y esto es lo que hay que contar en la demostración: el
contrato se crea primero y el PDF se adjunta después, desde una vista de detalle nueva. Lo
pide el Capítulo 2 —el anexo necesita un `id_contrato` que no existe mientras se firma— y
a cambio se pueden subir varios archivos, con su tipo, y añadir un otrosí meses después.

**Una dependencia nueva en el gateway:** `@azure/storage-blob`. Es peso en la imagen Docker
y CLAUDE.md pide justificarlo. La alternativa era firmar las peticiones a la API REST de
Azure a mano (HMAC-SHA256 sobre una cadena canónica), que es código criptográfico sin
pruebas posibles en este entorno para ahorrar un paquete. Se acepta el paquete.

**El archivo se guarda antes que la fila.** Si falla el almacenamiento no queda una fila
apuntando a nada; al revés, un fallo de la base deja un archivo huérfano. Se elige el
huérfano a propósito: ocupa espacio y no engaña a nadie, mientras que una fila rota sale
por pantalla como un anexo que existe y no se puede descargar. Lo mismo al borrar, en el
orden contrario.

**Queda sin resolver la limpieza de huérfanos.** No hay barrido que compare el
almacenamiento con la tabla. Con el volumen de este proyecto no compensa; si algún día
compensa, es un proceso programado del lado de ms-contratos.

## Alternativas descartadas

**Seguir en disco y montar un volumen persistente en Container Apps.** Existe (Azure Files
montado en el contenedor) y evitaría la dependencia. Se descarta porque ata el servicio a
un montaje concreto, no escala a varias réplicas escribiendo a la vez, y cuesta más que
Blob para el mismo trabajo.

**Guardar los PDF en la base, en una columna `BYTEA`.** Resuelve la persistencia sin
dependencias y con transaccionalidad de regalo. Se descarta por el tamaño: 10 MB por fila
infla las copias de seguridad y el `WAL`, y convierte cada descarga en tráfico contra
PostgreSQL, que es el recurso más escaso del despliegue.

**URL firmadas de Azure Blob (SAS).** Descargaría el tráfico del gateway y es lo que
recomienda la documentación de Azure. Se descarta por lo dicho en el punto 5: un permiso
que no se puede revocar sobre un documento entre dos partes cuya relación termina.

**Dejar `express.static` y añadirle un middleware de token.** Parece lo barato, pero
`express.static` resuelve el archivo por su ruta y esa ruta seguiría siendo la referencia
guardada en la fila: el ABAC —«¿este contrato es tuyo?»— no se puede aplicar sin volver a
la base, que es lo que ya hace el controlador. Sale más código para llegar al mismo sitio
con una ruta pública de más.

## Estado frente a la línea base

El Capítulo 2 dice que `POST /api/contratos/{id_contrato}/anexos` **sube el archivo a
almacenamiento en la nube y guarda la URL devuelta en `archivo_anexo`**. Se cumple, con una
precisión que conviene dejar escrita: lo que se guarda es la **referencia** del
almacenamiento, no una URL navegable. Un anexo no tiene URL pública por diseño (punto 5), y
llamar «URL» a algo que nadie puede pegar en un navegador sería peor documentación que
llamarlo referencia.

No hay desviación que tramitar: el documento no fija el proveedor ni cómo se sirve el
archivo de vuelta.

## Anotación posterior (2026-09-14): anexos subidos antes del paso 6d

La migración `database/contratos/002` movió las FILAS de `anexos` a ms-contratos,
no los archivos. Con la implementación de disco, los subidos antes del 6d quedaron en
`apps/gateway/almacenamiento/` y hay que copiarlos a mano a
`services/ms-contratos/almacenamiento/`. Con Azure Blob no hace falta: el contenedor es
el mismo y la referencia guardada sigue valiendo. En la base de desarrollo no había
ninguno cuando se hizo la mudanza. Está anotado también en la cabecera de la
migración.
