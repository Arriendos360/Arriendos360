# ADR 0026 — Preaviso de terminación del contrato

- **Estado:** aceptada
- **Fecha:** 2026-10-13
- **Se aparta del Capítulo 2:** sí, por adición. `Contratos` gana cuatro columnas con la constancia
  del preaviso y el bus gana `PreavisoProximo` y `PreavisoEnviado`. Pendiente de incorporar por PMP
  §13.3.2.

## Contexto

El RF-23 del SRS pide las comunicaciones formales con el arrendatario, con plazos legales
configurables. La Ley 820 de 2003 pide a la parte que no quiere renovar un aviso escrito, por el
servicio postal autorizado, con al menos tres meses de anticipación al vencimiento: el arrendatario
por el art. 24 num. 5, sin causal; el arrendador por el art. 22 num. 8, invocando una causal. Sin
aviso, el contrato se prorroga por el mismo término inicial (art. 6). El Capítulo 2 no fija tablas,
endpoints ni eventos para esto.

## Decisión

1. **Vencimiento vigente:** `fin` mientras hoy no lo pase; después, el final de la prórroga en
   curso. El término se mide en meses cuando `fin` es la víspera del día de `inicio` N meses
   después, y en días si no (`packages/shared/src/preaviso.ts`).
2. **Plazos como catálogo en código** (`packages/contracts`): 3 meses de preaviso, el recordatorio
   30 días antes de la fecha límite, y 4 años para la causal de plena voluntad. Son de la ley, no
   del despliegue: se cambian con un PR.
3. **La constancia son cuatro columnas nulas en `Contratos`:**
   - `preaviso_enviado_en` (`TIMESTAMPTZ`) y `preaviso_enviado_por` (`UUID`, el `sub`). La parte
     se deriva: si es el inquilino, `INQUILINO`; si no, `PROPIETARIO`.
   - `preaviso_vencimiento` (`DATE`): **se guarda, no se deriva.** La carta y el aviso lo citan tal
     como era al enviarse, y con él el contrato deja de prorrogarse: queda vencido en esa fecha
     hasta que el propietario lo finalice.
   - `preaviso_causal` (`VARCHAR(30)`, `CHECK` sobre el catálogo): una de las del art. 22 num. 8;
     `NULL` cuando avisa el inquilino. La de plena voluntad exige cuatro años de ejecución al
     vencimiento.
   - Como mucho un preaviso por contrato, y el cliente no escribe estas columnas.
4. **Envío:** `POST /api/contratos/:id/preaviso`, de cualquiera de las dos partes, hasta la fecha
   límite. La constancia y `PreavisoEnviado` se guardan en la misma transacción.
5. **Avisos:** el motor diario anota `PreavisoProximo` una vez por contrato y vencimiento, con un
   `id_evento` determinista; ms-notificaciones escribe a las dos partes. `PreavisoEnviado` lleva el
   aviso formal a la otra parte.
6. **La carta en PDF** (`GET /api/contratos/:id/preaviso`) se arma con la constancia y no se guarda.
   La app advierte que el correo electrónico no reemplaza el servicio postal.

## Alternativas descartadas

- **Una tabla de preavisos:** una tabla de dominio nueva para una fila por contrato.
- **Un anexo `PREAVISO`:** el motor de ms-financiero no ve `Anexos`, y habría que guardar el PDF.
- **Los plazos como variables de entorno:** una variable vacía en Compose los anularía.

## Consecuencias

- **Lectura legal:** los artículos y las causales vienen de la ley tal como se leyó para este
  cambio. Viven en un solo catálogo y conviene que el equipo los revise antes de la sustentación.
- **Vencido con preaviso:** el contrato sigue activo y facturando hasta que el propietario lo
  finalice, que es lo correcto mientras el inquilino ocupe el inmueble.
- **Envíos simultáneos:** dos envíos a la vez podrían registrarse los dos y la otra parte recibiría
  dos avisos. Se acepta en una acción manual y rara.
- **Retractarse** de un preaviso no está previsto.
