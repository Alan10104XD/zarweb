-- ============================================================
--  Migración v1 → v2  ·  Gestión de Alumnos
--  Aplica sobre una BD que ya tiene la estructura v1 (alumnos
--  con monto y fecha_vencimiento, sin cuotas, sin estado).
--
--  ANTES de correr:
--      sudo -u postgres pg_dump gestion_alumnos > backup_pre_v2.sql
--
--  Ejecutar:
--      sudo -u postgres psql -d gestion_alumnos -f migration_v2.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0 · Eliminar la vista vieja (depende de columnas que vamos a borrar)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_alumnos_estado;

-- ------------------------------------------------------------
-- 1 · Agregar columnas nuevas a alumnos (todas nullable de entrada)
-- ------------------------------------------------------------
ALTER TABLE alumnos
    ADD COLUMN IF NOT EXISTS email          VARCHAR(120),
    ADD COLUMN IF NOT EXISTS telefono       VARCHAR(30),
    ADD COLUMN IF NOT EXISTS tutor_nombre   VARCHAR(120),
    ADD COLUMN IF NOT EXISTS tutor_telefono VARCHAR(30),
    ADD COLUMN IF NOT EXISTS tutor_email    VARCHAR(120),
    ADD COLUMN IF NOT EXISTS monto_mensual  NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS estado         VARCHAR(20) NOT NULL DEFAULT 'activo',
    ADD COLUMN IF NOT EXISTS fecha_alta     DATE        NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS fecha_baja     DATE,
    ADD COLUMN IF NOT EXISTS motivo_baja    TEXT;

-- Constraint de estado (idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_alumnos_estado') THEN
        ALTER TABLE alumnos ADD CONSTRAINT ck_alumnos_estado
            CHECK (estado IN ('activo', 'retirado', 'egresado', 'suspendido'));
    END IF;
END$$;

-- ------------------------------------------------------------
-- 2 · Crear tabla cuotas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuotas (
    id                  SERIAL          PRIMARY KEY,
    alumno_id           INTEGER         NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
    concepto            VARCHAR(100)    NOT NULL DEFAULT 'Cuota mensual',
    periodo             VARCHAR(7),
    monto               NUMERIC(14, 2)  NOT NULL CHECK (monto > 0),
    fecha_vencimiento   DATE            NOT NULL,
    pagado              BOOLEAN         NOT NULL DEFAULT FALSE,
    fecha_pago          DATE,
    monto_pagado        NUMERIC(14, 2),
    metodo_pago         VARCHAR(30),
    nota                TEXT,
    creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (periodo IS NULL OR periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX IF NOT EXISTS idx_cuotas_alumno       ON cuotas(alumno_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_vencimiento  ON cuotas(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_cuotas_pagado       ON cuotas(pagado);
CREATE INDEX IF NOT EXISTS idx_cuotas_periodo      ON cuotas(periodo);

-- ------------------------------------------------------------
-- 3 · Migrar datos existentes
--     - monto_mensual = monto (la mensualidad de referencia)
--     - crear una cuota por cada alumno con su monto/fecha_venc actuales
-- ------------------------------------------------------------
UPDATE alumnos
   SET monto_mensual = monto
 WHERE monto_mensual IS NULL
   AND monto IS NOT NULL;

INSERT INTO cuotas (alumno_id, concepto, periodo, monto, fecha_vencimiento, pagado)
SELECT
    id,
    'Cuota inicial (migrada)',
    NULL,
    monto,
    fecha_vencimiento,
    FALSE
FROM alumnos
WHERE monto IS NOT NULL
  AND fecha_vencimiento IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM cuotas c WHERE c.alumno_id = alumnos.id
  );

-- ------------------------------------------------------------
-- 4 · Hacer monto_mensual NOT NULL y agregar el CHECK > 0
-- ------------------------------------------------------------
ALTER TABLE alumnos ALTER COLUMN monto_mensual SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_alumnos_monto_mensual') THEN
        ALTER TABLE alumnos ADD CONSTRAINT ck_alumnos_monto_mensual
            CHECK (monto_mensual > 0);
    END IF;
END$$;

-- ------------------------------------------------------------
-- 5 · Eliminar columnas viejas y constraint de la v1
-- ------------------------------------------------------------
ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS ck_alumnos_monto_positivo;
ALTER TABLE alumnos DROP COLUMN IF EXISTS monto;
ALTER TABLE alumnos DROP COLUMN IF EXISTS fecha_vencimiento;

-- ------------------------------------------------------------
-- 6 · Triggers · actualizado_en
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alumnos_actualizado_en ON alumnos;
CREATE TRIGGER trg_alumnos_actualizado_en
BEFORE UPDATE ON alumnos
FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

DROP TRIGGER IF EXISTS trg_cuotas_actualizado_en ON cuotas;
CREATE TRIGGER trg_cuotas_actualizado_en
BEFORE UPDATE ON cuotas
FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- ------------------------------------------------------------
-- 7 · Crear vista nueva
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_cuotas_estado AS
SELECT
    c.*,
    (c.fecha_vencimiento - CURRENT_DATE) AS dias_hasta_vencimiento,
    CASE
        WHEN c.pagado                                                  THEN 'pagado'
        WHEN c.fecha_vencimiento <  CURRENT_DATE                       THEN 'vencido'
        WHEN c.fecha_vencimiento <= CURRENT_DATE + INTERVAL '5 day'    THEN 'proximo'
        ELSE 'al_dia'
    END AS estado_pago
FROM cuotas c;

-- ------------------------------------------------------------
-- 8 · Asegurar permisos al usuario de la app
-- ------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO zarweb_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO zarweb_app;
GRANT USAGE                ON SCHEMA public TO zarweb_app;

COMMIT;

-- ============================================================
-- Verificación rápida (correr separado para confirmar):
--
--   \d alumnos
--   \d cuotas
--   SELECT id, nombre, monto_mensual, estado FROM alumnos LIMIT 5;
--   SELECT alumno_id, concepto, monto, fecha_vencimiento, pagado FROM cuotas LIMIT 5;
-- ============================================================
