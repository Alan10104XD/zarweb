-- ============================================================
--  Esquema de base de datos · Gestión de Alumnos · v4
--  PostgreSQL 13+
--  Para INSTALACIONES NUEVAS. Si ya tenés datos, aplicá en orden
--  migration_v2.sql, migration_v3.sql y migrations/*.sql.
-- ============================================================

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
                        CHECK (estado IN ('activo', 'inactivo')),
    fecha_alta          DATE            NOT NULL DEFAULT CURRENT_DATE,
    fecha_baja          DATE,
    motivo_baja         TEXT,
    observaciones       TEXT,
    creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alumnos_nombre ON alumnos(LOWER(nombre));
CREATE INDEX IF NOT EXISTS idx_alumnos_cedula ON alumnos(cedula);
CREATE INDEX IF NOT EXISTS idx_alumnos_estado ON alumnos(estado);

-- ============================================================
--  TABLA: pagos
--  recibo_numero es el correlativo de la boleta: se asigna solo
--  al insertar y no cambia nunca. recibo_token es el link
--  público, que se genera recién al abrir la boleta.
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS seq_recibo_numero START 1;

CREATE TABLE IF NOT EXISTS pagos (
    id                  SERIAL          PRIMARY KEY,
    alumno_id           INTEGER         NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
    fecha_pago          DATE            NOT NULL DEFAULT CURRENT_DATE,
    monto               NUMERIC(14, 2)  NOT NULL CHECK (monto > 0),
    concepto            VARCHAR(100),
    metodo_pago         VARCHAR(30),
    nota                TEXT,
    recibo_numero       INTEGER         NOT NULL UNIQUE DEFAULT nextval('seq_recibo_numero'),
    recibo_token        VARCHAR(64)     UNIQUE,
    recibo_emitido_en   TIMESTAMPTZ,
    creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagos_alumno ON pagos(alumno_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha  ON pagos(fecha_pago);

ALTER SEQUENCE seq_recibo_numero OWNED BY pagos.recibo_numero;

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

DROP TRIGGER IF EXISTS trg_pagos_actualizado_en ON pagos;
CREATE TRIGGER trg_pagos_actualizado_en
BEFORE UPDATE ON pagos
FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

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
