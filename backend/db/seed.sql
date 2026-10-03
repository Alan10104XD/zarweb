-- ============================================================
--  Datos de ejemplo (opcional)
--  Ejecutar después de schema.sql:  psql -d gestion_alumnos -f db/seed.sql
-- ============================================================

INSERT INTO alumnos (nombre, cedula, telefono, monto_mensual, fecha_alta) VALUES
  ('María Fernández González',  '1.234.567', '0981 111111', 500000, CURRENT_DATE - INTERVAL '6 month'),
  ('Carlos Benítez Rojas',      '2.345.678', '0982 222222', 750000, CURRENT_DATE - INTERVAL '4 month'),
  ('Ana Sofía Caballero',       '3.456.789', NULL,          600000, CURRENT_DATE - INTERVAL '3 month'),
  ('Diego Insfrán',             NULL,        '0983 333333', 450000, CURRENT_DATE - INTERVAL '8 month'),
  ('Lucía Bogarín Vera',        '4.567.890', '0984 444444', 800000, CURRENT_DATE - INTERVAL '2 month'),
  ('Rodrigo Martínez',          '5.678.901', NULL,          550000, CURRENT_DATE - INTERVAL '1 month');

-- Un pago del mes pasado para los tres primeros
INSERT INTO pagos (alumno_id, fecha_pago, monto, concepto, metodo_pago)
SELECT id, CURRENT_DATE - INTERVAL '1 month', monto_mensual, 'Cuota mensual', 'efectivo'
  FROM alumnos
 WHERE cedula IN ('1.234.567', '2.345.678', '3.456.789');
