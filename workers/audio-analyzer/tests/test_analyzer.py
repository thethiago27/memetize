from __future__ import annotations

import json
import subprocess
import sys

import pytest

from audio_analyzer.analyzer import analyze_audio


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
