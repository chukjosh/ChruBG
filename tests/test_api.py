import io
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest
from PIL import Image

os.environ.setdefault("ENABLED_MODELS", "u2netp")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import remove_background as api  # noqa: E402

pytestmark = pytest.mark.skipif(
    not api.get_available_model_identifiers(), reason="Run scripts/download_model.py first"
)


@pytest.fixture(scope="module")
def server_address():
    server = HTTPServer(("127.0.0.1", 0), api.handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def send_request(server_address, path="/api/remove_background", body=None):
    request = urllib.request.Request(server_address + path, data=body, method="POST" if body is not None else "GET")
    try:
        response = urllib.request.urlopen(request)
        return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def make_test_image_bytes():
    image_buffer = io.BytesIO()
    Image.new("RGB", (96, 64), (200, 120, 40)).save(image_buffer, format="JPEG")
    return image_buffer.getvalue()


def test_get_lists_available_models(server_address):
    status_code, body = send_request(server_address)
    model_list = json.loads(body)
    assert status_code == 200
    assert model_list["default"] in [model["id"] for model in model_list["models"]]
    assert isinstance(model_list["browser_models"], list)


def test_post_returns_transparent_png(server_address):
    status_code, body = send_request(server_address, body=make_test_image_bytes())
    result_image = Image.open(io.BytesIO(body))
    assert status_code == 200
    assert result_image.mode == "RGBA"
    assert result_image.size == (96, 64)


def test_unknown_model_is_rejected(server_address):
    status_code, _ = send_request(server_address, "/api/remove_background?model=nope", make_test_image_bytes())
    assert status_code == 400


def test_garbage_and_empty_uploads_are_rejected(server_address):
    assert send_request(server_address, body=b"not an image")[0] == 400
    assert send_request(server_address, body=b"")[0] == 400


def test_rate_limit_returns_429(server_address, monkeypatch):
    monkeypatch.setattr(api, "RATE_LIMIT_PER_MINUTE", 2)
    api.recent_request_times_by_client.clear()
    status_codes = [send_request(server_address, body=b"x")[0] for _ in range(3)]
    assert status_codes == [400, 400, 429]
    api.recent_request_times_by_client.clear()


def test_api_does_not_expose_underlying_model_names(server_address):
    _, body = send_request(server_address)
    assert "u2netp" not in body.decode()
    assert "silueta" not in body.decode()


def test_post_accepts_the_public_model_name(server_address):
    status_code, _ = send_request(server_address, "/api/remove_background?model=spark", make_test_image_bytes())
    assert status_code == 200


def test_only_the_most_recent_models_stay_loaded(monkeypatch):
    monkeypatch.setattr(api.onnxruntime, "InferenceSession", lambda path, providers: object())
    api.cached_inference_sessions.clear()

    monkeypatch.setattr(api, "MAXIMUM_LOADED_MODELS", 1)
    api.get_inference_session("first-model")
    api.get_inference_session("second-model")
    assert list(api.cached_inference_sessions) == ["second-model"]

    monkeypatch.setattr(api, "MAXIMUM_LOADED_MODELS", 2)
    api.get_inference_session("third-model")
    api.get_inference_session("second-model")  # reusing a model makes it the most recent
    api.get_inference_session("fourth-model")
    assert list(api.cached_inference_sessions) == ["second-model", "fourth-model"]
    api.cached_inference_sessions.clear()
