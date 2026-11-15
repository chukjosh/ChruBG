"""Downloads models. Server models go to models/, in-browser models go to public/models/.

Runs automatically at build time (see buildCommand in vercel.json).
Run it by hand before using `vercel dev` or server.py.

Example: ENABLED_MODELS=isnet-general-use,silueta BROWSER_MODELS=silueta python3 scripts/download_model.py
"""
import os
import sys
import urllib.request

PROJECT_ROOT_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(PROJECT_ROOT_DIRECTORY, "api"))
from _model_registry import (  # noqa: E402
    MODEL_REGISTRY,
    get_browser_model_identifiers,
    get_requested_model_identifiers,
)


def download_model(model_identifier, target_directory):
    if model_identifier not in MODEL_REGISTRY:
        sys.exit(f"Unknown model '{model_identifier}'. Choose from: {', '.join(MODEL_REGISTRY)}")

    os.makedirs(target_directory, exist_ok=True)
    model_path = os.path.join(target_directory, f"{model_identifier}.onnx")
    if os.path.exists(model_path):
        print(f"Already present: {model_path}")
        return

    download_url = MODEL_REGISTRY[model_identifier].get("download_url")
    if not download_url:
        sys.exit(f"'{model_identifier}' is a custom model with no download_url. Place its file at {model_path} first.")

    print(f"Downloading {model_identifier}...")
    temporary_path = model_path + ".part"
    urllib.request.urlretrieve(download_url, temporary_path)
    os.replace(temporary_path, model_path)
    print(f"Saved {model_path} ({os.path.getsize(model_path) / 1_000_000:.0f} MB)")


for identifier in get_requested_model_identifiers():
    download_model(identifier, os.path.join(PROJECT_ROOT_DIRECTORY, "models"))
for identifier in get_browser_model_identifiers():
    download_model(identifier, os.path.join(PROJECT_ROOT_DIRECTORY, "public", "models"))
