"""Node <-> Python protocol entry point for the audio analyzer (spec sections 9, 10).

The protocol itself lives in `memetize_worker.protocol`, shared with the other
Python workers; this file only says what this worker does.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Each worker is a `package = false` uv project with its own virtualenv, so the
# shared protocol module is reached by path rather than as a dependency. Doing
# it here (instead of via PYTHONPATH) means it also works when a test or a shell
# spawns `python -m <worker>` directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python-shared"))

from memetize_worker.protocol import log, run_worker


def handle(input_data: dict[str, Any]) -> dict[str, Any]:
    from audio_analyzer.analyzer import analyze_audio

    project_id = input_data.get("projectId")
    result = analyze_audio(
        input_data.get("durationMs"),
        provider=input_data.get("provider") or "fixture",
        path=input_data.get("path"),
    )
    log("audio-analyzer", "audio_analyze_completed", projectId=project_id, beatCount=len(result["beats"]))
    return {
        "projectId": project_id,
        "durationMs": result["durationMs"],
        "bpm": result["bpm"],
        "beats": result["beats"],
        "downbeats": result["downbeats"],
        "sections": result["sections"],
        "energyCurve": result["energyCurve"],
        "analyzer": result["analyzer"],
        "analyzerVersion": result["analyzerVersion"],
    }


def main() -> int:
    return run_worker(worker="audio-analyzer", error_code="AUDIO_ANALYZE_ERROR", handle=handle)


if __name__ == "__main__":
    sys.exit(main())
