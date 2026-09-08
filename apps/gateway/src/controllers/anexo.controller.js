const crypto = require('crypto');

const { propioDe } = require('../clientes/inmuebles');
const { esPdf } = require('../middlewares/upload.middleware');
const { Anexo, Contrato } = require('../models');
const { esUuid } = require('../models/uuid');
const { CARPETA_ANEXOS, almacenamiento } = require('../services/almacenamiento');

/**
 * Anexos de un contrato.
 *
 * EL FLUJO ES DE DOS PASOS, y el Capítulo 2 es explícito al respecto: el anexo
 * no nace con el contrato. Primero se firma —y así existe un `id_contrato`— y
 * después se adjunta. Antes el PDF viajaba en el mismo `multipart` que creaba el
 * contrato, lo que obligaba a tener el archivo listo en el momento de firmar y
 * dejaba un solo archivo por contrato, sin tipo y sin forma de añadir un otrosí.
 *
 * ── LA AUTORIZACIÓN TIENE DOS CAMINOS, Y SÓLO UNO CUESTA UNA PETICIÓN ────────
 *
 * Un contrato es accesible para el inquilino que lo firmó O para el dueño del
 * inmueble sobre el que se firmó. Es la misma disyunción que gobierna los
 * listados (ver CLAUDE.md, «Listados de un usuario con doble rol»), pero aquí
 * los dos lados no cuestan lo mismo:
 *
 *   1. **Inquilino** — `contratos.id_inquilino` está en esta misma tabla. Es una
 *      comparación en memoria, sin red.
 *   2. **Propietario** — hace falta saber de quién es `id_inmueble`, y eso vive
 *      en ms-inmuebles desde el paso 4. Es un salto HTTP.
 *
 * Se comprueba PRIMERO el barato. No es micro-optimización: además de ahorrar
 * una petición en el caso del inquilino, hace que un inquilino pueda seguir
 * bajándose su contrato aunque ms-inmuebles esté caído. La disyunción se evalúa
 * en el orden en que se puede.
 *
 * Cuando el camino del propietario falla por red, el error SE PROPAGA y sale un
 * 502. No se degrada a «no autorizado»: decirle a alguien que no tiene permiso
 * cuando en realidad no se ha podido comprobar es la peor de las respuestas
 * posibles. Es la misma política que documenta `clientes/inmuebles.js`.
 *
 * ── QUÉ PASA CON ESTO EN EL PASO 6d ──────────────────────────────────────────
 *
 * Cuando `Contratos` y `Anexos` se vayan a ms-contratos, el camino 1 se va con
 * ellas —`id_inquilino` viaja en la misma fila— pero el camino 2 se queda sin
 * resolver: ms-contratos no tiene los inmuebles y no debería preguntar por ellos
 * en cada descarga de un archivo.
 *
 * **La salida recomendada es denormalizar `id_propietario` en `Contratos`**, que
 * se conoce en el momento de firmar y sale del `sub` del token (regla dura 4).
 * Con eso los dos caminos del ABAC quedan locales y la descarga deja de tener
 * saltos de red. El precio es una copia que puede quedarse vieja si un inmueble
 * cambia de dueño; se acepta porque un contrato es un documento entre las partes
 * que lo firmaron, así que la copia describe mejor el hecho jurídico que una
 * consulta al dueño de hoy.
 *
 * La alternativa sin cambio de esquema es que el gateway siga resolviendo la
 * lista de inmuebles del propietario y se la pase a ms-contratos como filtro,
 * que es lo que ya hace en los listados. Sirve para listar, pero para una
 * descarga concreta significa traerse la lista entera para comprobar un
 * elemento. Decidir con un ADR antes de extraer el servicio.
 */

/** Nombre del archivo que ve el usuario. El de origen no se guarda ni se usa. */
const nombreDescarga = (anexo) =>
    `${String(anexo.tipo).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${anexo.id_anexo.slice(0, 8)}.pdf`;

/**
 * El contrato, sólo si este usuario es parte de él. `null` si no lo es.
 *
 * @throws si ms-inmuebles no responde y hacía falta preguntarle.
 */
const contratoAccesible = async (idContrato, sub) => {
    const contrato = esUuid(idContrato) ? await Contrato.findByPk(idContrato) : null;

    if (!contrato) {
        return null;
    }

    // Camino 1: el inquilino. Local, sin red.
    if (contrato.id_inquilino === sub) {
        return contrato;
    }

    // Camino 2: el dueño del inmueble. Un salto a ms-inmuebles.
    const inmueble = await propioDe(contrato.id_inmueble, sub);
    return inmueble ? contrato : null;
};

/** 502 con el formato del proyecto. Un servicio caído no es un 500 nuestro. */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);
    return res.status(502).json({ mensaje: 'No se pudo contactar el servicio de inmuebles' });
};

/**
 * 404 y no 403 cuando el contrato no es suyo.
 *
 * Un 403 confirmaría que ese identificador existe, que es información que quien
 * pregunta no tiene por qué obtener probando UUID. Es el mismo criterio que ya
 * aplica `contratoPropio` en `contrato.controller.js`.
 */
const NO_ENCONTRADO = { mensaje: 'Contrato no encontrado o no tienes permisos' };

/**
 * POST /api/contratos/:id/anexos
 *
 * `multipart/form-data` con `file` (PDF) y `tipo`.
 */
const subir = async (req, res) => {
    let contrato;
    try {
        contrato = await contratoAccesible(req.params.id, req.usuario.sub);
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    if (!contrato) {
        return res.status(404).json(NO_ENCONTRADO);
    }

    if (!req.file) {
        return res.status(400).json({ mensaje: 'Adjunta el archivo en el campo `file`' });
    }

    // La comprobación que de verdad decide: los primeros bytes del archivo. El
    // `mimetype` que trae el multipart ya lo miró el middleware, pero lo declara
    // quien sube, así que no prueba nada por sí solo.
    if (!esPdf(req.file.buffer)) {
        return res.status(400).json({ mensaje: 'El archivo no es un PDF' });
    }

    const tipo = typeof req.body.tipo === 'string' ? req.body.tipo.trim() : '';
    if (tipo === '') {
        return res.status(400).json({ mensaje: 'Indica el `tipo` del anexo' });
    }

    try {
        // Se guarda el archivo ANTES que la fila. Si falla el almacenamiento no
        // queda una fila apuntando a nada; al revés, un fallo de la base dejaría
        // un archivo huérfano, que es más barato de tolerar — ocupa espacio y no
        // engaña a nadie, mientras que una fila rota sale por pantalla como un
        // anexo que existe y no se puede descargar.
        const { referencia } = await almacenamiento().guardar({
            contenido: req.file.buffer,
            tipoMime: 'application/pdf',
            carpeta: `${CARPETA_ANEXOS}/${contrato.id_contrato}`,
            extension: '.pdf'
        });

        const anexo = await Anexo.create(
            {
                id_anexo: crypto.randomUUID(),
                archivo_anexo: referencia,
                tipo,
                id_contrato: contrato.id_contrato
            },
            { usuarioAuditor: req.usuario.sub }
        );

        return res.status(201).json({ mensaje: 'Anexo cargado', anexo });
    } catch (error) {
        console.error('Error al subir el anexo:', error.message);
        return res.status(500).json({ mensaje: 'No se pudo guardar el anexo' });
    }
};

/**
 * GET /api/contratos/:id/anexos
 *
 * No devuelve `archivo_anexo`: es una referencia interna del almacenamiento y no
 * le sirve de nada al cliente, que descarga por `id_anexo`. Publicarla sólo
 * daría pistas sobre cómo están guardados los archivos.
 */
const listar = async (req, res) => {
    let contrato;
    try {
        contrato = await contratoAccesible(req.params.id, req.usuario.sub);
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    if (!contrato) {
        return res.status(404).json(NO_ENCONTRADO);
    }

    const anexos = await Anexo.findAll({
        where: { id_contrato: contrato.id_contrato },
        attributes: ['id_anexo', 'tipo', 'id_contrato', 'fecha_creacion', 'creado_por'],
        order: [['fecha_creacion', 'ASC']]
    });

    return res.json(anexos);
};

/**
 * GET /api/contratos/:id/anexos/:idAnexo
 *
 * EN STREAMING. El archivo no pasa entero por la memoria del gateway: se pide al
 * almacenamiento un flujo y se conecta a la respuesta. Diez descargas
 * simultáneas de un contrato escaneado de 10 MB serían 100 MB de memoria si se
 * cargaran enteros, en un contenedor que no los tiene.
 *
 * NADA DE URL FIRMADAS ni de acceso público. Cada descarga pasa por la matriz
 * RBAC y por el ABAC de aquí arriba, así que dejar de ser parte del contrato
 * corta el acceso de inmediato. Una URL firmada es un permiso que viaja solo y
 * que no se puede revocar antes de que caduque — el agujero de `/uploads` con
 * mejor presentación.
 */
const descargar = async (req, res) => {
    let contrato;
    try {
        contrato = await contratoAccesible(req.params.id, req.usuario.sub);
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    if (!contrato) {
        return res.status(404).json(NO_ENCONTRADO);
    }

    const { idAnexo } = req.params;

    // El anexo tiene que ser DE ESTE CONTRATO. Sin esta condición, quien tenga
    // un contrato propio podría descargar cualquier anexo del sistema poniendo
    // su id en la URL: el ABAC de arriba habría dicho que sí al contrato, y el
    // anexo vendría de otro.
    const anexo = esUuid(idAnexo)
        ? await Anexo.findOne({ where: { id_anexo: idAnexo, id_contrato: contrato.id_contrato } })
        : null;

    if (!anexo) {
        return res.status(404).json({ mensaje: 'Anexo no encontrado' });
    }

    let archivo;
    try {
        archivo = await almacenamiento().leer(anexo.archivo_anexo);
    } catch (error) {
        console.error('Error al leer el anexo del almacenamiento:', error.message);
        return res.status(500).json({ mensaje: 'No se pudo leer el anexo' });
    }

    if (!archivo) {
        // La fila existe y el archivo no. Pasa si alguien borró el disco por
        // debajo, que es exactamente lo que ocurría al reiniciar el contenedor
        // antes de este paso. Se dice, en vez de devolver una respuesta vacía.
        console.error(`Anexo ${anexo.id_anexo} sin archivo en ${anexo.archivo_anexo}`);
        return res.status(404).json({ mensaje: 'El archivo del anexo ya no está disponible' });
    }

    res.setHeader('Content-Type', archivo.tipoMime);
    res.setHeader('Content-Length', archivo.tamano);
    // `attachment` y no `inline`: es contenido que sube un usuario y se lo
    // descarga otro. El frontend lo recibe como blob y decide qué hacer con él,
    // así que no se pierde nada.
    res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga(anexo)}"`);
    // Que el navegador no intente adivinar otro tipo mirando el contenido.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    archivo.flujo.on('error', (error) => {
        console.error('Error al transmitir el anexo:', error.message);
        // Las cabeceras ya salieron: no se puede responder un código de error,
        // sólo cortar para que el cliente vea una descarga incompleta en vez de
        // un archivo truncado que parezca bueno.
        res.destroy(error);
    });

    return archivo.flujo.pipe(res);
};

/**
 * DELETE /api/contratos/:id/anexos/:idAnexo
 *
 * Sólo el propietario, por la matriz. Se borra la fila y el archivo, en ese
 * orden: si falla el almacenamiento queda un archivo huérfano y no una fila que
 * no se puede descargar.
 */
const eliminar = async (req, res) => {
    let contrato;
    try {
        contrato = await contratoAccesible(req.params.id, req.usuario.sub);
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    if (!contrato) {
        return res.status(404).json(NO_ENCONTRADO);
    }

    const { idAnexo } = req.params;
    const anexo = esUuid(idAnexo)
        ? await Anexo.findOne({ where: { id_anexo: idAnexo, id_contrato: contrato.id_contrato } })
        : null;

    if (!anexo) {
        return res.status(404).json({ mensaje: 'Anexo no encontrado' });
    }

    const referencia = anexo.archivo_anexo;
    await anexo.destroy();

    try {
        await almacenamiento().eliminar(referencia);
    } catch (error) {
        // No se propaga: la fila ya no está y el usuario no puede hacer nada con
        // este error. Queda en el log para que se pueda limpiar a mano.
        console.error(`No se pudo borrar el archivo ${referencia}:`, error.message);
    }

    return res.json({ mensaje: 'Anexo eliminado' });
};

module.exports = { contratoAccesible, descargar, eliminar, listar, subir };
