# Migraciones

El backend de `api.zarpemos.online` no está en este repo: vive en el servidor,
en `/home/ubuntu/zarweb/backend/`. El `backend/api.py` de acá es una versión
anterior. Cada cambio de esquema hay que aplicarlo a mano allá.

| Fecha | Cambio | Estado |
|---|---|---|
| 2026-08-07 | `observaciones TEXT` en `alumnos` | Aplicada (BD + `api.py` + servicio reiniciado) |
