-- ============================================================
--  Esquema de base de datos · Gestión de Alumnos · v2
--  PostgreSQL 13+
--  Para INSTALACIONES NUEVAS. Si ya tenés datos, usá migration_v2.sql.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
--  TABLA: administradores
-- ============================================================
CREATE TABLE IF NOT EXISTS administradores (
    id              SERIAL          PRIMARY KEY,
    usuario         VARCHAR(64)     NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    nombre          VARCHAR(120),
    activo          BOOLEAN         NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    ultimo_acceso   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_admin_usuario ON administradores(usuario);

-- ============================================================
--  TABLA: alumnos
-- ============================================================
CREATE TABLE IF NOT EXISTS alumnos (
    id                  SERIAL          PRIMARY KEY,
    nombre              VARCHAR(120)    NOT NULL,
    cedula              VARCHAR(30),
    email               VARCHAR(120),
    telefono            VARCHAR(30),
    tutor_nombre        VARCHAR(120),
    tutor_telefono      VARCHAR(30),
    tutor_email         VARCHAR(120),
    monto_mensual       NUMERIC(14, 2)  NOT NULL CHECK (monto_mensual > 0),
    estado              VARCHAR(20)     NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo', 'retirado', 'egresado', 'suspendido')),
    fecha_alta          DATE            NOT NULL DEFAULT CURRENT_DATE,
    fecha_baja          DATE,
    motivo_baja         TEXT,
    creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alumnos_nombre   ON alumnos(LOWER(nombre));
CREATE INDEX IF NOT EXISTS idx_alumnos_cedula   ON alumnos(cedula);
CREATE INDEX IF NOT EXISTS idx_alumnos_estado   ON alumnos(estado);

-- ============================================================
--  TABLA: cuotas
-- ============================================================
CREATE TABLE IF NOT EXISTS cuotas (
    id                  SERIAL          PRIMARY KEY,
    alumno_id           INTEGER         NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
    concepto            VARCHAR(100)    NOT NULL DEFAULT 'Cuota mensual',
    periodo             VARCHAR(7),     -- YYYY-MM, NULL para conceptos no recurrentes
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

-- ============================================================
--  TRIGGERS · actualizado_en
-- ============================================================
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

-- ============================================================
--  VISTA: cuotas con estado calculado
-- ============================================================
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

-- ============================================================
--  USUARIO ADMIN INICIAL  (clave: admin123 — cambiar en producción)
-- ============================================================
INSERT INTO administradores (usuario, password_hash, nombre)
VALUES (
    'admin',
    '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
    'Administrador'
)
ON CONFLICT (usuario) DO NOTHING;
