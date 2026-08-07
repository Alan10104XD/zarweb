-- 2026-08-07 · Campo "observaciones" en alumnos. APLICADA en producción.
--   psql -U <usuario> -d <base> -f 2026-08-07_alumnos_observaciones.sql

ALTER TABLE alumnos
    ADD COLUMN IF NOT EXISTS observaciones TEXT;
