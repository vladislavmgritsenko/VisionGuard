from io import BytesIO
import os

os.environ["MODEL_MODE"] = "demo"

from fastapi.testclient import TestClient
from PIL import Image
from app.main import app

def test_portfolio_cover():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "VISION / GUARD" in response.text


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (100, 80), "navy").save(out, "PNG")
    return out.getvalue()


def test_detect_contract():
    with TestClient(app) as client:
        response = client.post("/v1/detect", files={"image": ("x.png", png(), "image/png")})
        assert response.status_code == 200
        assert response.json()["width"] == 100
        assert "model" not in response.json()
        assert response.json()["detections"][0]["xyxy"] == [20, 16, 80, 64]
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["x-request-id"]


def test_rejects_non_image():
    with TestClient(app) as client:
        response = client.post("/v1/detect", files={"image": ("x.txt", b"no", "text/plain")})
        assert response.status_code == 422


def test_rejects_corrupt_image():
    with TestClient(app) as client:
        response = client.post(
            "/v1/detect",
            files={"image": ("broken.png", b"\x89PNG\r\n\x1a\ninvalid", "image/png")},
        )
        assert response.status_code == 422


def test_readiness_does_not_expose_backend():
    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.json() == {"status": "ready"}


def test_rejects_untrusted_host():
    with TestClient(app) as client:
        response = client.get("/", headers={"host": "attacker.example"})
        assert response.status_code == 400
