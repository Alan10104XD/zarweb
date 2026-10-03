-- 2026-10-03 · Campo "ruc" en alumnos. APLICADA en producción.
--   psql -U <usuario> -d <base> -f 2026-10-03_alumnos_ruc.sql

ALTER TABLE alumnos
    ADD COLUMN IF NOT EXISTS ruc VARCHAR(30);
