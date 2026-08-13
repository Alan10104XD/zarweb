"""
Gestión de Alumnos · API v3 (simplificada)
- Alumnos con estado binario activo/inactivo y datos de contacto
- Pagos como registros simples agregados manualmente por el administrador
- Compatible con Python 3.8+

Ejecutar:
    uvicorn api:app --reload --port 8001
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Numeric, String, Text,
    create_engine, func, or_,
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

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    @property
    def cors_origins_list(self) -> List[str]:
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
    nombre: Mapped[Optional[str]] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ultimo_acceso: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Alumno(Base):
    __tablename__ = "alumnos"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    cedula: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(120))
    telefono: Mapped[Optional[str]] = mapped_column(String(30))
    tutor_nombre: Mapped[Optional[str]] = mapped_column(String(120))
    tutor_telefono: Mapped[Optional[str]] = mapped_column(String(30))
    tutor_email: Mapped[Optional[str]] = mapped_column(String(120))
    monto_mensual: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="activo")
    fecha_alta: Mapped[date] = mapped_column(Date, nullable=False, server_default=func.current_date())
    fecha_baja: Mapped[Optional[date]] = mapped_column(Date)
    motivo_baja: Mapped[Optional[str]] = mapped_column(Text)
    observaciones: Mapped[Optional[str]] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Pago(Base):
    __tablename__ = "pagos"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    alumno_id: Mapped[int] = mapped_column(
        ForeignKey("alumnos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fecha_pago: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    concepto: Mapped[Optional[str]] = mapped_column(String(100))
    metodo_pago: Mapped[Optional[str]] = mapped_column(String(30))
    nota: Mapped[Optional[str]] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ============================================================
#   SCHEMAS PYDANTIC
# ============================================================
EstadoAlumno = Literal["activo", "inactivo"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    usuario: str


class AlumnoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=120)
    cedula: Optional[str] = Field(None, max_length=30)
    email: Optional[str] = Field(None, max_length=120)
    telefono: Optional[str] = Field(None, max_length=30)
    tutor_nombre: Optional[str] = Field(None, max_length=120)
    tutor_telefono: Optional[str] = Field(None, max_length=30)
    tutor_email: Optional[str] = Field(None, max_length=120)
    monto_mensual: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    estado: EstadoAlumno = "activo"
    fecha_alta: Optional[date] = None
    fecha_baja: Optional[date] = None
    motivo_baja: Optional[str] = None
    observaciones: Optional[str] = Field(None, max_length=1000)


class AlumnoCreate(AlumnoBase):
    pass


class AlumnoUpdate(BaseModel):
    nombre: Optional[str] = Field(None, min_length=1, max_length=120)
    cedula: Optional[str] = Field(None, max_length=30)
    email: Optional[str] = Field(None, max_length=120)
    telefono: Optional[str] = Field(None, max_length=30)
    tutor_nombre: Optional[str] = Field(None, max_length=120)
    tutor_telefono: Optional[str] = Field(None, max_length=30)
    tutor_email: Optional[str] = Field(None, max_length=120)
    monto_mensual: Optional[Decimal] = Field(None, gt=0, max_digits=14, decimal_places=2)
    estado: Optional[EstadoAlumno] = None
    fecha_alta: Optional[date] = None
    fecha_baja: Optional[date] = None
    motivo_baja: Optional[str] = None
    observaciones: Optional[str] = Field(None, max_length=1000)


class AlumnoOut(AlumnoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    creado_en: datetime
    actualizado_en: datetime
    # resumen de pagos (calculado)
    total_pagado: Decimal
    pagos_count: int
    ultimo_pago_fecha: Optional[date]
    ultimo_pago_monto: Optional[Decimal]


class PagoBase(BaseModel):
    fecha_pago: date
    monto: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    concepto: Optional[str] = Field(None, max_length=100)
    metodo_pago: Optional[str] = Field(None, max_length=30)
    nota: Optional[str] = None


class PagoCreate(PagoBase):
    pass


class PagoUpdate(BaseModel):
    fecha_pago: Optional[date] = None
    monto: Optional[Decimal] = Field(None, gt=0, max_digits=14, decimal_places=2)
    concepto: Optional[str] = Field(None, max_length=100)
    metodo_pago: Optional[str] = Field(None, max_length=30)
    nota: Optional[str] = None


class PagoOut(PagoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    alumno_id: int
    creado_en: datetime
    actualizado_en: datetime


# ============================================================
#   SEGURIDAD
# ============================================================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str) -> Tuple[str, int]:
    expires_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    expire = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
    payload = {"sub": subject, "exp": expire}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, expires_seconds


def get_current_admin(
    token: Optional[str] = Depends(oauth2_scheme),
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
        usuario: Optional[str] = payload.get("sub")
        if not usuario:
            raise creds_exc
    except JWTError:
        raise creds_exc
    admin = db.query(Administrador).filter(Administrador.usuario == usuario).first()
    if not admin or not admin.activo:
        raise creds_exc
    return admin


# ============================================================
#   HELPERS
# ============================================================
def _strip_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    s = v.strip()
    return s if s else None


def _alumno_to_out(a: Alumno, pagos: List[Pago]) -> AlumnoOut:
    total = sum((p.monto for p in pagos), Decimal("0"))
    ultimo = max(pagos, key=lambda p: p.fecha_pago, default=None) if pagos else None
    return AlumnoOut(
        id=a.id,
        nombre=a.nombre, cedula=a.cedula,
        email=a.email, telefono=a.telefono,
        tutor_nombre=a.tutor_nombre, tutor_telefono=a.tutor_telefono, tutor_email=a.tutor_email,
        monto_mensual=a.monto_mensual,
        estado=a.estado,
        fecha_alta=a.fecha_alta, fecha_baja=a.fecha_baja, motivo_baja=a.motivo_baja,
        observaciones=a.observaciones,
        creado_en=a.creado_en, actualizado_en=a.actualizado_en,
        total_pagado=total,
        pagos_count=len(pagos),
        ultimo_pago_fecha=ultimo.fecha_pago if ultimo else None,
        ultimo_pago_monto=ultimo.monto if ultimo else None,
    )


# ============================================================
#   APP
# ============================================================
app = FastAPI(
    title="Gestión de Alumnos · API",
    description="Panel administrativo de alumnos y pagos.",
    version="3.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Health ----------
@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}


# ---------- Auth ----------
@app.post("/api/auth/login", response_model=TokenResponse, tags=["auth"])
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenResponse:
    admin = db.query(Administrador).filter(Administrador.usuario == form_data.username).first()
    if not admin or not admin.activo or not verify_password(form_data.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    admin.ultimo_acceso = datetime.now(timezone.utc)
    db.commit()
    token, expires_in = create_access_token(admin.usuario)
    return TokenResponse(access_token=token, expires_in=expires_in, usuario=admin.usuario)


# ============================================================
#   ALUMNOS
# ============================================================
@app.get(
    "/api/alumnos",
    response_model=List[AlumnoOut],
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def listar_alumnos(
    db: Session = Depends(get_db),
    search: Optional[str] = Query(None),
    estado: Optional[EstadoAlumno] = Query(None),
):
    q = db.query(Alumno)
    if search:
        s = f"%{search.strip().lower()}%"
        filters = [
            func.lower(Alumno.nombre).like(s),
            func.lower(func.coalesce(Alumno.cedula, "")).like(s),
            func.lower(func.coalesce(Alumno.email, "")).like(s),
            func.lower(func.coalesce(Alumno.telefono, "")).like(s),
        ]
        if search.strip().isdigit():
            filters.append(Alumno.id == int(search.strip()))
        q = q.filter(or_(*filters))
    if estado:
        q = q.filter(Alumno.estado == estado)

    alumnos = q.order_by(Alumno.nombre.asc()).all()

    if alumnos:
        ids = [a.id for a in alumnos]
        pagos = db.query(Pago).filter(Pago.alumno_id.in_(ids)).all()
        pagos_por_alumno: Dict[int, List[Pago]] = {}
        for p in pagos:
            pagos_por_alumno.setdefault(p.alumno_id, []).append(p)
    else:
        pagos_por_alumno = {}

    return [_alumno_to_out(a, pagos_por_alumno.get(a.id, [])) for a in alumnos]


@app.get(
    "/api/alumnos/{alumno_id}",
    response_model=AlumnoOut,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def obtener_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    pagos = db.query(Pago).filter(Pago.alumno_id == alumno_id).all()
    return _alumno_to_out(a, pagos)


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
        cedula=_strip_none(payload.cedula),
        email=_strip_none(payload.email),
        telefono=_strip_none(payload.telefono),
        tutor_nombre=_strip_none(payload.tutor_nombre),
        tutor_telefono=_strip_none(payload.tutor_telefono),
        tutor_email=_strip_none(payload.tutor_email),
        monto_mensual=payload.monto_mensual,
        estado=payload.estado,
        fecha_alta=payload.fecha_alta or date.today(),
        fecha_baja=payload.fecha_baja,
        motivo_baja=_strip_none(payload.motivo_baja),
        observaciones=_strip_none(payload.observaciones),
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return _alumno_to_out(nuevo, [])


@app.put(
    "/api/alumnos/{alumno_id}",
    response_model=AlumnoOut,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def actualizar_alumno(alumno_id: int, payload: AlumnoUpdate, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    data = payload.model_dump(exclude_unset=True)
    for k in (
        "nombre", "cedula", "email", "telefono",
        "tutor_nombre", "tutor_telefono", "tutor_email",
        "motivo_baja", "observaciones",
    ):
        if k in data and data[k] is not None:
            data[k] = _strip_none(data[k])
    for k, v in data.items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    pagos = db.query(Pago).filter(Pago.alumno_id == alumno_id).all()
    return _alumno_to_out(a, pagos)


@app.delete(
    "/api/alumnos/{alumno_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["alumnos"],
    dependencies=[Depends(get_current_admin)],
)
def eliminar_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    db.delete(a)
    db.commit()
    return None


# ============================================================
#   PAGOS
# ============================================================
@app.get(
    "/api/alumnos/{alumno_id}/pagos",
    response_model=List[PagoOut],
    tags=["pagos"],
    dependencies=[Depends(get_current_admin)],
)
def listar_pagos_alumno(alumno_id: int, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    return (
        db.query(Pago)
        .filter(Pago.alumno_id == alumno_id)
        .order_by(Pago.fecha_pago.desc(), Pago.id.desc())
        .all()
    )


@app.post(
    "/api/alumnos/{alumno_id}/pagos",
    response_model=PagoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["pagos"],
    dependencies=[Depends(get_current_admin)],
)
def crear_pago(alumno_id: int, payload: PagoCreate, db: Session = Depends(get_db)):
    a = db.get(Alumno, alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    nuevo = Pago(
        alumno_id=alumno_id,
        fecha_pago=payload.fecha_pago,
        monto=payload.monto,
        concepto=_strip_none(payload.concepto),
        metodo_pago=_strip_none(payload.metodo_pago),
        nota=_strip_none(payload.nota),
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo


@app.put(
    "/api/pagos/{pago_id}",
    response_model=PagoOut,
    tags=["pagos"],
    dependencies=[Depends(get_current_admin)],
)
def actualizar_pago(pago_id: int, payload: PagoUpdate, db: Session = Depends(get_db)):
    p = db.get(Pago, pago_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    data = payload.model_dump(exclude_unset=True)
    for k in ("concepto", "metodo_pago", "nota"):
        if k in data and data[k] is not None:
            data[k] = _strip_none(data[k])
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@app.delete(
    "/api/pagos/{pago_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["pagos"],
    dependencies=[Depends(get_current_admin)],
)
def eliminar_pago(pago_id: int, db: Session = Depends(get_db)):
    p = db.get(Pago, pago_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(p)
    db.commit()
    return None
