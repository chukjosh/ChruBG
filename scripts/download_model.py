"""Downloads models. Server models go to models/, in-browser models go to public/models/.

Runs automatically at build time (see buildCommand in vercel.json).
Run it by hand before using `vercel dev` or local_server.py.

Example: ENABLED_MODELS=isnet-general-use,silueta BROWSER_MODELS=silueta python3 scripts/download_model.py
"""
import os
import sys
import urllib.request

PROJECT_ROOT_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(PROJECT_ROOT_DIRECTORY, "api"))
from _model_registry import (  # noqa: E402
    MODEL_REGISTRY,
    VIDEO_MODEL_REGISTRY,
    get_browser_video_model_identifiers,
    get_enabled_video_model_identifiers,
    get_video_public_id,
    get_browser_model_identifiers,
    get_public_id,
    get_requested_model_identifiers,
)


def download_model(model_identifier, target_directory, file_name=None, registry=MODEL_REGISTRY):
    if model_identifier not in registry:
        sys.exit(f"Unknown model '{model_identifier}'. Choose from: {', '.join(registry)}")

    os.makedirs(target_directory, exist_ok=True)
    model_path = os.path.join(target_directory, f"{file_name or model_identifier}.onnx")
    if os.path.exists(model_path):
        print(f"Already present: {model_path}")
        return

    download_url = registry[model_identifier].get("download_url")
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
    download_model(identifier, os.path.join(PROJECT_ROOT_DIRECTORY, "public", "models"), get_public_id(identifier))

# Video models. The local one is for self-hosted setups, so Vercel skips it.
if not os.environ.get("VERCEL"):
    for identifier in get_enabled_video_model_identifiers():
        download_model(identifier, os.path.join(PROJECT_ROOT_DIRECTORY, "models"), registry=VIDEO_MODEL_REGISTRY)
for identifier in get_browser_video_model_identifiers():
    download_model(identifier, os.path.join(PROJECT_ROOT_DIRECTORY, "public", "models"), get_video_public_id(identifier), VIDEO_MODEL_REGISTRY)


# Vercel functions have a size limit, and the Python packages already use most of it.
# Warn in the build log, instead of letting the build fail later with a less clear error.
STANDARD_VERCEL_MODEL_BUDGET_IN_MEGABYTES = 35


def warn_if_server_models_may_not_fit_on_vercel():
    if not os.environ.get("VERCEL") or os.environ.get("VERCEL_SUPPORT_LARGE_FUNCTIONS") == "1":
        return
    total_megabytes = sum(
        os.path.getsize(os.path.join(PROJECT_ROOT_DIRECTORY, "models", f"{identifier}.onnx"))
        for identifier in get_requested_model_identifiers()
    ) / 1_000_000
    if total_megabytes > STANDARD_VERCEL_MODEL_BUDGET_IN_MEGABYTES:
        print(
            f"WARNING: the server models total {total_megabytes:.0f} MB. This will probably fail with LAMBDA_SIZE_EXCEEDED "
            "on a standard Vercel function. Fix it with ENABLED_MODELS=u2netp, or ENABLED_MODELS=none to use in-browser mode only, "
            "or enable large functions with VERCEL_SUPPORT_LARGE_FUNCTIONS=1. See the README."
        )


warn_if_server_models_may_not_fit_on_vercel()
