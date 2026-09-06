"""Node <-> Python protocol entry point for the scene detector (spec sections 9, 10).

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
    from scene_detector.detector import detect_scenes

    asset_id = input_data.get("assetId")
    result = detect_scenes(input_data.get("analysisPath"))
    log("scene-detector", "scene_detection_completed", assetId=asset_id, sceneCount=len(result["scenes"]))
    return {
        "assetId": asset_id,
        "detector": result["detector"],
        "detectorVersion": result["detectorVersion"],
        "scenes": result["scenes"],
    }


def main() -> int:
    return run_worker(worker="scene-detector", error_code="SCENE_DETECT_ERROR", handle=handle)


if __name__ == "__main__":
    sys.exit(main())
