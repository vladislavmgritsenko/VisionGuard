FROM python:3.12-slim AS runtime
ARG MODEL_SHA256=0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONHASHSEED=random \
    YOLO_CONFIG_DIR=/tmp/ultralytics
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
RUN apt-get update \
    && apt-get install --no-install-recommends -y libglib2.0-0 libgl1 libsm6 libxext6 libxcb1 \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
RUN mkdir -p app \
    && touch app/__init__.py \
    && pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install ".[ml]" \
    && mkdir -p /app/models \
    && cd /app/models \
    && python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')" \
    && echo "${MODEL_SHA256}  yolo11n.pt" | sha256sum -c - \
    && chown -R app:app /app/models \
    && rm -rf /app/app
COPY app ./app
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host=0.0.0.0", "--port=8000", "--proxy-headers", "--forwarded-allow-ips=*", "--no-access-log"]
