from contextlib import asynccontextmanager
from io import BytesIO
import logging
from pathlib import Path
from threading import Lock
import time
from typing import Protocol
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("vision-guard")
REQUESTS = Counter("vision_guard_predictions_total", "Prediction count", ["status"])
LATENCY = Histogram("vision_guard_prediction_seconds", "Prediction latency")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    model_mode: str = "yolo"
    model_path: str = "models/yolo11n.pt"
    max_image_mb: int = 8
    confidence_threshold: float = 0.35
    environment: str = "development"
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    docs_enabled: bool = True
    max_concurrent_inference: int = 1
    metrics_token: str = ""

    @property
    def hosts(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]


class Box(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    xyxy: tuple[int, int, int, int]


class Prediction(BaseModel):
    width: int
    height: int
    latency_ms: float
    detections: list[Box]


class Detector(Protocol):
    name: str

    def predict(self, image: Image.Image, threshold: float) -> list[Box]: ...


class DemoDetector:
    """Deterministic backend used only for tests and offline API development."""

    name = "portfolio-demo-detector-v1"

    def predict(self, image: Image.Image, threshold: float) -> list[Box]:
        width, height = image.size
        confidence = min(0.97, 0.55 + sum(image.resize((1, 1)).getpixel((0, 0))[:3]) / 7650)
        if confidence < threshold:
            return []
        return [
            Box(
                label="object",
                confidence=confidence,
                xyxy=(width // 5, height // 5, width * 4 // 5, height * 4 // 5),
            )
        ]


class YoloDetector:
    def __init__(self, model_path: str) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("YOLO dependencies are missing; install the 'ml' extra") from exc

        path = Path(model_path)
        if not path.is_file():
            raise RuntimeError(f"YOLO weights were not found at {path}")
        self._model = YOLO(str(path))
        self._lock = Lock()
        self.name = f"yolo11n:{path.name}"

    def predict(self, image: Image.Image, threshold: float) -> list[Box]:
        with self._lock:
            result = self._model.predict(source=image, conf=threshold, verbose=False)[0]
        names = result.names
        detections: list[Box] = []
        for raw_box in result.boxes:
            coords = raw_box.xyxy[0].tolist()
            detections.append(
                Box(
                    label=str(names[int(raw_box.cls[0].item())]),
                    confidence=float(raw_box.conf[0].item()),
                    xyxy=tuple(round(value) for value in coords),
                )
            )
        return detections


settings = Settings()
detector: Detector | None = None
inference_slots = None


def create_detector() -> Detector:
    if settings.model_mode.lower() == "demo":
        return DemoDetector()
    if settings.model_mode.lower() == "yolo":
        return YoloDetector(settings.model_path)
    raise RuntimeError(f"Unsupported MODEL_MODE: {settings.model_mode}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global detector, inference_slots
    if settings.environment == "production" and settings.model_mode.lower() == "demo":
        raise RuntimeError("Demo detector is forbidden in production")
    if settings.max_concurrent_inference < 1:
        raise RuntimeError("MAX_CONCURRENT_INFERENCE must be at least 1")
    import asyncio

    inference_slots = asyncio.Semaphore(settings.max_concurrent_inference)
    detector = await run_in_threadpool(create_detector)
    log.info("model_ready mode=%s model=%s", settings.model_mode, detector.name)
    yield
    detector = None


app = FastAPI(
    title="Vision Guard",
    version="1.2.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.hosts)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.middleware("http")
async def production_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid4()))[:128]
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    elapsed = (time.perf_counter() - started) * 1000
    log.info(
        "request_complete request_id=%s method=%s path=%s status=%s latency_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": "invalid request"})


@app.get("/", response_class=FileResponse)
def index() -> str:
    return "app/static/index.html"


@app.post("/v1/detect", response_model=Prediction)
async def detect(image: UploadFile = File(...)) -> Prediction:
    started = time.perf_counter()
    raw = await image.read(settings.max_image_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_image_mb * 1024 * 1024:
        REQUESTS.labels("too_large").inc()
        raise HTTPException(413, "image exceeds configured limit")
    try:
        parsed = Image.open(BytesIO(raw))
        parsed.verify()
        parsed = ImageOps.exif_transpose(Image.open(BytesIO(raw))).convert("RGB")
    except (UnidentifiedImageError, OSError, SyntaxError):
        REQUESTS.labels("invalid").inc()
        raise HTTPException(422, "file is not a valid image") from None
    if parsed.width * parsed.height > 25_000_000:
        REQUESTS.labels("unsafe_dimensions").inc()
        raise HTTPException(422, "image dimensions are unsafe")
    if detector is None or inference_slots is None:
        raise HTTPException(503, "detector is not ready")

    async with inference_slots:
        try:
            with LATENCY.time():
                boxes = await run_in_threadpool(
                    detector.predict, parsed, settings.confidence_threshold
                )
        except Exception:
            REQUESTS.labels("inference_error").inc()
            log.exception("inference_failed")
            raise HTTPException(503, "image processing is temporarily unavailable") from None
    elapsed = (time.perf_counter() - started) * 1000
    REQUESTS.labels("ok").inc()
    return Prediction(
        width=parsed.width,
        height=parsed.height,
        latency_ms=elapsed,
        detections=boxes,
    )


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    if detector is None:
        raise HTTPException(503, "model is not ready")
    return {"status": "ready"}


@app.get("/metrics", include_in_schema=False)
def metrics(request: Request) -> Response:
    if settings.metrics_token:
        supplied = request.headers.get("authorization", "")
        if supplied != f"Bearer {settings.metrics_token}":
            raise HTTPException(404, "not found")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
