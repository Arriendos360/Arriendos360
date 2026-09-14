/**
 * MOTOR FINANCIERO — Arriendos360
 *
 * Trazabilidad: la generacion de recibos es RF-11 y las alertas de mora son
 * RF-12. El control de dias de gracia no tiene requisito propio identificado;
 * queda marcado como pendiente de confirmar contra el SRS en vez de inventarle
 * un numero.
 *
 * Este proceso corre sin usuario autenticado, asi que las columnas de auditoria
 * quedan a nombre de USUARIO_SISTEMA (ver `models/columnas.ts`).
 *
 * ── LO QUE CAMBIA EN EL PASO 6e, Y ES LO MAS IMPORTANTE DE ESTE ARCHIVO ─────
 *
 * `procesarContratos` YA NO GENERA LA PRIMERA CUENTA DE COBRO. La primera nace
 * del evento `ContratoFormalizado`, en `eventos/index.ts`, que es el caso que el
 * Capitulo 2 especifica textualmente: «MS-Financiero consume el evento, extrae
 * `id_contrato`, `canon` y `fecha_inicio_corte`, e inserta la primera
 * Cuenta_cobro».
 *
 * Este barrido se queda con LOS MESES SIGUIENTES, que es lo que un evento no
 * puede dar: el contrato se formaliza una vez y hay que facturarlo doce.
 *
 * La frontera entre los dos esta en `primerPeriodoDe()`, y no es una
 * comprobacion de si «ya existe»: es una comprobacion de CUAL es el periodo. El
 * primero es del consumidor y este barrido lo salta siempre, exista o no. La
 * diferencia importa — saltarlo solo cuando ya existe dejaria que el motor
 * generase la primera cuenta de un contrato cuyo evento todavia no ha llegado, y
 * entonces habria dos caminos escribiendo la misma fila y una carrera entre
 * ellos. Hay ademas un indice unico `(id_contrato, inicio)` debajo, pero eso es
 * la red, no el diseño.
 *
 * ── LO QUE CAMBIA EN EL PASO 7: EL MOTOR NO MANDA CORREOS ──────────────────
 *
 * Los cuatro `enviarCorreo` que habia aqui —recibo generado, vencimiento proximo al
 * inquilino y al propietario, mora a los dos— se han convertido en tres eventos:
 * `CuentaCobroGenerada`, `CuentaCobroPorVencer` y `CuentaCobroEnMora`. Quien decide
 * a quien avisar, en que idioma y por que canal es ms-notificaciones.
 *
 * Y no es solo mover codigo de sitio. Un barrido que abre una conexion SMTP hereda su
 * latencia y sus fallos: el aviso del mes de alguien dependia de que un servidor de
 * correo contestara mientras el bucle estaba a medias. Ahora el aviso es una fila mas
 * en la misma transaccion, y lo que pueda fallar al mandarlo ya no ocurre aqui. Ver
 * `docs/adr/0019`.
 *
 * ── EL BARRIDO SIGUE SIENDO UN NUMERO FIJO DE VIAJES, Y AHORA SON MENOS ────
 *
 * La garantia no cambia con el paso 7: **el numero de peticiones no depende de
 * cuantos contratos haya.** Lo que cambia es el numero.
 *
 *   `procesarContratos` — 1 a ms-contratos (todos los activos, con su inmueble
 *   dentro). UNA, haya 5 contratos o 500.
 *
 *   `procesarPagos` — 1 a ms-contratos (los contratos de las cuentas vencidas, POR
 *   IDENTIFICADOR y en lote). UNA.
 *
 * Eran DOS cada uno hasta el paso 6e: la segunda iba a ms-identidad, a por las
 * direcciones de correo. Ha desaparecido porque los eventos NO LLEVAN direcciones de
 * correo — llevan el `id_usuario`, y quien resuelve el destinatario es
 * ms-notificaciones. La regla que existia por propiedad del dato resulta que tambien
 * le quita un salto de red al barrido.
 *
 * La forma de romper la garantia seria pedir el contrato dentro del bucle, que
 * es exactamente lo que `porIds` existe para evitar. La prueba lo comprueba.
 *
 * ── Y CON ELLO DESAPARECE LA DEGRADACION QUE HABIA QUE EXPLICAR ────────────
 *
 * Hasta el paso 6e este archivo documentaba que si ms-identidad no respondia, el
 * aviso se omitia y el barrido seguia facturando: degradar era lo correcto porque
 * avisar es lo accesorio de un proceso que existe para facturar.
 *
 * Ese caso ya no existe. El aviso no necesita a nadie para anotarse, asi que no hay
 * nada que degradar: o la transaccion escribe la cuenta y su evento, o no escribe
 * ninguna de las dos cosas. La decision de si el correo es prescindible se ha mudado
 * al sitio donde se puede tomar bien — ms-notificaciones, que si depende de
 * ms-identidad para resolver el destinatario y que ante un fallo devuelve 500 para
 * que el evento se reintente en vez de perderse.
 *
 * Lo que SI sigue igual: si ms-contratos no responde, el barrido no genera NADA.
 * Generar la mitad de las cuentas del mes seria peor que no generar ninguna, porque al
 * dia siguiente el motor no sabria cuales faltan, y con la comprobacion de duplicados
 * que ya hay, no generar nada hoy se arregla solo mañana.
 *
 * ── LAS FECHAS SON DE BOGOTA, NO DEL SERVIDOR ──────────────────────────────
 *
 * El paso 6c lo cerro: el motor no compara contra `new Date()` local sino contra
 * `hoyEnZonaNegocio()`, y `diasEntre()` cuenta dias de calendario en vez de
 * intervalos de 24 horas. Quien decide que un arriendo entro en mora al sexto
 * dia lo hace en Bogota; en un contenedor en UTC el corte se adelantaria cinco
 * horas.
 *
 * NO hay intereses ni recargos, y no los va a haber por esta via: RF-12 es
 * alertas de vencimiento, no cobro de mora.
 *
 * ── EL CRON NO DISPARA SI EL CONTENEDOR ESTA APAGADO ───────────────────────
 *
 * Ver `iniciarMotorFinanciero()`. Es una limitacion conocida y bloqueante para
 * produccion, anotada en `docs/adr/0018`.
 */

import cron from 'node-cron';
import { Op } from 'sequelize';
import {
  diaDeCorte,
  diasEntre,
  hoyEnZonaNegocio,
  mesSiguiente,
  partesDeISO,
  periodoDeCorte,
  periodoQueEmpiezaEn,
  soloFecha,
  sumarDias,
} from 'arriendos360-shared';
import type { Periodo } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { contratosConEstado, porIds as contratosPorIds } from '../clientes/contratos';
import { CuentaCobro } from '../models/CuentaCobro';
import {
  ESTADO_CONTRATO_ACTIVO,
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
} from '../models/constantes';
import {
  registrarCuentaCobroEnMora,
  registrarCuentaCobroPorVencer,
} from '../eventos/salida';
import { emitirCuentaCobro } from './cuentas';

/**
 * Dias desde el corte a partir de los cuales una cuenta esta EN MORA.
 *
 * ── ESTA CONSTANTE CIERRA UNA TRAMPA QUE CLAUDE.md TENIA ANOTADA ───────────
 *
 * «Un contrato de 16 lineas de mora no existe: `verificar-mora` y el motor no
 * aplican la misma regla». El endpoint manual marcaba EN_MORA con que el corte
 * hubiera pasado un solo dia; este barrido espera al sexto. Las dos reglas
 * vivian en dos archivos y nada las ataba.
 *
 * Ahora es un numero, exportado, y lo usan los dos: este barrido y
 * `verificarMora` en `controllers/pago.controller.ts`. Cambiar el periodo de
 * gracia es cambiarlo aqui.
 */
export const DIAS_PARA_MORA = 6;

/**
 * Dias desde el corte en que se avisa de que el plazo se acaba.
 *
 * Uno antes de que expire la gracia, de ahi que sea `DIAS_PARA_MORA - 2`: el
 * aviso sale el cuarto dia y la mora entra al sexto, asi que entre el uno y la
 * otra hay un dia entero para pagar. Escrito en funcion de la otra constante
 * para que mover el periodo de gracia mueva el aviso con el.
 */
export const DIAS_AVISO_PREVIO = DIAS_PARA_MORA - 2;

/**
 * El dia en que una cuenta con este corte pasaria a EN_MORA.
 *
 * Es `DIAS_PARA_MORA` dias de calendario despues del corte, calculado con la misma
 * constante que decide la mora: si mañana el periodo de gracia cambia, la fecha que
 * anuncia el aviso cambia con el. Escribirla como un numero aparte habria sido la
 * forma de que un dia dijeran cosas distintas, que es la trampa que `DIAS_PARA_MORA`
 * vino a cerrar.
 *
 * Lo consume `CuentaCobroPorVencer`, que lleva una FECHA y no un «mañana». Ver la
 * cabecera del tipo en `packages/shared/src/eventos.ts`.
 */
export const diaDeMora = (inicio: string): string => sumarDias(inicio, DIAS_PARA_MORA);

/** El concepto que se imprime en la cuenta de cobro. */
export const detalleDelPeriodo = (periodo: Periodo): string =>
  `Canon de arrendamiento del ${periodo.inicio} al ${periodo.fin}`;

/**
 * El periodo que le toca facturar hoy a un contrato con este dia de corte.
 *
 * Reproduce exactamente la decision que tomaba la version anterior con
 * aritmetica de `Date`, solo que sobre componentes de calendario:
 *
 *   - se parte del corte de ESTE mes;
 *   - si hoy ya paso de ese dia por mas de dos, el que toca es el del mes que
 *     viene (si hoy es 25 y el corte es 5, la proxima factura es la de junio,
 *     no la de mayo, que ya esta).
 *
 * @param diaCorte dia pactado, 1-31
 * @param hoy `YYYY-MM-DD` en la zona del negocio
 */
export const periodoAFacturar = (diaCorte: number, hoy: string): Periodo => {
  const { anio, mes, dia } = partesDeISO(hoy);

  if (dia > diaCorte + 2) {
    const siguiente = mesSiguiente(anio, mes);
    return periodoDeCorte(diaCorte, siguiente.anio, siguiente.mes);
  }

  return periodoDeCorte(diaCorte, anio, mes);
};

/**
 * El PRIMER periodo del contrato: el que arranca en su fecha de inicio de corte.
 *
 * Es el que crea el consumidor de `ContratoFormalizado`, y por eso el barrido lo
 * salta. Se calcula igual que alli —`periodoDeCorte()` sobre los componentes de
 * `fecha_inicio_corte`— para que las dos mitades no puedan discrepar: si una
 * usara el dia pactado y la otra el dia recortado, un contrato con corte el 31
 * firmado en enero tendria dos «primeros periodos» distintos y el motor
 * duplicaria la factura de febrero.
 */
export const primerPeriodoDe = (fechaInicioCorte: unknown): Periodo | null => {
  const fecha = soloFecha(fechaInicioCorte);
  const dia = diaDeCorte(fecha);

  return fecha === null || dia === null ? null : periodoQueEmpiezaEn(fecha, dia);
};

/**
 * RF-11: generacion automatica de recibos, DE LOS MESES SIGUIENTES.
 * Regla: 2 dias antes de la fecha de corte (aniversario).
 *
 * La cuenta de cobro nace con el PERIODO EXPLICITO, no con un mes suelto: `fin`
 * es el dia anterior al siguiente corte, de modo que los periodos teselan el
 * calendario sin huecos ni solapes. La regla esta en `periodoDeCorte()`, en
 * `packages/shared`.
 */
export const procesarContratos = async (): Promise<void> => {
  try {
    const hoy = hoyEnZonaNegocio();

    // UNA peticion para todos los contratos activos del sistema, con su
    // inmueble dentro. Si no responde, el `catch` de abajo lo registra y este
    // barrido no genera nada. Ver la nota sobre degradacion de la cabecera.
    const contratos = await contratosConEstado(ESTADO_CONTRATO_ACTIVO, { conInmueble: true });

    // Y NO hay segundo viaje. Hasta el paso 6e habia una llamada a ms-identidad aqui
    // para conseguir la direccion de correo del inquilino; los eventos llevan el
    // `id_usuario`, asi que ya no hace falta.
    for (const contrato of contratos) {
      const fechaInicioCorte = contrato.fecha_inicio_corte;

      // El dia de corte sale de SU COLUMNA, no de recalcularlo desde el inicio
      // del contrato. Es la diferencia que trajo el paso 6a: si alguien
      // renegocia el ciclo de facturacion, el motor lo respeta.
      const diaCorte = diaDeCorte(fechaInicioCorte);
      if (diaCorte === null) {
        continue;
      }

      const periodo = periodoAFacturar(diaCorte, hoy);

      // ¿Estamos dentro de la ventana de 2 dias antes del corte? ¿O el corte ya
      // llego y no se ha cobrado?
      if (diasEntre(hoy, periodo.inicio) > 2) {
        continue;
      }

      // EL PRIMER PERIODO ES DEL CONSUMIDOR DEL EVENTO, no de este barrido. Se
      // salta SIEMPRE, exista ya la cuenta o no: ver la cabecera.
      const primero = primerPeriodoDe(fechaInicioCorte);
      if (primero && primero.inicio === periodo.inicio) {
        continue;
      }

      // La comprobacion es una igualdad sobre `inicio` en vez de un `date_part`
      // sobre el mes: identifica el periodo exacto y ademas puede usar el indice
      // unico que lo respalda.
      const yaExiste = await CuentaCobro.findOne({
        where: { id_contrato: contrato.id_contrato, inicio: periodo.inicio },
      });

      if (yaExiste) {
        continue;
      }

      // La cuenta y su aviso, en una transaccion y por el UNICO camino que las
      // crea. El correo ya no se manda desde aqui: `emitirCuentaCobro` anota
      // `CuentaCobroGenerada` en la tabla de salida y ms-notificaciones decide a
      // quien avisar. Ver `services/cuentas.ts`.
      await emitirCuentaCobro({
        id_contrato: contrato.id_contrato,
        id_inquilino: contrato.id_inquilino,
        detalle: detalleDelPeriodo(periodo),
        valor: contrato.canon,
        inicio: periodo.inicio,
        fin: periodo.fin,
      });

      console.log(
        `✅ Cuenta de cobro generada para contrato ${contrato.id_contrato}` +
          ` — periodo ${periodo.inicio} a ${periodo.fin}`,
      );
    }
  } catch (error) {
    console.error('❌ Error en procesarContratos:', error);
  }
};

/**
 * Los estados de una cuenta que todavia puede entrar en mora: debe algo y aun no
 * esta en mora.
 *
 * ── `PARCIAL` ESTA AQUI, Y DURANTE SIETE TRAMOS NO ESTUVO ──────────────────
 *
 * El barrido original filtraba `estado IN (1, 3)` —pendiente y en mora— y la
 * traduccion al catalogo lo conservo tal cual. El efecto era que una cuenta que
 * recibia un abono antes del sexto dia pasaba a `PARCIAL` y salia del motor para
 * siempre: debia el resto, el corte vencia y nunca entraba en mora. Bastaba abonar
 * un peso a tiempo.
 *
 * La regla es la del saldo, no la del historial: **una cuenta con saldo mayor que
 * cero y el corte vencido entra en mora, haya recibido abonos o no.** `PARCIAL`
 * siempre tiene saldo —`estadoSegunSaldo` la pasa a `PAGADA` al llegar a cero—, asi
 * que no hace falta mirarlo aparte. `EN_MORA` no esta porque ya lo esta, y que no
 * este es lo que impide que un segundo barrido repita el aviso.
 *
 * La usan este barrido y `verificarMora`, igual que `DIAS_PARA_MORA`, para que las
 * dos reglas no vuelvan a separarse. Ver la correccion en `docs/adr/0018`.
 */
export const ESTADOS_QUE_ENTRAN_EN_MORA: readonly string[] = [
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_CUENTA_PARCIAL,
];

const puedeEntrarEnMora = (estado: string): boolean => ESTADOS_QUE_ENTRAN_EN_MORA.includes(estado);

/**
 * Control de dias de gracia (requisito por confirmar en el SRS).
 * RF-12: alertas de vencimiento y vencido.
 *
 * Barre las cuentas que pueden entrar en mora (`ESTADOS_QUE_ENTRAN_EN_MORA`) y las
 * `EN_MORA`, que ya estaban en el filtro y ninguna rama de abajo modifica.
 *
 * Los dias se cuentan desde `inicio`, que es la fecha de corte y es exactamente
 * lo que guardaba `mes_correspondiente`.
 */
export const procesarPagos = async (): Promise<void> => {
  try {
    const hoy = hoyEnZonaNegocio();

    const cuentasPendientes = await CuentaCobro.findAll({
      where: {
        estado: { [Op.in]: [...ESTADOS_QUE_ENTRAN_EN_MORA, ESTADO_CUENTA_EN_MORA] },
      },
    });

    // Los contratos de todas las cuentas del barrido en UNA peticion, por
    // identificador y con su inmueble dentro. No uno por cuenta. Y NO hay segundo
    // viaje a ms-identidad: lo que hacia falta de alli eran las direcciones de
    // correo, y los eventos llevan el `id_usuario`.
    const contratos = await contratosPorIds(
      cuentasPendientes.map((cuenta) => cuenta.id_contrato),
      { conInmueble: true },
    );

    for (const cuenta of cuentasPendientes) {
      const contrato = contratos.get(cuenta.id_contrato);
      if (!contrato) {
        continue;
      }

      const idInquilino = contrato.id_inquilino;
      const inmueble = contrato.Inmueble ?? null;

      const diasDesdeCorte = diasEntre(cuenta.inicio, hoy);

      // Lo que las dos ramas de abajo necesitan del inmueble. Si ms-contratos no lo
      // compuso no hay a quien avisar por el lado del propietario, asi que el aviso
      // se omite entero: un evento con `id_propietario` vacio acabaria apartado tras
      // diez intentos sin que nadie pueda arreglarlo reintentando.
      const puedeAvisar = Boolean(idInquilino && inmueble?.id_propietario);

      if (!puedeAvisar) {
        console.warn(
          `⚠️  ms-financiero: cuenta ${cuenta.id_cuenta_cobro} sin inquilino o sin inmueble ` +
            'compuesto: no se anuncia su aviso. Se sigue evaluando la mora.',
        );
      }

      const partes = {
        id_cuenta_cobro: cuenta.id_cuenta_cobro,
        id_contrato: cuenta.id_contrato,
        id_inquilino: idInquilino as string,
        // Foto del momento del hecho, no una denormalizacion: si el inmueble cambia
        // de dueño manaña, este aviso seguira diciendo a quien se le avisó hoy. La
        // distincion importa porque `docs/adr/0017` prohibe guardar este dato
        // cuando se usa para AUTORIZAR, y aqui solo se usa para avisar.
        id_propietario: inmueble?.id_propietario as string,
        valor: Number(cuenta.valor),
        inicio: cuenta.inicio,
        fin: cuenta.fin,
        direccion_inmueble: inmueble?.direccion ?? 'Inmueble sin dirección registrada',
      };

      // RF-12: vencimiento proximo (2 dias antes de que expire el tiempo de gracia).
      //
      // La igualdad exacta NO es una comodidad: es lo que hace que el aviso sea de un
      // dia y no de todos los que quedan. Y ademas es lo unico que impide el aviso
      // repetido, porque esta rama no cambia nada en la base — no hay estado que haga
      // de bitacora, al contrario que en la de la mora. Ver `eventos/salida.ts`.
      //
      // Se avisa tambien a una cuenta PARCIAL: si va a entrar en mora dentro de dos
      // dias, tiene el mismo derecho a enterarse que una que no ha abonado nada.
      if (diasDesdeCorte === DIAS_AVISO_PREVIO && puedeEntrarEnMora(cuenta.estado)) {
        if (puedeAvisar) {
          // UN evento para las DOS partes. Quien decide que al inquilino se le habla
          // de «tu pago» y al propietario de «el pago del inmueble X» es
          // ms-notificaciones: el emisor anuncia un hecho, no una lista de correos.
          await sequelize.transaction((transaccion) =>
            registrarCuentaCobroPorVencer(
              { ...partes, entra_en_mora_el: diaDeMora(cuenta.inicio) },
              transaccion,
            ),
          );
        }
      }

      // Cambio a mora. La MISMA constante que aplica `verificarMora`, que es lo
      // que cierra la trampa de las dos reglas distintas.
      if (diasDesdeCorte >= DIAS_PARA_MORA && puedeEntrarEnMora(cuenta.estado)) {
        // El UPDATE y su aviso van en UNA transaccion: no puede haber una mora sin
        // aviso ni un aviso sin mora. Y como la condicion exige que venga de
        // `PENDIENTE` o `PARCIAL`, una segunda pasada no vuelve a cambiar el estado y
        // por tanto tampoco vuelve a anotar el evento — el estado de la cuenta hace de
        // bitacora.
        await sequelize.transaction(async (transaccion) => {
          await cuenta.update(
            { estado: ESTADO_CUENTA_EN_MORA },
            { transaction: transaccion } as never,
          );

          if (puedeAvisar) {
            await registrarCuentaCobroEnMora(
              { ...partes, dias_de_mora: diasDesdeCorte },
              transaccion,
            );
          }
        });

        console.log(`🚫 Cuenta de cobro ${cuenta.id_cuenta_cobro} marcada como EN MORA`);
      }
    }
  } catch (error) {
    console.error('❌ Error en procesarPagos:', error);
  }
};

/**
 * Programa el barrido diario.
 *
 * ── ESTO NO DISPARA SI EL CONTENEDOR ESTA APAGADO, Y ES UN PROBLEMA REAL ────
 *
 * `node-cron` es un temporizador DENTRO del proceso. Funciona mientras el
 * proceso vive, y eso hoy es cierto —Compose mantiene el contenedor en pie— pero
 * deja de serlo en el destino del paso 8: Azure Container Apps escala a cero
 * cuando no hay trafico. Un contenedor dormido a las 00:01 no genera las cuentas
 * de cobro de ese dia, y nadie se entera hasta que un inquilino pregunta por su
 * recibo.
 *
 * No se arregla aqui. La salida es un **trabajo programado de Container Apps**
 * (un `Job` con `triggerType: Schedule`), que levanta un contenedor a la hora
 * pactada, ejecuta `npm run motor` y se apaga. El codigo ya esta listo para eso:
 * `scripts/motor.ts` hace exactamente ese barrido y no depende de que la API
 * este escuchando.
 *
 * Queda como decision abierta MARCADA COMO BLOQUEANTE PARA PRODUCCION en
 * CLAUDE.md y en `docs/adr/0018`. Mantener `node-cron` mientras tanto es lo
 * correcto: es lo que hace el motor demostrable en la defensa sin desplegar
 * nada, y su sustituto no es codigo sino infraestructura.
 */
export const iniciarMotorFinanciero = (): void => {
  // Ejecutar cada dia a la medianoche (00:01).
  cron.schedule('1 0 * * *', () => {
    void (async () => {
      console.log('⏳ Iniciando proceso diario del Motor Financiero...');
      await procesarContratos();
      await procesarPagos();
    })();
  });
  console.log('🚀 Motor Financiero programado (ejecución diaria)');
  console.warn(
    '⚠️  ms-financiero: el cron vive DENTRO del proceso. Con scale-to-zero no dispara. ' +
      'Ver docs/adr/0018.',
  );
};
