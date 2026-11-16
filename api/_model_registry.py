"""Registry of the background removal models ChruBG can run.

To support another model, add an entry below, then list its identifier in the
ENABLED_MODELS environment variable. Models that use the U2-Net style
preprocessing (resize, divide by the maximum, subtract mean, divide by
standard deviation) work with just a new entry.

The file name starts with an underscore so Vercel does not expose it as an endpoint.
"""
import os


def parse_model_list(comma_separated_names):
    """Turns 'a,b' into ['a', 'b']. The word 'none' or an empty value gives an empty list."""
    names = [name.strip() for name in comma_separated_names.split(",") if name.strip()]
    return [name for name in names if name.lower() != "none"]


RELEASES_BASE_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0"

MODEL_REGISTRY = {
    "isnet-general-use": {
        "public_id": "studio",
        "label": "Studio",
        "badge": "Recommended",
        "description": "Cleanest edges, great for people, products and fine detail. Takes longer.",
        "input_size": 1024,
        "mean": (0.485, 0.456, 0.406),
        "standard_deviation": (1.0, 1.0, 1.0),
        "download_url": f"{RELEASES_BASE_URL}/isnet-general-use.onnx",
    },
    "silueta": {
        "public_id": "swift",
        "label": "Swift",
        "description": "Quick and light. A good all-rounder for clear subjects.",
        "input_size": 320,
        "mean": (0.485, 0.456, 0.406),
        "standard_deviation": (0.229, 0.224, 0.225),
        "download_url": f"{RELEASES_BASE_URL}/silueta.onnx",
    },
    "u2netp": {
        "public_id": "spark",
        "label": "Spark",
        "description": "The fastest option. Best for simple, clear shapes.",
        "input_size": 320,
        "mean": (0.485, 0.456, 0.406),
        "standard_deviation": (0.229, 0.224, 0.225),
        "download_url": f"{RELEASES_BASE_URL}/u2netp.onnx",
    },
}

# Visitors only see "public_id", "label", "badge" and "description". The key and download_url stay on the server.
# The first enabled model is the default. Hosted instances should keep this list short.
DEFAULT_ENABLED_MODELS = "isnet-general-use,silueta,u2netp"


def get_requested_model_identifiers():
    """Reads ENABLED_MODELS, a comma separated list such as 'isnet-general-use,silueta'."""
    requested_models = os.environ.get("ENABLED_MODELS", DEFAULT_ENABLED_MODELS)
    return parse_model_list(requested_models)

# Models that visitors may choose to run inside their own browser. Served as static files.
DEFAULT_BROWSER_MODELS = "silueta"


def get_browser_model_identifiers():
    """Reads BROWSER_MODELS. Set it to an empty value to turn in-browser processing off."""
    requested_models = os.environ.get("BROWSER_MODELS", DEFAULT_BROWSER_MODELS)
    return parse_model_list(requested_models)


def get_public_id(model_identifier):
    """The name visitors see in URLs and the API. It keeps the underlying model name out of the page."""
    return MODEL_REGISTRY.get(model_identifier, {}).get("public_id", model_identifier)
