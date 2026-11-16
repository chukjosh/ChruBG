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
