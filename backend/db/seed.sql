-- ============================================================
--  Datos de ejemplo (opcional)
--  Ejecutar después de schema.sql:  psql -d gestion_alumnos -f db/seed.sql
-- ============================================================

INSERT INTO alumnos (nombre, cedula, monto, fecha_vencimiento) VALUES
  ('María Fernández González',  '1.234.567', 500000, CURRENT_DATE - INTERVAL '3 day'),
  ('Carlos Benítez Rojas',      '2.345.678', 750000, CURRENT_DATE + INTERVAL '2 day'),
  ('Ana Sofía Caballero',       '3.456.789', 600000, CURRENT_DATE + INTERVAL '15 day'),
  ('Diego Insfrán',             NULL,        450000, CURRENT_DATE - INTERVAL '10 day'),
  ('Lucía Bogarín Vera',        '4.567.890', 800000, CURRENT_DATE + INTERVAL '4 day'),
  ('Rodrigo Martínez',          '5.678.901', 550000, CURRENT_DATE + INTERVAL '30 day');
