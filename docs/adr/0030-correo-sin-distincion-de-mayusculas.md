# ADR 0030 — Correo sin distinción de mayúsculas

- **Estado:** aceptada. Sustituye el punto 5 de `docs/adr/0024`.
- **Fecha:** 2026-11-02
- **Se aparta del Capítulo 2:** no.

## Contexto

`POST /api/auth/login` comparaba el correo exacto: quien se registró como `Ana@Correo.com` recibía 401 si
escribía `ana@correo.com`, con la contraseña correcta. Lo mismo pasaba en la recuperación, y las altas
permitían dos cuentas que sólo difirieran en mayúsculas. `docs/adr/0024` estimó que corregirlo obligaba a
reescribir las filas existentes; no hace falta.

## Decisión

1. **Se compara con `lower()` a los dos lados, en SQL**, en el login, la recuperación y la comprobación de
   duplicado de las altas. Una sola función decide la igualdad, también fuera de ASCII.
2. **El correo se guarda como lo escribió la persona.** No se reescribe ninguna fila. Se le muestra y se le
   envía igual que antes.
3. **Un índice único sobre `lower(email)` impide las cuentas repetidas**, y sirve también a la búsqueda. El
   `UNIQUE` exacto se conserva: la migración sólo añade.

## Alternativas descartadas

- **Guardar en minúsculas con un `UPDATE`:** no es aditivo, no se revierte y cambia la dirección visible.
- **`citext`:** exige habilitar una extensión en Azure y cambiar el tipo de la columna.

## Consecuencias

- La migración falla si ya hay dos cuentas que sólo difieren en mayúsculas. Hay que resolverlas antes de
  desplegar:
  `SELECT lower(email), count(*) FROM identidad.usuarios GROUP BY 1 HAVING count(*) > 1;`
- Dos altas simultáneas con el mismo correo y distintas mayúsculas: la segunda responde `500`, no `400`, como
  ya ocurría con el `UNIQUE` exacto. No se pierde integridad.
- Tras un `git revert`, el índice queda y la versión anterior sigue funcionando; responde `500` al dar de alta
  un correo que sólo difiere en mayúsculas. Para volver del todo:
  `DROP INDEX identidad.uq_usuarios_email_sin_mayusculas;`
