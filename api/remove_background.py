"""ChruBG background removal endpoint for the Vercel Python runtime.

GET  /api/remove_background               lists the models this server offers
POST /api/remove_background?model=<id>   raw image bytes in, transparent PNG out

Images are read into memory, processed and discarded. Nothing is written to disk.
Uses onnxruntime directly instead of the rembg package to keep the bundle small.
"""
import io
import json
import os
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnxruntime
from PIL import Image

from _model_registry import MODEL_REGISTRY, get_browser_model_identifiers, get_requested_model_identifiers

PROJECT_ROOT_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAXIMUM_REQUEST_BYTES = 4_400_000  # Vercel rejects bodies above 4.5 MB
MAXIMUM_IMAGE_SIDE_IN_PIXELS = 1024

RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "30"))  # 0 turns it off
recent_request_times_by_client = {}

cached_inference_sessions = {}


def is_rate_limited(client_identifier: str) -> bool:
    """Best effort limit kept per warm instance. Add a Vercel Firewall rate limit rule for a hard limit."""
    if RATE_LIMIT_PER_MINUTE <= 0:
        return False
    current_time = time.monotonic()
    recent_times = [
        request_time for request_time in recent_request_times_by_client.get(client_identifier, [])
        if current_time - request_time < 60
    ]
    is_limited = len(recent_times) >= RATE_LIMIT_PER_MINUTE
    if not is_limited:
        recent_times.append(current_time)
    if recent_times:
        recent_request_times_by_client[client_identifier] = recent_times
    else:
        recent_request_times_by_client.pop(client_identifier, None)
    return is_limited


def get_model_path(model_identifier):
    return os.path.join(PROJECT_ROOT_DIRECTORY, "models", f"{model_identifier}.onnx")


def get_available_model_identifiers():
    """Models that are both enabled and actually present on disk."""
    return [
        identifier
        for identifier in get_requested_model_identifiers()
        if identifier in MODEL_REGISTRY and os.path.exists(get_model_path(identifier))
    ]


def get_inference_session(model_identifier):
    """Loads each model once per warm function instance."""
    if model_identifier not in cached_inference_sessions:
        cached_inference_sessions[model_identifier] = onnxruntime.InferenceSession(
            get_model_path(model_identifier), providers=["CPUExecutionProvider"]
        )
    return cached_inference_sessions[model_identifier]


def predict_mask(image: Image.Image, model_identifier: str) -> Image.Image:
    """Returns a grayscale mask, white where the subject is, at the image's size."""
    settings = MODEL_REGISTRY[model_identifier]
    input_size = settings["input_size"]
    inference_session = get_inference_session(model_identifier)

    resized_image = image.convert("RGB").resize((input_size, input_size), Image.Resampling.LANCZOS)
    pixel_array = np.asarray(resized_image, dtype=np.float32)
    pixel_array = pixel_array / max(float(pixel_array.max()), 1e-6)
    pixel_array = (pixel_array - np.array(settings["mean"], dtype=np.float32)) / np.array(
        settings["standard_deviation"], dtype=np.float32
    )
    input_tensor = np.expand_dims(pixel_array.transpose(2, 0, 1), axis=0).astype(np.float32)

    input_name = inference_session.get_inputs()[0].name
    prediction = inference_session.run(None, {input_name: input_tensor})[0][:, 0, :, :]

    lowest_value, highest_value = float(prediction.min()), float(prediction.max())
    prediction = (prediction - lowest_value) / max(highest_value - lowest_value, 1e-6)
    mask_array = (np.squeeze(prediction) * 255).astype(np.uint8)
    return Image.fromarray(mask_array).resize(image.size, Image.Resampling.LANCZOS)


def remove_background(image: Image.Image, model_identifier: str) -> Image.Image:
    cutout_image = image.convert("RGBA")
    cutout_image.putalpha(predict_mask(image, model_identifier))
    return cutout_image


def get_browser_models():
    """Models the visitor may choose to run in their own browser (static files under /models)."""
    return [
        {
            "id": identifier,
            "label": MODEL_REGISTRY[identifier]["label"],
            "description": MODEL_REGISTRY[identifier]["description"],
            "input_size": MODEL_REGISTRY[identifier]["input_size"],
            "mean": list(MODEL_REGISTRY[identifier]["mean"]),
            "standard_deviation": list(MODEL_REGISTRY[identifier]["standard_deviation"]),
            "url": f"/models/{identifier}.onnx",
        }
        for identifier in get_browser_model_identifiers()
        if identifier in MODEL_REGISTRY
    ]


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        available_identifiers = get_available_model_identifiers()
        self.send_json(200, {
            "default": available_identifiers[0] if available_identifiers else None,
            "browser_models": get_browser_models(),
            "models": [
                {
                    "id": identifier,
                    "label": MODEL_REGISTRY[identifier]["label"],
                    "description": MODEL_REGISTRY[identifier]["description"],
                }
                for identifier in available_identifiers
            ],
        })

    def do_POST(self):
        client_identifier = self.headers.get("x-forwarded-for", "").split(",")[0].strip() or self.client_address[0]
        if is_rate_limited(client_identifier):
            return self.send_json(429, {"error": "Too many requests. Wait a minute and try again."})

        available_identifiers = get_available_model_identifiers()
        if not available_identifiers:
            return self.send_json(503, {"error": "No model is installed on this server."})

        requested_models = parse_qs(urlparse(self.path).query).get("model")
        model_identifier = requested_models[0] if requested_models else available_identifiers[0]
        if model_identifier not in available_identifiers:
            return self.send_json(400, {"error": f"The model '{model_identifier}' is not available on this server."})

        request_size = int(self.headers.get("Content-Length") or 0)
        if request_size == 0:
            return self.send_json(400, {"error": "No image was received. Choose an image and try again."})
        if request_size > MAXIMUM_REQUEST_BYTES:
            return self.send_json(413, {"error": "The image is too large. Use an image under 4 MB."})

        try:
            uploaded_image = Image.open(io.BytesIO(self.rfile.read(request_size)))
            uploaded_image.load()
        except Exception:
            return self.send_json(400, {"error": "This file could not be read as an image. Use a PNG, JPG or WebP."})

        uploaded_image.thumbnail((MAXIMUM_IMAGE_SIDE_IN_PIXELS, MAXIMUM_IMAGE_SIDE_IN_PIXELS))

        try:
            cutout_image = remove_background(uploaded_image, model_identifier)
        except Exception as error:
            return self.send_json(500, {"error": f"Background removal failed: {error}"})

        output_buffer = io.BytesIO()
        cutout_image.save(output_buffer, format="PNG")
        png_bytes = output_buffer.getvalue()

        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(png_bytes)

    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
