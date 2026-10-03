-- ============================================================
--  Migración v2 → v3 · Gestión de Alumnos
--  - Crea tabla `pagos` (registros simples de pagos hechos)
--  - Migra cuotas pagadas → pagos (pierde las cuotas no pagadas)
--  - Elimina tabla `cuotas` y vista `v_cuotas_estado`
--  - Simplifica estado del alumno: 'activo' | 'inactivo'
--    (retirado/egresado/suspendido → inactivo)
--
--  ANTES de correr:
--      sudo -u postgres pg_dump gestion_alumnos > backup_pre_v3.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1 · Crear tabla pagos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
    id              SERIAL          PRIMARY KEY,
    alumno_id       INTEGER         NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
    fecha_pago      DATE            NOT NULL DEFAULT CURRENT_DATE,
    monto           NUMERIC(14, 2)  NOT NULL CHECK (monto > 0),
    concepto        VARCHAR(100),
    metodo_pago     VARCHAR(30),
    nota            TEXT,
    creado_en       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagos_alumno ON pagos(alumno_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha  ON pagos(fecha_pago);

-- ------------------------------------------------------------
-- 2 · Migrar cuotas pagadas a pagos
--     Sólo migra las que tienen pagado=true y fecha_pago.
--     Las cuotas pendientes se descartan al borrar la tabla.
-- ------------------------------------------------------------
INSERT INTO pagos (alumno_id, fecha_pago, monto, concepto, metodo_pago, nota, creado_en)
SELECT
    alumno_id,
    fecha_pago,
    COALESCE(monto_pagado, monto),
    concepto,
    metodo_pago,
    nota,
    creado_en
FROM cuotas
WHERE pagado = TRUE
  AND fecha_pago IS NOT NULL;

-- ------------------------------------------------------------
-- 3 · Borrar tabla cuotas y vista asociada
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_cuotas_estado;
DROP TABLE IF EXISTS cuotas;

-- ------------------------------------------------------------
-- 4 · Simplificar estado de alumnos
-- ------------------------------------------------------------
UPDATE alumnos
   SET estado = 'inactivo'
 WHERE estado IN ('retirado', 'egresado', 'suspendido');

ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS ck_alumnos_estado;
ALTER TABLE alumnos
    ADD CONSTRAINT ck_alumnos_estado
    CHECK (estado IN ('activo', 'inactivo'));

-- ------------------------------------------------------------
-- 5 · Trigger para actualizado_en en pagos
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_pagos_actualizado_en ON pagos;
CREATE TRIGGER trg_pagos_actualizado_en
BEFORE UPDATE ON pagos
FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- ------------------------------------------------------------
-- 6 · Permisos al usuario de la app
-- ------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO zarweb_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO zarweb_app;
GRANT USAGE                ON SCHEMA public TO zarweb_app;

COMMIT;

-- Verificación rápida después:
--   \d alumnos
--   \d pagos
--   SELECT estado, COUNT(*) FROM alumnos GROUP BY estado;
--   SELECT COUNT(*) FROM pagos;
