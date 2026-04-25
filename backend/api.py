"""
Gestión de Alumnos · API
Todo el backend en un solo archivo.

Ejecutar:
    uvicorn api:app --reload --port 8000
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Numeric, String, create_engine,
    func, or_,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, Session, mapped_column, sessionmaker,
)


# ============================================================
#   CONFIGURACIÓN
# ============================================================
class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/gestion_alumnos"

    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    CORS_ORIGINS: str = "http://localhost:5500,http://127.0.0.1:5500"

    DIAS_PROXIMO_VENCER: int = 5

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()


# ============================================================
#   BASE DE DATOS
# ============================================================
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ============================================================
#   MODELOS ORM
# ============================================================
class Administrador(Base):
    __tablename__ = "administradores"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    usuario: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nombre: Mapped[str | None] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ultimo_acceso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Alumno(Base):
    __tablename__ = "alumnos"
    __table_args__ = (CheckConstraint("monto > 0", name="ck_alumnos_monto_positivo"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    cedula: Mapped[str | None] = mapped_column(String(30))
    monto: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    fecha_vencimiento: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ============================================================
#   SCHEMAS PYDANTIC
# ============================================================
EstadoPago = Literal["vencido", "proximo", "al_dia"]


class LoginRequest(BaseModel):
    usuario: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    usuario: str


class AlumnoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=120)
    cedula: str | None = Field(None, max_length=30)
    monto: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    fecha_vencimiento: date


class AlumnoCreate(AlumnoBase):
    pass


class AlumnoUpdate(BaseModel):
    nombre: str | None = Field(None, min_length=1, max_length=120)
    cedula: str | None = Field(None, max_length=30)
    monto: Decimal | None = Field(None, gt=0, max_digits=14, decimal_places=2)
    fecha_vencimiento: date | None = None


class AlumnoOut(AlumnoBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    creado_en: datetime
    actualizado_en: datetime
    estado: EstadoPago
    dias_hasta_vencimiento: int


class Stats(BaseModel):
    total: int
    vencidos: int
    proximos: int
    al_dia: int
    monto_total: Decimal


# ============================================================
#   SEGURIDAD (JWT + bcrypt)
# ============================================================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str) -> tuple[str, int]:
    expires_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    expire = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
    payload = {"sub": subject, "exp": expire}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, expires_seconds


def get_current_admin(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Administrador:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise creds_exc
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        usuario: str | None = payload.get("sub")
        if not usuario:
            raise creds_exc
    except JWTError:
        raise creds_exc

    admin = db.query(Administrador).filter(Administrador.usuario == usuario).first()
    if not admin or not admin.activo:
        raise creds_exc
    return admin


# ============================================================
#   LÓGICA AUXILIAR
# ============================================================
def _calcular_estado(fecha_venc: date) -> tuple[EstadoPago, int]:
    hoy = date.today()
    diff = (fecha_venc - hoy).days
    if diff < 0:
        return "vencido", diff
    if diff <= settings.DIAS_PROXIMO_VENCER:
        return "proximo", diff
    return "al_dia", diff


def _to_out(a: Alumno) -> AlumnoOut:
    estado, dias = _calcular_estado(a.fecha_vencimiento)
    return AlumnoOut(
        id=a.id,
        nombre=a.nombre,
        cedula=a.cedula,
        monto=a.monto,
        fecha_vencimiento=a.fecha_vencimiento,
        creado_en=a.creado_en,
        actualizado_en=a.actualizado_en,
        estado=estado,
        dias_hasta_vencimiento=dias,
    )


# ============================================================
#   APLICACIÓN
# ============================================================
app = FastAPI(
    title="Gestión de Alumnos · API",
    description="Backend para el panel administrativo de gestión de alumnos y pagos.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
#   ENDPOINTS · HEALTH
# ============================================================
@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}


# ============================================================
#   ENDPOINTS · AUTH
# ============================================================
@app.post("/api/auth/login", response_model=TokenResponse, tags=["auth"])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    admin = db.query(Administrador).filter(Administrador.usuario == payload.usuario).first()

    if not admin or not admin.activo or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
        )

    admin.ultimo_acceso = datetime.now(timezone.utc)
    db.commit()

    token, expires_in = create_access_token(admin.usuario)
    return TokenResponse(access_token=token, expires_in=expires_in, usuario=admin.usuario)


# ============================================================
#   ENDPOINTS · ALUMNOS
# ============================================================
@app.get(
    "/api/alumnos",
    response_model=list[AlumnoOut],
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def listar_alumnos(
    db: Session = Depends(get_db),
    search: str | None = Query(None, description="Buscar por nombre, cédula o ID"),
    estado: EstadoPago | None = Query(None, description="Filtrar por estado de pago"),
):
    q = db.query(Alumno)

    if search:
        s = f"%{search.strip().lower()}%"
        filters = [
            func.lower(Alumno.nombre).like(s),
            func.lower(func.coalesce(Alumno.cedula, "")).like(s),
        ]
        if search.strip().isdigit():
            filters.append(Alumno.id == int(search.strip()))
        q = q.filter(or_(*filters))

    rows = q.order_by(Alumno.fecha_vencimiento.asc()).all()
    out = [_to_out(a) for a in rows]
    if estado:
        out = [a for a in out if a.estado == estado]
    return out


@app.get(
    "/api/alumnos/stats",
    response_model=Stats,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def stats_alumnos(db: Session = Depends(get_db)):
    hoy = date.today()
    limite_proximo = hoy + timedelta(days=settings.DIAS_PROXIMO_VENCER)

    total = db.query(func.count(Alumno.id)).scalar() or 0
    vencidos = (
        db.query(func.count(Alumno.id)).filter(Alumno.fecha_vencimiento < hoy).scalar() or 0
    )
    proximos = (
        db.query(func.count(Alumno.id))
        .filter(Alumno.fecha_vencimiento >= hoy, Alumno.fecha_vencimiento <= limite_proximo)
        .scalar()
        or 0
    )
    al_dia = (
        db.query(func.count(Alumno.id)).filter(Alumno.fecha_vencimiento > limite_proximo).scalar()
        or 0
    )
    monto_total = db.query(func.coalesce(func.sum(Alumno.monto), 0)).scalar() or Decimal("0")

    return Stats(
        total=total,
        vencidos=vencidos,
        proximos=proximos,
        al_dia=al_dia,
        monto_total=monto_total,
    )


@app.get(
    "/api/alumnos/{alumno_id}",
    response_model=AlumnoOut,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def obtener_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alumno no encontrado")
    return _to_out(a)


@app.post(
    "/api/alumnos",
    response_model=AlumnoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def crear_alumno(payload: AlumnoCreate, db: Session = Depends(get_db)):
    nuevo = Alumno(
        nombre=payload.nombre.strip(),
        cedula=payload.cedula.strip() if payload.cedula else None,
        monto=payload.monto,
        fecha_vencimiento=payload.fecha_vencimiento,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return _to_out(nuevo)


@app.put(
    "/api/alumnos/{alumno_id}",
    response_model=AlumnoOut,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def actualizar_alumno(alumno_id: int, payload: AlumnoUpdate, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alumno no encontrado")

    data = payload.model_dump(exclude_unset=True)
    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = data["nombre"].strip()
    if "cedula" in data and data["cedula"] is not None:
        data["cedula"] = data["cedula"].strip() or None

    for k, v in data.items():
        setattr(a, k, v)

    db.commit()
    db.refresh(a)
    return _to_out(a)


@app.delete(
    "/api/alumnos/{alumno_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def eliminar_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alumno no encontrado")
    db.delete(a)
    db.commit()
    return None
