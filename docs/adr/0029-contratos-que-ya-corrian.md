# ADR 0029 — Registrar un contrato que ya corría

- **Estado:** aceptada
- **Fecha:** 2026-11-02
- **Se aparta del Capítulo 2:** sí, por adición. `Contratos` gana `ultimo_periodo_pagado`,
  `ContratoFormalizado` sube a la versión 3 con ese campo opcional y el bus gana
  `CuentasAtrasadasRegistradas`. Pendiente de incorporar por PMP §13.3.2.

## Contexto

Un propietario que registra un contrato firmado hace años recibía una cuenta de cobro del primer
mes, ya pagado en la vida real, que pasaba a mora, y una sugerencia de ajuste por IPC que quizá ya
había aplicado. El contrato nacía con deudas y avisos que no existen.

## Decisión

1. **Con el primer corte anterior a hoy, se pide el último mes pagado o «no ha pagado ningún mes».**
   Se elige un mes y se guarda el inicio de su periodo de corte: las cuentas se identifican por
   periodo, así que comparar periodos no depende de cuándo se pagó. Va del mes del primer corte al
   periodo que toca facturar hoy. No se edita después. «Ningún mes» se guarda como el periodo
   anterior al primero, así motor y consumidor no distinguen el caso. `NULL` es «no se preguntó».
   Un primer corte anterior a `inicio` es 400: «ningún mes» cobraría periodos anteriores al contrato.
2. **Con 12 meses o más, se pide la fecha del último ajuste o «nunca se ha ajustado».** Usa
   `fecha_ultimo_ajuste`; `ajusteDeCanon` no cambia. El canon que se escribe es el vigente hoy, y
   con él se cobran también los meses atrasados.
3. **El consumidor de `ContratoFormalizado` emite lo que ya tocaba al formalizar**: del periodo
   siguiente al último pagado al último cuyo corte llegó o está dentro de
   `DIAS_ANTICIPACION_FACTURA`, en una transacción.
4. **Las atrasadas se anuncian juntas.** Atrasada es la que al formalizar ya cumplió
   `DIAS_PARA_MORA`. No lleva recibo y pasa a `EN_MORA` sin `CuentaCobroEnMora`; el consumidor anota
   un solo `CuentasAtrasadasRegistradas`, cuyo correo va al inquilino: el propietario ya vio el
   total al firmar. Se mide con `ocurrido_en` en el consumidor y con `fecha_creacion` en el motor.
   Una cuenta aún en plazo sigue el flujo normal.
5. **El motor no cobra lo pagado ni lo que ya tocaba al formalizar; lo posterior es suyo**, aunque
   sea el siguiente al último pagado. «Ya tocaba» se mide con `fecha_creacion` en Bogotá.
6. **«Nuevo cobro» sin periodo responde 409 si el que toca hoy ya está pagado**: ninguna cuenta
   chocaría con el índice único y lo cobraría de nuevo. Indicando el periodo se permite, porque es
   el único arreglo desde la app si marcaron como pagado un mes demasiado reciente.
7. **Las reglas viven en `packages/contracts`**, que comparten ms-contratos y la SPA.
   `contracts` no importa `shared`, así que replica lo poco de calendario que necesita; una prueba
   de ms-financiero cruza `cuentasPendientes` con `periodosPendientes`.

## Alternativas descartadas

- **Saltar siempre el siguiente al último pagado, como el primero de un contrato nuevo:** un
  contrato al día perdería para siempre su siguiente cobro. Nadie más lo emitiría: el consumidor
  sólo factura lo vencido y el evento no se repite.
- **Rellenar los meses atrasados desde el motor:** el motor mira sólo hoy y hace un número fijo de
  peticiones.
- **Crear cuentas históricas marcadas como pagadas:** inventa transacciones que nadie registró.
- **Guardar la fecha del último pago:** es ambigua con pagos atrasados, adelantados o parciales.
- **Un recibo y un aviso de mora por cada cuenta atrasada:** registrar un contrato de años enviaría
  decenas de correos el mismo día.

## Consecuencias

- Si el motor se adelanta a un evento demorado, el consumidor de un contrato antiguo omite lo ya
  emitido en lugar de chocar con el índice único. Un contrato nuevo conserva el rechazo del índice.
- Un mes mal elegido no se corrige desde la app: el formulario muestra rango, número de cuentas y
  total antes de firmar, y un error se arregla en la base.
- Un mes de antes del último ajuste se cobra con el canon de hoy, y la deuda queda inflada: el
  propietario lo ve en el total antes de firmar.
- Los pagos con huecos se registran eligiendo el último mes sin interrupciones y anotando lo demás
  como pago. Lo mismo un adelanto por encima del periodo que toca facturar.
- El PDF del contrato imprime el canon vigente junto a las fechas originales.
- `POST /api/contratos` rechaza con 400 un contrato antiguo sin estos datos. El sembrador y la suite
  de integración los envían.
- Los contratos ya creados con el error no se corrigen: se borran y se vuelven a crear.
