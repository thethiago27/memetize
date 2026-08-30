"""Node <-> Python protocol entry point (spec sections 9 and 10).

Reads a WorkerRequest as JSON on stdin, writes a single JSON WorkerResult on
stdout, and sends logs to stderr. Exit code 0 means success.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any


def _log(event: str, **fields: Any) -> None:
    payload = {"level": "info", "worker": "scene-detector", "event": event, **fields}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def main() -> int:
    started = time.time()
    raw = sys.stdin.read()

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as error:
        _emit(
            {
                "jobId": "",
                "status": "failed",
                "error": {"code": "BAD_REQUEST", "message": str(error), "retryable": False},
            }
        )
        return 1

    job_id = request.get("jobId", "")
    worker_version = request.get("workerVersion", "1.0.0")
    input_data = request.get("input", {})
    asset_id = input_data.get("assetId")
    video_path = input_data.get("analysisPath")

    try:
        from scene_detector.detector import detect_scenes

        result = detect_scenes(video_path)
    except Exception as error:  # noqa: BLE001 - report any failure through the protocol
        _emit(
            {
                "jobId": job_id,
                "status": "failed",
                "error": {
                    "code": "SCENE_DETECT_ERROR",
                    "message": str(error),
                    "retryable": False,
                },
            }
        )
        return 1

    _log("scene_detection_completed", assetId=asset_id, sceneCount=len(result["scenes"]))
    _emit(
        {
            "jobId": job_id,
            "status": "success",
            "output": {
                "assetId": asset_id,
                "detector": result["detector"],
                "detectorVersion": result["detectorVersion"],
                "scenes": result["scenes"],
            },
            "metadata": {
                "processingTimeMs": int((time.time() - started) * 1000),
                "workerVersion": worker_version,
            },
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
