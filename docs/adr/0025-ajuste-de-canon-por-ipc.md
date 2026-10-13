# ADR 0025 — Ajuste anual del canon por IPC

- **Estado:** aceptada
- **Fecha:** 2026-10-12
- **Se aparta del Capítulo 2:** sí, por adición. `Contratos` gana `fecha_ultimo_ajuste` y el
  bus gana `AjusteCanonProximo` y `CanonAjustado`. Pendiente de incorporar por PMP §13.3.2.

## Contexto

El RF-22 del SRS pide avisar al propietario cuándo corresponde reajustar el canon y calcular el
valor sugerido con el tope de la Ley 820 de 2003, art. 20: cada 12 meses de ejecución y como
máximo el IPC del año calendario anterior. El Capítulo 2 lo lista como *Must Have* sin fijar
tablas, endpoints ni eventos.

El motor de ms-financiero genera cada cuenta hasta `DIAS_ANTICIPACION_FACTURA` (2) días antes
de su corte y con el canon de ese momento.

## Decisión

1. **Fecha de ajuste:**
   - Es el primer corte en o después de 12 meses desde `fecha_ultimo_ajuste` o, si nunca se ha
     ajustado, desde `inicio`.
   - El `fin` no cuenta: un contrato activo pasado su `fin` está prorrogado y el motor lo sigue
     facturando.
2. **Ventana de ajuste:**
   - Se abre en el corte anterior a la fecha de ajuste y sigue abierta hasta que se aplique.
   - Sólo existe si está registrado el IPC del año anterior a la fecha de ajuste.
   - Así un cambio de canon dentro de la ventana no alcanza a cuentas de periodos anteriores a
     la fecha de ajuste.
3. **Canon sugerido:** el canon actual por (1 + IPC), redondeado hacia abajo al peso. Es el tope.
   Se calcula en enteros (`packages/shared/src/ajusteCanon.ts`).
4. **IPC como catálogo en código:**
   - `IPC_ANUAL` en `packages/contracts`, con el dato del DANE.
   - Cada enero se agrega el año anterior con un PR.
   - Sin el dato no hay sugerido, ni ventana, ni alerta.
5. **`fecha_ultimo_ajuste`** (`DATE NULL`) en `Contratos`:
   - Guarda desde cuándo rige el último ajuste, no su fecha de ajuste: la ley pide 12 meses bajo un
     mismo precio, y un ajuste tardío seguido de uno a tiempo los acortaría.
   - Sin ella, después de aplicar un ajuste el cálculo volvería a sugerir otro sobre el canon nuevo.
6. **El ajuste entra por `PUT /api/contratos/:id`:**
   - Un cambio de canon con la ventana abierta *es* el ajuste: se valida contra el tope (`400`
     en `canon`), se guarda la fecha y se anota `CanonAjustado` en la misma transacción.
   - Un `PUT` que no cambia el canon, o que lo cambia fuera de la ventana, funciona como antes.
7. **Avisos:**
   - El motor diario anota `AjusteCanonProximo` una vez por ajuste, con un `id_evento`
     determinista `(id_contrato, fecha_ajuste)`.
   - ms-notificaciones avisa al propietario, y con `CanonAjustado` envía al inquilino el aviso
     formal del reajuste.
8. **`ajuste_canon`** se compone en `GET /api/contratos` y `GET /api/contratos/:id` sólo para el
   propietario.

## Consecuencias

- **Mantenimiento:** si en enero nadie registra el IPC, no hay alertas hasta que se registre.
- **Una corrección del canon fuera de la ventana no reinicia los 12 meses.**
- **No ajustar:** un propietario que decide no subir el canon sigue viendo la ventana abierta. El
  correo sale una sola vez.
- **Ajuste tardío:** aplicado con la cuenta de la fecha de ajuste ya generada, rige desde el corte
  siguiente, y así lo dicen la respuesta y el aviso al inquilino. El siguiente ajuste se corre a 12
  meses de esa fecha. Un contrato con corte a principios de enero, antes de que el DANE publique el
  IPC, se ajusta tarde el primer año y desde el segundo cae en febrero.
- **Contratos existentes:** los que ya cumplieron un año abren la ventana con el primer barrido
  después del despliegue.
- **Configuración:** ms-contratos exige `MS_NOTIFICACIONES_URL`.
