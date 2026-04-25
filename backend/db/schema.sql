-- ============================================================
--  Esquema de base de datos · Gestión de Alumnos
--  PostgreSQL 13+
-- ============================================================

-- Crear la base de datos (ejecutar como superusuario, fuera de psql en \c)
-- CREATE DATABASE gestion_alumnos
--   WITH ENCODING 'UTF8'
--        LC_COLLATE = 'Spanish_Paraguay.1252'
--        LC_CTYPE   = 'Spanish_Paraguay.1252'
--        TEMPLATE   = template0;

-- Conectar:  \c gestion_alumnos

-- ============================================================
--  EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, crypt

-- ============================================================
--  TABLA: administradores
--  Usuarios que pueden iniciar sesión en el panel
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
--  Registro de alumnos y su estado de pago
-- ============================================================
CREATE TABLE IF NOT EXISTS alumnos (
    id                  SERIAL          PRIMARY KEY,
    nombre              VARCHAR(120)    NOT NULL,
    cedula              VARCHAR(30),
    monto               NUMERIC(14, 2)  NOT NULL CHECK (monto > 0),
    fecha_vencimiento   DATE            NOT NULL,
    creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alumnos_fecha_venc ON alumnos(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_alumnos_nombre     ON alumnos(LOWER(nombre));
CREATE INDEX IF NOT EXISTS idx_alumnos_cedula     ON alumnos(cedula);

-- ============================================================
--  TRIGGER: mantener actualizado_en al día
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
FOR EACH ROW
EXECUTE FUNCTION fn_set_actualizado_en();

-- ============================================================
--  VISTA: alumnos con estado calculado
--  Útil para reportes y consultas externas
-- ============================================================
CREATE OR REPLACE VIEW v_alumnos_estado AS
SELECT
    a.id,
    a.nombre,
    a.cedula,
    a.monto,
    a.fecha_vencimiento,
    a.creado_en,
    a.actualizado_en,
    (a.fecha_vencimiento - CURRENT_DATE) AS dias_hasta_vencimiento,
    CASE
        WHEN a.fecha_vencimiento <  CURRENT_DATE                  THEN 'vencido'
        WHEN a.fecha_vencimiento <= CURRENT_DATE + INTERVAL '5 day' THEN 'proximo'
        ELSE 'al_dia'
    END AS estado
FROM alumnos a;

-- ============================================================
--  USUARIO ADMINISTRADOR INICIAL
--  Contraseña: admin123  (hash bcrypt — cambiar en producción)
--  Generado con: passlib.hash.bcrypt.hash("admin123")
-- ============================================================
INSERT INTO administradores (usuario, password_hash, nombre)
VALUES (
    'admin',
    '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
    'Administrador'
)
ON CONFLICT (usuario) DO NOTHING;
