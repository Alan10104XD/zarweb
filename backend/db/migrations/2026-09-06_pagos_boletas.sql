-- ============================================================
--  Boletas (recibos) de pago
--  Agrega a `pagos`:
--    - recibo_numero      correlativo único e inmutable
--    - recibo_token       token del link público de la boleta
--    - recibo_emitido_en  cuándo se generó ese link por primera vez
--
--  El correlativo se asigna solo, al insertar el pago, desde la
--  secuencia seq_recibo_numero. Los pagos que ya existían se
--  numeran por orden cronológico.
--
--  ANTES de correr:
--      sudo -u postgres pg_dump gestion_alumnos > backup_pre_boletas.sql
--
--  Ejecutar:
--      sudo -u postgres psql -d gestion_alumnos -f 2026-09-06_pagos_boletas.sql
-- ============================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS seq_recibo_numero START 1;

ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS recibo_numero     INTEGER,
    ADD COLUMN IF NOT EXISTS recibo_token      VARCHAR(64),
    ADD COLUMN IF NOT EXISTS recibo_emitido_en TIMESTAMPTZ;

-- Numerar los pagos históricos siguiendo la fecha real de pago
WITH ordenados AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY fecha_pago, id) AS rn
      FROM pagos
     WHERE recibo_numero IS NULL
)
UPDATE pagos p
   SET recibo_numero = o.rn
  FROM ordenados o
 WHERE p.id = o.id;

-- La secuencia arranca después del último número ya usado
SELECT setval(
    'seq_recibo_numero',
    COALESCE((SELECT MAX(recibo_numero) FROM pagos), 0) + 1,
    false
);

ALTER TABLE pagos ALTER COLUMN recibo_numero SET DEFAULT nextval('seq_recibo_numero');
ALTER TABLE pagos ALTER COLUMN recibo_numero SET NOT NULL;
ALTER SEQUENCE seq_recibo_numero OWNED BY pagos.recibo_numero;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_recibo_numero ON pagos(recibo_numero);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_recibo_token  ON pagos(recibo_token);

GRANT ALL ON ALL TABLES    IN SCHEMA public TO zarweb_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO zarweb_app;
GRANT USAGE                ON SCHEMA public TO zarweb_app;

COMMIT;

-- Verificación rápida después:
--   \d pagos
--   SELECT id, fecha_pago, monto, recibo_numero FROM pagos ORDER BY recibo_numero LIMIT 10;
--   SELECT last_value FROM seq_recibo_numero;
