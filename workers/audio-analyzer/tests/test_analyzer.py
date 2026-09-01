from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from audio_analyzer.analyzer import analyze_audio

FFMPEG = shutil.which("ffmpeg")
LIBROSA_AVAILABLE = importlib.util.find_spec("librosa") is not None
LIBROSA_READY = FFMPEG is not None and LIBROSA_AVAILABLE


def _encode_sine(path: Path, *, codec: str, fmt: str, duration_s: float = 2) -> None:
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_s}",
            "-c:a",
            codec,
            "-f",
            fmt,
            str(path),
        ],
        check=True,
        capture_output=True,
    )


def test_same_duration_yields_same_beats_and_sections() -> None:
    first = analyze_audio(6000)
    second = analyze_audio(6000)
    assert first == second


def test_times_are_integers_and_last_beat_is_before_duration() -> None:
    result = analyze_audio(6000)
    for beat in result["beats"]:
        assert isinstance(beat["timeMs"], int)
    assert result["beats"][-1]["timeMs"] < 6000
    for section in result["sections"]:
        assert isinstance(section["startMs"], int)
        assert isinstance(section["endMs"], int)
    assert result["sections"][-1]["endMs"] == 6000


def test_downbeats_are_a_subset_of_beats_every_four() -> None:
    result = analyze_audio(6000)
    beat_times = [beat["timeMs"] for beat in result["beats"]]
    assert result["downbeats"] == beat_times[::4]


def test_rejects_non_positive_duration() -> None:
    with pytest.raises(ValueError):
        analyze_audio(0)


def test_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError):
        analyze_audio(6000, provider="essentia")


def test_librosa_requires_a_path() -> None:
    with pytest.raises(ValueError, match="path"):
        analyze_audio(6000, provider="librosa")


def test_protocol_stdout_is_single_json() -> None:
    request = json.dumps(
        {
            "jobId": "job_1",
            "entityId": "prj_1",
            "workerVersion": "1.0.0",
            "input": {"projectId": "prj_1", "durationMs": 4000},
        }
    )
    proc = subprocess.run(
        [sys.executable, "-m", "audio_analyzer"],
        input=request,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["status"] == "success"
    assert payload["output"]["projectId"] == "prj_1"
    assert len(payload["output"]["beats"]) >= 1


@pytest.mark.skipif(not LIBROSA_READY, reason="librosa extra and ffmpeg are required")
def test_librosa_analyzes_aac_in_mp4_named_mp3(tmp_path: Path) -> None:
    """Ingest accepts .mp3; uploads are often AAC in an MP4 container (YouTube/DASH).
    librosa.load → libsndfile → mpg123 then dies looking for an MPEG header."""
    path = tmp_path / "original.mp3"
    _encode_sine(path, codec="aac", fmt="mp4")

    result = analyze_audio(2000, provider="librosa", path=str(path))

    assert result["analyzer"] == "librosa"
    assert result["durationMs"] == 2000
    assert result["bpm"] > 0
    assert len(result["beats"]) >= 1
    assert result["beats"][-1]["timeMs"] < 2000
    assert result["sections"][-1]["endMs"] == 2000


@pytest.mark.skipif(not LIBROSA_READY, reason="librosa extra and ffmpeg are required")
def test_librosa_analyzes_real_mp3(tmp_path: Path) -> None:
    path = tmp_path / "original.mp3"
    _encode_sine(path, codec="libmp3lame", fmt="mp3")

    result = analyze_audio(2000, provider="librosa", path=str(path))

    assert result["analyzer"] == "librosa"
    assert len(result["beats"]) >= 1
