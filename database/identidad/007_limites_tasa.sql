-- Contadores de limitación de tasa de MS-Identidad — Arriendos360
--
-- Frenan la fuerza bruta contra las cuatro rutas públicas del servicio: login,
-- registro, recuperación y restablecimiento. Ver `docs/adr/0020` y
-- `services/ms-identidad/src/services/limites.ts`.
--
-- ── TABLA OPERATIVA, NO DE DOMINIO ──────────────────────────────────────────
--
-- De la misma familia que `eventos_salida` o `tokens_revocados`: infraestructura
-- interna del servicio, no un concepto del negocio. No amplía el modelo canónico
-- del Capítulo 2 y no se tramita como desviación.
--
-- ── UNLOGGED, A PROPÓSITO ───────────────────────────────────────────────────
--
-- Sin escritura en el registro de transacciones: cada intento de login escribe
-- aquí, y no hay motivo para pagar durabilidad por un contador que caduca en una
-- hora como mucho. Si PostgreSQL se cae sin apagarse bien, la tabla vuelve vacía y
-- los contadores empiezan de cero. Es aceptable: se pierde, como mucho, una ventana.
--
-- ── UNA FILA POR CLAVE Y VENTANA ────────────────────────────────────────────
--
-- `clave` es el nombre del límite más el SHA-256 de lo que se cuenta —la IP
-- agrupada, el correo normalizado—: ni correos ni IP en claro. `ventana` es el
-- inicio de la ventana fija. El incremento es una sola sentencia
-- `INSERT … ON CONFLICT DO UPDATE … RETURNING`, atómica aunque haya varias réplicas
-- del servicio contando a la vez.

CREATE UNLOGGED TABLE IF NOT EXISTS identidad.limites_tasa (
    clave    VARCHAR(100) NOT NULL,
    ventana  TIMESTAMPTZ  NOT NULL,
    cuenta   INTEGER      NOT NULL DEFAULT 0,
    PRIMARY KEY (clave, ventana)
);

-- Para la purga de ventanas vencidas.
CREATE INDEX IF NOT EXISTS idx_limites_tasa_ventana
    ON identidad.limites_tasa (ventana);
