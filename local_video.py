"""Local video background removal, used by local_server.py and Docker. It is not deployed on Vercel.

It needs ffmpeg and ffprobe on the PATH, plus the video model in models/.
The upload is saved to a temporary folder while it is processed, then the folder is deleted.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnxruntime
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "api"))
from _model_registry import VIDEO_MODEL_REGISTRY, get_enabled_video_model_identifiers, get_video_public_id  # noqa: E402

PROJECT_ROOT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
MAXIMUM_UPLOAD_BYTES = int(os.environ.get("MAXIMUM_VIDEO_UPLOAD_MEGABYTES", "200")) * 1_000_000
MAXIMUM_VIDEO_SECONDS = float(os.environ.get("MAXIMUM_VIDEO_SECONDS", "60"))
MAXIMUM_PROCESSING_SIDE_IN_PIXELS = int(os.environ.get("MAXIMUM_VIDEO_SIDE_IN_PIXELS", "960"))
OUTPUT_FRAMES_PER_SECOND = 24
UPLOAD_CHUNK_BYTES = 1_000_000


class VideoProcessingError(Exception):
    """A problem with the video that can be shown to the person."""


def get_available_video_model_identifiers():
    return [
        identifier for identifier in get_enabled_video_model_identifiers()
        if identifier in VIDEO_MODEL_REGISTRY
        and os.path.exists(os.path.join(PROJECT_ROOT_DIRECTORY, "models", f"{identifier}.onnx"))
    ]


def get_local_video_status():
    """What the page needs to know before it offers the local server as a choice."""
    model_identifiers = get_available_video_model_identifiers()
    has_ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    reason = ""
    if not has_ffmpeg:
        reason = "ffmpeg is not installed on the server."
    elif not model_identifiers:
        reason = "No video model is installed. Run scripts/download_model.py."
    return {
        "available": has_ffmpeg and bool(model_identifiers),
        "reason": reason,
        "maximum_seconds": MAXIMUM_VIDEO_SECONDS,
        "models": [
            {"id": get_video_public_id(identifier), "label": VIDEO_MODEL_REGISTRY[identifier]["label"]}
            for identifier in model_identifiers
        ],
    }


def build_scale_filter(longest_side):
    """Shrinks large videos, keeps both sides even, and works for any orientation."""
    return (
        f"scale=w='if(gt(iw,ih),trunc(min({longest_side},iw)/2)*2,-2)':"
        f"h='if(gt(iw,ih),-2,trunc(min({longest_side},ih)/2)*2)'"
    )


def read_duration_seconds(video_path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", video_path],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (ValueError, KeyError, TypeError):
        raise VideoProcessingError("This file could not be read as a video.")


def measure_frame_size(video_path, folder):
    """Decodes one frame the same way the main pass will, so rotated phone videos report the right size."""
    first_frame_path = os.path.join(folder, "first-frame.png")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", video_path, "-vf", build_scale_filter(MAXIMUM_PROCESSING_SIDE_IN_PIXELS),
         "-frames:v", "1", first_frame_path],
        capture_output=True,
    )
    if not os.path.exists(first_frame_path):
        raise VideoProcessingError("This file could not be read as a video.")
    with Image.open(first_frame_path) as first_frame:
        return first_frame.size


def build_writer_command(output_kind, width, height, output_path):
    common_input = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-s", f"{width}x{height}", "-r", str(OUTPUT_FRAMES_PER_SECOND)]
    if output_kind == "webm":
        return common_input + ["-pix_fmt", "rgba", "-i", "pipe:0", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                               "-auto-alt-ref", "0", "-b:v", "0", "-crf", "32", output_path]
    return common_input + ["-pix_fmt", "rgb24", "-i", "pipe:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                           "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", output_path]


def remove_video_background(video_path, output_path, output_kind, background_rgb=(0, 255, 0)):
    """Writes output_path as an MP4 with a solid background, or a transparent WebM."""
    if output_kind not in ("mp4", "webm"):
        raise VideoProcessingError("The output must be mp4 or webm.")
    if read_duration_seconds(video_path) > MAXIMUM_VIDEO_SECONDS:
        raise VideoProcessingError(f"This video is too long. The local server handles up to {MAXIMUM_VIDEO_SECONDS:g} seconds.")
    model_identifiers = get_available_video_model_identifiers()
    if not model_identifiers:
        raise VideoProcessingError("No video model is installed on this server.")

    with tempfile.TemporaryDirectory() as folder:
        width, height = measure_frame_size(video_path, folder)
        session = onnxruntime.InferenceSession(
            os.path.join(PROJECT_ROOT_DIRECTORY, "models", f"{model_identifiers[0]}.onnx"), providers=["CPUExecutionProvider"]
        )
        downsample_ratio = np.array([max(0.25, min(1.0, 512 / max(width, height)))], dtype=np.float32)
        recurrent_states = [np.zeros((1, 1, 1, 1), dtype=np.float32) for _ in range(4)]  # carried between frames

        error_log_path = os.path.join(folder, "ffmpeg-errors.txt")
        with open(error_log_path, "wb") as error_log:
            reader = subprocess.Popen(
                ["ffmpeg", "-v", "error", "-i", video_path,
                 "-vf", f"{build_scale_filter(MAXIMUM_PROCESSING_SIDE_IN_PIXELS)},fps={OUTPUT_FRAMES_PER_SECOND}",
                 "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                stdout=subprocess.PIPE, stderr=error_log,
            )
            writer = subprocess.Popen(build_writer_command(output_kind, width, height, output_path), stdin=subprocess.PIPE, stderr=error_log)
            frame_byte_count = width * height * 3
            background = np.array(background_rgb, dtype=np.float32)
            frames_written = 0
            try:
                while True:
                    frame_bytes = reader.stdout.read(frame_byte_count)
                    if len(frame_bytes) < frame_byte_count:
                        break
                    frame = np.frombuffer(frame_bytes, dtype=np.uint8).reshape(height, width, 3)
                    source = (frame.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
                    outputs = session.run(None, {
                        "src": source, "r1i": recurrent_states[0], "r2i": recurrent_states[1],
                        "r3i": recurrent_states[2], "r4i": recurrent_states[3], "downsample_ratio": downsample_ratio,
                    })
                    alpha = np.clip(outputs[1][0, 0], 0.0, 1.0)
                    recurrent_states = list(outputs[2:6])

                    if output_kind == "webm":
                        output_frame = np.dstack([frame, (alpha * 255).astype(np.uint8)])
                    else:
                        output_frame = (frame * alpha[..., None] + background * (1 - alpha[..., None])).astype(np.uint8)
                    writer.stdin.write(output_frame.tobytes())
                    frames_written += 1
            finally:
                reader.stdout.close()
                reader.wait()
                writer.stdin.close()
                writer.wait()

        if frames_written == 0 or writer.returncode != 0 or not os.path.exists(output_path):
            with open(error_log_path, "rb") as error_log:
                details = error_log.read().decode("utf-8", "replace").strip().splitlines()[-1:] or ["unknown error"]
            raise VideoProcessingError(f"ffmpeg could not process this video ({details[0]}).")


def parse_hex_color(text):
    text = text.lstrip("#")
    if len(text) != 6:
        raise VideoProcessingError("The background colour must look like #00ff00.")
    try:
        return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))
    except ValueError:
        raise VideoProcessingError("The background colour must look like #00ff00.")


def handle_video_post(request_handler):
    """Receives the video from the page, processes it and sends the result back."""
    status = get_local_video_status()
    if not status["available"]:
        return request_handler.send_json(503, {"error": status["reason"]})

    query = parse_qs(urlparse(request_handler.path).query)
    output_kind = (query.get("output") or ["mp4"])[0]
    upload_size = int(request_handler.headers.get("Content-Length") or 0)
    if upload_size == 0:
        return request_handler.send_json(400, {"error": "No video was received."})
    if upload_size > MAXIMUM_UPLOAD_BYTES:
        return request_handler.send_json(413, {"error": f"The video is too large. The limit is {MAXIMUM_UPLOAD_BYTES // 1_000_000} MB."})

    try:
        background_rgb = parse_hex_color((query.get("background") or ["#00ff00"])[0])
        with tempfile.TemporaryDirectory() as folder:
            input_path = os.path.join(folder, "input")
            output_path = os.path.join(folder, f"output.{output_kind}")
            remaining_bytes = upload_size
            with open(input_path, "wb") as input_file:
                while remaining_bytes > 0:
                    chunk = request_handler.rfile.read(min(UPLOAD_CHUNK_BYTES, remaining_bytes))
                    if not chunk:
                        break
                    input_file.write(chunk)
                    remaining_bytes -= len(chunk)
            remove_video_background(input_path, output_path, output_kind, background_rgb)
            with open(output_path, "rb") as output_file:
                video_bytes = output_file.read()
    except VideoProcessingError as error:
        return request_handler.send_json(400, {"error": str(error)})
    except Exception as error:
        return request_handler.send_json(500, {"error": f"Video processing failed: {error}"})

    request_handler.send_response(200)
    request_handler.send_header("Content-Type", f"video/{output_kind}")
    request_handler.send_header("Content-Length", str(len(video_bytes)))
    request_handler.send_header("Cache-Control", "no-store")
    request_handler.end_headers()
    request_handler.wfile.write(video_bytes)
