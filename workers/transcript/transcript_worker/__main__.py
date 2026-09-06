"""Node <-> Python protocol entry point for the transcript worker (spec sections 9, 10).

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
    from transcript_worker.transcriber import transcribe

    asset_id = input_data.get("assetId")
    result = transcribe(
        input_data.get("audioPath"),
        provider=input_data.get("provider") or "fixture",
        model=input_data.get("model") or None,
    )
    log("transcript", "transcript_completed", assetId=asset_id, segmentCount=len(result["segments"]))
    return {
        "assetId": asset_id,
        "segments": result["segments"],
        "model": result["model"],
        "modelVersion": result["modelVersion"],
    }


def main() -> int:
    return run_worker(worker="transcript", error_code="TRANSCRIPT_ERROR", handle=handle)


if __name__ == "__main__":
    sys.exit(main())
