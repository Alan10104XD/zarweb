# Gestión de Alumnos · Backend

API REST en **FastAPI** + **PostgreSQL**, todo en un solo archivo (`api.py`).

## Estructura

```
backend/
├── api.py                 # ← TODO el backend en un archivo
├── db/
│   ├── schema.sql         # tablas, índices, trigger, vista, admin inicial
│   └── seed.sql           # datos de ejemplo
├── requirements.txt
├── .env.example
└── README.md
```

`api.py` contiene, en este orden:

1. **Settings** — variables de entorno (`pydantic-settings`)
2. **Engine + Session** de SQLAlchemy
3. **Modelos ORM** — `Administrador`, `Alumno`
4. **Schemas Pydantic** — request/response
5. **Seguridad** — bcrypt + JWT, dependencia `get_current_admin`
6. **Endpoints** — `/api/health`, `/api/auth/login`, `/api/alumnos/*`

## 1. Crear la base de datos en PostgreSQL

```bash
psql -U postgres -c "CREATE DATABASE gestion_alumnos ENCODING 'UTF8' TEMPLATE template0;"
psql -U postgres -d gestion_alumnos -f db/schema.sql
psql -U postgres -d gestion_alumnos -f db/seed.sql   # opcional
```

> El `schema.sql` ya inserta el admin inicial: **usuario `admin` / clave `admin123`**.
> Cambiar la clave en producción con un `UPDATE administradores SET password_hash = ...`.

## 2. Configurar el entorno Python

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/Mac

pip install -r requirements.txt
copy .env.example .env         # Linux/Mac: cp .env.example .env
# editar .env con tu DATABASE_URL y SECRET_KEY
```

Generar una `SECRET_KEY` segura:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 3. Levantar el servidor

```bash
uvicorn api:app --reload --port 8000
```

- API:        `http://localhost:8000`
- Docs:       `http://localhost:8000/docs`     (Swagger UI)
- Redoc:      `http://localhost:8000/redoc`
- Health:     `http://localhost:8000/api/health`

## Endpoints

| Método | Ruta                          | Descripción                            | Auth |
|--------|-------------------------------|----------------------------------------|------|
| POST   | `/api/auth/login`             | Login → devuelve JWT                   | No   |
| GET    | `/api/alumnos`                | Listar (filtros: `?search=`, `?estado=`)| Sí  |
| GET    | `/api/alumnos/stats`          | Conteos + monto total                  | Sí   |
| GET    | `/api/alumnos/{id}`           | Obtener uno                            | Sí   |
| POST   | `/api/alumnos`                | Crear                                  | Sí   |
| PUT    | `/api/alumnos/{id}`           | Actualizar                             | Sí   |
| DELETE | `/api/alumnos/{id}`           | Eliminar                               | Sí   |

`estado` ∈ `vencido` | `proximo` | `al_dia`

## Cómo autenticar requests

```http
POST /api/auth/login
Content-Type: application/json

{ "usuario": "admin", "password": "admin123" }
```

Respuesta:

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "expires_in": 28800,
  "usuario": "admin"
}
```

Luego, en cada request:

```
Authorization: Bearer eyJhbGciOi...
```

## Generar nuevos hashes bcrypt

```bash
python -c "from passlib.hash import bcrypt; print(bcrypt.hash('mi-clave'))"
```
