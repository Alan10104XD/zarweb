"""
Gestión de Alumnos · API v3 (simplificada)
- Alumnos con estado binario activo/inactivo y datos de contacto
- Pagos como registros simples agregados manualmente por el administrador
- Boletas (recibos internos) de cada pago, con link público por token

Compatible con Python 3.8+

Ejecutar:
    uvicorn api:app --reload --port 8001
"""

import html as html_lib
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Sequence, String, Text,
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

    # ---- Datos que encabezan las boletas de pago -------------------
    # TODO: reemplazar por los datos reales en el .env de producción.
    EMPRESA_NOMBRE: str = "Zarpemos"
    EMPRESA_RUC: str = ""
    EMPRESA_DIRECCION: str = ""
    EMPRESA_TELEFONO: str = ""
    EMPRESA_EMAIL: str = ""
    EMPRESA_LOGO_URL: str = "https://zarpemos.online/assets/images/logo.jpg"
    # Base del link público de la boleta. Vacío = se deduce del request.
    PUBLIC_BASE_URL: str = ""

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
    ruc: Mapped[Optional[str]] = mapped_column(String(30))
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
    # Correlativo de la boleta: lo asigna la secuencia al insertar y no cambia
    # nunca, aunque después se borren pagos.
    recibo_numero: Mapped[int] = mapped_column(
        Integer, Sequence("seq_recibo_numero"), server_default=func.nextval("seq_recibo_numero"),
        nullable=False, unique=True,
    )
    # Token del link público; se genera recién la primera vez que se abre la boleta.
    recibo_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True)
    recibo_emitido_en: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
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
    ruc: Optional[str] = Field(None, max_length=30)
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
    ruc: Optional[str] = Field(None, max_length=30)
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
    recibo_numero: int
    creado_en: datetime
    actualizado_en: datetime


class BoletaAlumnoOut(BaseModel):
    """Lo mínimo para que el panel arme el mensaje de envío."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str
    telefono: Optional[str]
    tutor_telefono: Optional[str]


class BoletaOut(BaseModel):
    pago_id: int
    numero: str
    url: str
    html: str
    monto: Decimal
    fecha_pago: date
    alumno: BoletaAlumnoOut


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
        nombre=a.nombre, cedula=a.cedula, ruc=a.ruc,
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
#   BOLETAS DE PAGO
# ============================================================
_UNIDADES = (
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
    "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
    "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
)
_DECENAS = (
    "", "", "veinte", "treinta", "cuarenta", "cincuenta",
    "sesenta", "setenta", "ochenta", "noventa",
)
_CENTENAS = (
    "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
    "seiscientos", "setecientos", "ochocientos", "novecientos",
)


def _tres_cifras(n: int) -> str:
    """0-999 en letras. 0 devuelve cadena vacía (no aporta nada al número)."""
    if n == 0:
        return ""
    if n == 100:
        return "cien"
    partes = []
    centenas, resto = divmod(n, 100)
    if centenas:
        partes.append(_CENTENAS[centenas])
    if resto < 30:
        if resto:
            partes.append(_UNIDADES[resto])
    else:
        decenas, unidades = divmod(resto, 10)
        partes.append(_DECENAS[decenas] if unidades == 0
                      else "{} y {}".format(_DECENAS[decenas], _UNIDADES[unidades]))
    return " ".join(partes)


def _apocopar(texto: str) -> str:
    """"uno" → "un" cuando precede a mil/millón: veintiún mil, treinta y un mil."""
    if texto == "uno":
        return "un"
    if texto.endswith("veintiuno"):
        return texto[:-len("veintiuno")] + "veintiún"
    if texto.endswith(" uno"):
        return texto[:-len(" uno")] + " un"
    return texto


def numero_a_letras(n: int) -> str:
    n = int(n)
    if n < 0:
        return "menos " + numero_a_letras(-n)
    if n == 0:
        return "cero"
    if n < 1000:
        return _tres_cifras(n)
    if n < 1_000_000:
        miles, resto = divmod(n, 1000)
        cabeza = "mil" if miles == 1 else _apocopar(_tres_cifras(miles)) + " mil"
        return cabeza if resto == 0 else "{} {}".format(cabeza, numero_a_letras(resto))
    if n < 1_000_000_000_000:
        millones, resto = divmod(n, 1_000_000)
        cabeza = ("un millón" if millones == 1
                  else _apocopar(numero_a_letras(millones)) + " millones")
        return cabeza if resto == 0 else "{} {}".format(cabeza, numero_a_letras(resto))
    billones, resto = divmod(n, 1_000_000_000_000)
    cabeza = ("un billón" if billones == 1
              else _apocopar(numero_a_letras(billones)) + " billones")
    return cabeza if resto == 0 else "{} {}".format(cabeza, numero_a_letras(resto))


def monto_en_letras(monto: Decimal) -> str:
    """Como se lee al pie del ticket: SETECIENTOS CINCUENTA MIL GS."""
    entero = int(monto)
    centavos = int((Decimal(monto) - entero) * 100)
    texto = _apocopar(numero_a_letras(entero)).upper()
    if centavos:
        texto += " CON {:02d}/100".format(centavos)
    return texto + " GS."


def _fmt_num(monto: Decimal) -> str:
    """Importe sin prefijo, como va en las columnas del ticket: 750.000"""
    entero = int(Decimal(monto).quantize(Decimal("1")))
    return "{:,}".format(entero).replace(",", ".")


def _fmt_fecha(d: date) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"


LABEL_METODO = {
    "efectivo": "Efectivo",
    "transferencia": "Transferencia",
    "tarjeta": "Tarjeta",
    "otro": "Otro",
}


def numero_recibo(p: Pago) -> str:
    return "{:07d}".format(p.recibo_numero)


def base_publica(request: Request) -> str:
    """Base del link de la boleta: la configurada o, si no hay, la del request."""
    return (settings.PUBLIC_BASE_URL or str(request.base_url)).rstrip("/")


def url_boleta(request: Request, token: str) -> str:
    return "{}/boleta/{}".format(base_publica(request), token)


def asegurar_token_recibo(db: Session, p: Pago) -> str:
    """El token se crea recién cuando se abre la boleta por primera vez."""
    if not p.recibo_token:
        p.recibo_token = secrets.token_urlsafe(24)
        p.recibo_emitido_en = datetime.now(timezone.utc)
        db.commit()
        db.refresh(p)
    return p.recibo_token


def _e(v: Optional[str]) -> str:
    return html_lib.escape(v or "")


def _dato(etiqueta: str, valor: Optional[str]) -> str:
    """Línea "Etiqueta: valor" del encabezado. Se omite si no hay dato."""
    if not valor:
        return ""
    return '<p class="dato"><span class="etq">{}:</span> {}</p>'.format(_e(etiqueta), _e(valor))


# Paraguay quedó fijo en UTC-3 desde 2024 (sin horario de verano). Se resuelve
# con un offset y no con zoneinfo, que no existe en el Python 3.8 del servidor.
TZ_PY = timezone(timedelta(hours=-3))


def _fmt_fecha_hora(dt: datetime) -> str:
    return dt.astimezone(TZ_PY).strftime("%d/%m/%Y %H:%M")


TICKET_CSS = """
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #eceef4;
    color: #111;
    font-family: "Courier New", Courier, ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.45;
    padding: 20px 10px;
    -webkit-font-smoothing: antialiased;
  }
  .barra { width: 302px; margin: 0 auto 14px; }
  .barra button {
    width: 100%; font: inherit; font-weight: 700; cursor: pointer;
    background: #27448c; color: #fff; border: none;
    padding: 11px 14px; border-radius: 6px; letter-spacing: 0.4px;
  }
  .barra button:hover { background: #1d3470; }

  .ticket {
    width: 302px; margin: 0 auto; background: #fff;
    padding: 20px 18px;
    box-shadow: 0 10px 28px -16px rgba(17,17,17,0.5);
  }

  .tipo {
    text-align: center; font-size: 11px; letter-spacing: 0.6px;
    color: #777; text-transform: uppercase;
  }
  .empresa {
    text-align: center; font-size: 17px; font-weight: 700;
    letter-spacing: 0.5px; margin-top: 3px; text-transform: uppercase;
  }
  .puntos { width: 76px; margin: 9px auto; border-top: 1px dotted #999; }
  .centro { text-align: center; }

  .bloque { margin-top: 14px; }
  .dato { margin-top: 2px; word-break: break-word; }
  .dato .etq { color: #555; }

  .regla { margin: 12px 0 8px; border-top: 1px dashed #aaa; }

  .fila { display: flex; justify-content: space-between; gap: 10px; }
  .fila .num { white-space: nowrap; }
  .cabecera { color: #555; }
  .cabecera .num { text-decoration: underline; }
  .concepto { margin-top: 6px; text-transform: uppercase; word-break: break-word; }

  .total {
    margin-top: 8px; font-size: 15px; font-weight: 700;
    display: flex; justify-content: space-between; gap: 10px;
  }
  .letras {
    margin-top: 6px; font-size: 11px; line-height: 1.4;
    word-break: break-word;
  }
  .nota { margin-top: 10px; font-size: 11px; color: #444; word-break: break-word; }

  .gracias {
    margin-top: 20px; text-align: center; font-weight: 700;
    letter-spacing: 0.4px; line-height: 1.4;
  }
  .pie {
    margin-top: 14px; text-align: center; font-size: 9.5px;
    color: #777; line-height: 1.5; word-break: break-all;
  }

  @media print {
    /* Rollo de 80 mm y alto libre; en A4 sale la misma tira, arriba. */
    @page { size: 80mm auto; margin: 4mm; }
    body { background: #fff; padding: 0; }
    .barra { display: none !important; }
    .ticket { width: auto; padding: 0; box-shadow: none; }
  }
"""


def render_boleta_html(a: Alumno, p: Pago, url: str, embed: bool = False) -> str:
    """Plantilla única del ticket: la usan el link público y el modal del panel."""
    emitido = p.recibo_emitido_en or datetime.now(timezone.utc)
    importe = _fmt_num(p.monto)
    # La forma de pago va como una fila más, igual que el "Efectivo" de un
    # ticket de caja. Si nadie la cargó, no se inventa una línea.
    metodo = ""
    if p.metodo_pago:
        metodo = '<div class="fila"><span>{}</span><span class="num">{}</span></div>'.format(
            _e(LABEL_METODO.get(p.metodo_pago, p.metodo_pago)), _e(importe))

    encabezado = "".join(
        '<p class="centro">{}</p>'.format(_e(x))
        for x in (
            "TEL: {}".format(settings.EMPRESA_TELEFONO) if settings.EMPRESA_TELEFONO else "",
            settings.EMPRESA_DIRECCION,
            "RUC: {}".format(settings.EMPRESA_RUC) if settings.EMPRESA_RUC else "",
            settings.EMPRESA_EMAIL,
        )
        if x
    )

    datos = "".join([
        _dato("Fecha/Hora", _fmt_fecha_hora(emitido)),
        _dato("Recibo N°", numero_recibo(p)),
        _dato("Alumno", a.nombre),
        _dato("Cédula", a.cedula),
        _dato("Responsable", a.tutor_nombre),
    ])

    return """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Recibo N° {numero} · {empresa}</title>
<style>{css}</style>
</head>
<body>
{barra}
<div class="ticket">

  <p class="tipo">Ticket de uso interno</p>
  <p class="empresa">{empresa}</p>
  <div class="puntos"></div>
  {encabezado}

  <div class="bloque">
    {datos}
  </div>

  <div class="regla"></div>

  <div class="fila cabecera">
    <span>Detalle</span>
    <span class="num">Total</span>
  </div>
  <p class="concepto">{concepto}</p>
  <div class="fila">
    <span>Pago del {fecha_pago}</span>
    <span class="num">{importe}</span>
  </div>

  <div class="regla"></div>

  {metodo}
  <div class="total">
    <span>TOTAL GS:</span>
    <span class="num">{importe}</span>
  </div>
  <p class="letras">{letras}</p>
  {nota}

  <p class="gracias">***GRACIAS POR ELEGIRNOS***</p>

  <p class="pie">
    Comprobante interno · No válido como documento tributario<br>
    {url}
  </p>

</div>
</body>
</html>""".format(
        css=TICKET_CSS,
        barra="" if embed else (
            '<div class="barra"><button type="button" onclick="window.print()">'
            'Imprimir o guardar en PDF</button></div>'
        ),
        empresa=_e(settings.EMPRESA_NOMBRE),
        encabezado=encabezado,
        numero=numero_recibo(p),
        datos=datos,
        concepto=_e(p.concepto or "Cuota mensual"),
        fecha_pago=_fmt_fecha(p.fecha_pago),
        importe=_e(importe),
        metodo=metodo,
        letras=_e(monto_en_letras(p.monto)),
        nota='<p class="nota">Nota: {}</p>'.format(_e(p.nota)) if p.nota else "",
        url=_e(url),
    )


# ============================================================
#   APP
# ============================================================
app = FastAPI(
    title="Gestión de Alumnos · API",
    description="Panel administrativo de alumnos, pagos y boletas.",
    version="3.1.0",
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
            func.lower(func.coalesce(Alumno.ruc, "")).like(s),
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
        ruc=_strip_none(payload.ruc),
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
        "nombre", "cedula", "ruc", "email", "telefono",
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


# ============================================================
#   BOLETAS
# ============================================================
@app.get(
    "/api/pagos/{pago_id}/boleta",
    response_model=BoletaOut,
    tags=["boletas"],
    dependencies=[Depends(get_current_admin)],
)
def obtener_boleta(pago_id: int, request: Request, db: Session = Depends(get_db)):
    """Boleta lista para mostrar en el panel, con el link público para compartir."""
    p = db.get(Pago, pago_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    a = db.get(Alumno, p.alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")

    token = asegurar_token_recibo(db, p)
    url = url_boleta(request, token)
    return BoletaOut(
        pago_id=p.id,
        numero=numero_recibo(p),
        url=url,
        html=render_boleta_html(a, p, url, embed=True),
        monto=p.monto,
        fecha_pago=p.fecha_pago,
        alumno=BoletaAlumnoOut.model_validate(a),
    )


@app.get("/boleta/{token}", response_class=HTMLResponse, tags=["boletas"])
def boleta_publica(token: str, request: Request, db: Session = Depends(get_db)):
    """Link que se le pasa al alumno. Sin sesión: el token es la credencial."""
    p = db.query(Pago).filter(Pago.recibo_token == token).first()
    if not p:
        raise HTTPException(status_code=404, detail="Boleta no encontrada")
    a = db.get(Alumno, p.alumno_id)
    if not a:
        raise HTTPException(status_code=404, detail="Boleta no encontrada")

    html = render_boleta_html(a, p, url_boleta(request, token))
    return HTMLResponse(
        content=html,
        headers={
            "X-Robots-Tag": "noindex, nofollow",
            "Cache-Control": "private, no-store",
        },
    )
