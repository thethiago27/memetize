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
    payload = {"level": "info", "worker": "audio-analyzer", "event": event, **fields}
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
    project_id = input_data.get("projectId")
    duration_ms = input_data.get("durationMs")
    provider = input_data.get("provider") or "fixture"

    try:
        from audio_analyzer.analyzer import analyze_audio

        result = analyze_audio(duration_ms, provider=provider)
    except Exception as error:  # noqa: BLE001 - report any failure through the protocol
        _emit(
            {
                "jobId": job_id,
                "status": "failed",
                "error": {"code": "AUDIO_ANALYZE_ERROR", "message": str(error), "retryable": False},
            }
        )
        return 1

    _log("audio_analyze_completed", projectId=project_id, beatCount=len(result["beats"]))
    _emit(
        {
            "jobId": job_id,
            "status": "success",
            "output": {
                "projectId": project_id,
                "durationMs": result["durationMs"],
                "bpm": result["bpm"],
                "beats": result["beats"],
                "downbeats": result["downbeats"],
                "sections": result["sections"],
                "energyCurve": result["energyCurve"],
                "analyzer": result["analyzer"],
                "analyzerVersion": result["analyzerVersion"],
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
