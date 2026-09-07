# database/

Migraciones y seeds versionados, una carpeta por esquema (un esquema por servicio sobre
una unica instancia de PostgreSQL).

Todavia vacio: el paso 1 de la migracion solo reorganiza la estructura. El DDL actual
sigue en `apps/gateway/database/schema.sql` y el monolito aun crea las tablas con
`sequelize.sync()` al arrancar. Reemplazar por migraciones aqui antes de desplegar en
Azure (ver "Trampas conocidas" en `CLAUDE.md`).
