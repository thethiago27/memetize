from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

FFMPEG = shutil.which("ffmpeg")


def _make_clip(path: Path) -> None:
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=30",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not available")
def test_single_shot_returns_one_scene(tmp_path: Path) -> None:
    from scene_detector.detector import detect_scenes

    clip = tmp_path / "clip.mp4"
    _make_clip(clip)

    result = detect_scenes(str(clip))

    assert result["detector"] == "pyscenedetect-content"
    assert len(result["scenes"]) >= 1
    first = result["scenes"][0]
    assert first["startMs"] == 0
    assert isinstance(first["startMs"], int)
    assert isinstance(first["endMs"], int)
    assert first["endMs"] > 0


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not available")
def test_protocol_stdout_is_single_json(tmp_path: Path) -> None:
    clip = tmp_path / "clip.mp4"
    _make_clip(clip)

    request = json.dumps(
        {
            "jobId": "job_1",
            "entityId": "ast_1",
            "workerVersion": "1.0.0",
            "input": {"assetId": "ast_1", "analysisPath": str(clip)},
        }
    )
    proc = subprocess.run(
        [sys.executable, "-m", "scene_detector"],
        input=request,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["status"] == "success"
    assert payload["output"]["assetId"] == "ast_1"
    assert len(payload["output"]["scenes"]) >= 1
