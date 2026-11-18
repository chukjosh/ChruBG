import json
import os
import subprocess
import sys

import pytest

ROOT_DIRECTORY = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT_DIRECTORY)
import local_video as video  # noqa: E402

pytestmark = pytest.mark.skipif(
    not video.get_local_video_status()["available"], reason="Needs ffmpeg and the video model: run scripts/download_model.py"
)


@pytest.fixture(scope="module")
def sample_video_path(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("clips") / "sample.mp4")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=1:size=160x120:rate=10", "-pix_fmt", "yuv420p", path],
        check=True,
    )
    return path


def describe_video(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def test_status_lists_the_video_model_under_its_public_name():
    status = video.get_local_video_status()
    assert status["available"] is True
    assert [model["label"] for model in status["models"]] == ["Flow"]
    assert "rvm" not in json.dumps(status)


def test_solid_background_mp4_keeps_size_and_length(sample_video_path, tmp_path):
    output_path = str(tmp_path / "output.mp4")
    video.remove_video_background(sample_video_path, output_path, "mp4", (0, 255, 0))
    description = describe_video(output_path)
    assert description["streams"][0]["codec_name"] == "h264"
    assert (description["streams"][0]["width"], description["streams"][0]["height"]) == (160, 120)
    assert 0.8 < float(description["format"]["duration"]) < 1.3


def test_transparent_webm_is_created(sample_video_path, tmp_path):
    output_path = str(tmp_path / "output.webm")
    video.remove_video_background(sample_video_path, output_path, "webm")
    assert describe_video(output_path)["streams"][0]["codec_name"] == "vp9"


def test_videos_over_the_limit_are_rejected(sample_video_path, tmp_path, monkeypatch):
    monkeypatch.setattr(video, "MAXIMUM_VIDEO_SECONDS", 0.5)
    with pytest.raises(video.VideoProcessingError):
        video.remove_video_background(sample_video_path, str(tmp_path / "output.mp4"), "mp4")


def test_a_file_that_is_not_a_video_is_rejected(tmp_path):
    not_a_video = tmp_path / "notes.txt"
    not_a_video.write_text("hello")
    with pytest.raises(video.VideoProcessingError):
        video.remove_video_background(str(not_a_video), str(tmp_path / "output.mp4"), "mp4")


@pytest.fixture(scope="module")
def sample_video_with_audio_path(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("clips-with-audio") / "sample-audio.mp4")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=1:size=160x120:rate=10",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-pix_fmt", "yuv420p", "-shortest", path],
        check=True,
    )
    return path


def audio_codec_names(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.split()


def test_audio_is_kept_by_default_in_both_formats(sample_video_with_audio_path, tmp_path):
    mp4_path, webm_path = str(tmp_path / "output.mp4"), str(tmp_path / "output.webm")
    video.remove_video_background(sample_video_with_audio_path, mp4_path, "mp4")
    video.remove_video_background(sample_video_with_audio_path, webm_path, "webm")
    assert audio_codec_names(mp4_path) == ["aac"]
    assert audio_codec_names(webm_path) == ["opus"]


def test_audio_is_left_out_when_turned_off(sample_video_with_audio_path, tmp_path):
    output_path = str(tmp_path / "output.mp4")
    video.remove_video_background(sample_video_with_audio_path, output_path, "mp4", keep_audio=False)
    assert audio_codec_names(output_path) == []


def test_a_clip_without_audio_still_works_with_audio_on(sample_video_path, tmp_path):
    output_path = str(tmp_path / "output.mp4")
    video.remove_video_background(sample_video_path, output_path, "mp4", keep_audio=True)
    assert audio_codec_names(output_path) == []


def test_a_background_image_replaces_the_solid_colour(sample_video_path, tmp_path):
    from PIL import Image
    import numpy as np

    red_picture = str(tmp_path / "red.png")
    Image.new("RGB", (64, 64), (255, 0, 0)).save(red_picture)
    output_path = str(tmp_path / "output.mp4")
    video.remove_video_background(sample_video_path, output_path, "mp4", (0, 255, 0), keep_audio=False, background_image_path=red_picture)

    first_frame = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", output_path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    red, green, blue = np.frombuffer(first_frame, dtype=np.uint8).reshape(-1, 3).mean(axis=0)
    assert red > 200 and green < 60 and blue < 60, "the test pattern has no subject, so the frame should be almost all background"


def test_background_images_are_stored_and_checked(tmp_path):
    import io
    from PIL import Image

    picture = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 20, 30)).save(picture, format="PNG")
    token = video.store_background_image(picture.getvalue())
    assert token in video.stored_background_images
    with pytest.raises(video.VideoProcessingError):
        video.store_background_image(b"not an image")


def test_trimming_keeps_only_the_chosen_section(tmp_path):
    long_clip = str(tmp_path / "two-seconds.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=2:size=160x120:rate=10", "-pix_fmt", "yuv420p", long_clip], check=True)
    output_path = str(tmp_path / "trimmed.mp4")
    video.remove_video_background(long_clip, output_path, "mp4", start_seconds=0.5, end_seconds=1.5, keep_audio=False)
    assert 0.8 < float(describe_video(output_path)["format"]["duration"]) < 1.25


def test_the_limit_applies_to_the_chosen_section_and_not_the_whole_file(tmp_path, monkeypatch):
    long_clip = str(tmp_path / "two-seconds.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=2:size=160x120:rate=10", "-pix_fmt", "yuv420p", long_clip], check=True)
    monkeypatch.setattr(video, "MAXIMUM_VIDEO_SECONDS", 1.2)
    video.remove_video_background(long_clip, str(tmp_path / "short-section.mp4"), "mp4", start_seconds=0.2, end_seconds=1.0, keep_audio=False)
    with pytest.raises(video.VideoProcessingError):
        video.remove_video_background(long_clip, str(tmp_path / "whole.mp4"), "mp4", keep_audio=False)


def test_an_end_before_the_start_is_rejected(sample_video_path, tmp_path):
    with pytest.raises(video.VideoProcessingError):
        video.remove_video_background(sample_video_path, str(tmp_path / "output.mp4"), "mp4", start_seconds=0.8, end_seconds=0.3)


def test_a_blurred_background_differs_from_the_solid_colour(sample_video_path, tmp_path):
    import numpy as np

    def first_frame_average(path):
        frame = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
        return np.frombuffer(frame, dtype=np.uint8).reshape(-1, 3).mean(axis=0)

    solid_path, blurred_path = str(tmp_path / "solid.mp4"), str(tmp_path / "blurred.mp4")
    video.remove_video_background(sample_video_path, solid_path, "mp4", (0, 255, 0), keep_audio=False)
    video.remove_video_background(sample_video_path, blurred_path, "mp4", keep_audio=False, blur_background=True)
    assert abs(first_frame_average(solid_path) - first_frame_average(blurred_path)).max() > 30
