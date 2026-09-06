"""The Node <-> Python protocol, shared by every Python worker (spec sections 9, 10).

Reads a WorkerRequest as JSON on stdin, writes a single JSON WorkerResult on
stdout, and sends logs to stderr. Exit code 0 means success; a declared failure
exits 1 with a structured `failed` result, which the Node side preserves
verbatim (F14).

The three workers used to carry their own ~85-line copy of this, which is how
two defects survived in all of them at once: a malformed request answered with
`"jobId": ""` — a mismatch the Node decoder rejects, so the structured error was
discarded and reported as a protocol violation — and every failure was hardcoded
`retryable: False`, so a transient fault (a model download, an out-of-memory
kill) was never retried.
"""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable
from typing import Any

#: Exception types that mean "try again": the fault is in the environment
#: (network, disk, memory, a transient OS condition), not in the request.
RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    ConnectionError,
    TimeoutError,
    MemoryError,
    BlockingIOError,
    InterruptedError,
)

#: Substrings of an error message that also mean "try again". Libraries in this
#: stack (librosa, mlx, huggingface) often surface transient faults as a plain
#: RuntimeError/OSError, so the type alone is not enough.
RETRYABLE_MESSAGE_MARKERS: tuple[str, ...] = (
    "connection",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "temporary failure",
    "network",
    "rate limit",
    "too many requests",
    "out of memory",
    "cannot allocate memory",
    "no space left",
    "resource temporarily unavailable",
    "download",
    "incomplete read",
)


def is_retryable(error: BaseException) -> bool:
    """Whether a failure is worth another attempt.

    An `OSError` is retryable only when its errno says so — a missing file is
    permanent, a full disk or a broken pipe is not.
    """
    if isinstance(error, RETRYABLE_EXCEPTIONS):
        return True
    if isinstance(error, OSError) and error.errno in {
        11,  # EAGAIN
        4,  # EINTR
        28,  # ENOSPC
        32,  # EPIPE
        104,  # ECONNRESET
        110,  # ETIMEDOUT
    }:
        return True
    message = str(error).lower()
    return any(marker in message for marker in RETRYABLE_MESSAGE_MARKERS)


def emit(payload: dict[str, Any]) -> None:
    """Writes the single JSON result on stdout."""
    print(json.dumps(payload), flush=True)


def log(worker: str, event: str, **fields: Any) -> None:
    """Writes one structured log line on stderr."""
    payload = {"level": "info", "worker": worker, "event": event, **fields}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def run_worker(
    *,
    worker: str,
    error_code: str,
    handle: Callable[[dict[str, Any]], dict[str, Any]],
) -> int:
    """Runs one worker invocation end to end and returns its exit code.

    `handle` receives the request's `input` object and returns the result's
    `output` object; everything else — decoding, timing, the result envelope,
    failure classification — is the protocol's job, not the worker's.
    """
    started = time.time()
    raw = sys.stdin.read()
    job_id = ""

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as error:
        # The request is unreadable, so there is no jobId to echo. Emitting an
        # empty one would make the Node decoder reject the whole response as a
        # protocol violation and lose this message, so say so in the message.
        emit(
            {
                "jobId": "",
                "status": "failed",
                "error": {
                    "code": "BAD_REQUEST",
                    "message": f"could not decode the request: {error}",
                    "retryable": False,
                },
            }
        )
        return 1

    if not isinstance(request, dict):
        emit(
            {
                "jobId": "",
                "status": "failed",
                "error": {
                    "code": "BAD_REQUEST",
                    "message": f"expected a JSON object request, got {type(request).__name__}",
                    "retryable": False,
                },
            }
        )
        return 1

    job_id = request.get("jobId", "")
    worker_version = request.get("workerVersion", "1.0.0")
    input_data = request.get("input", {})

    try:
        output = handle(input_data)
    except Exception as error:  # noqa: BLE001 - report any failure through the protocol
        emit(
            {
                "jobId": job_id,
                "status": "failed",
                "error": {
                    "code": error_code,
                    "message": str(error),
                    "retryable": is_retryable(error),
                },
            }
        )
        return 1

    emit(
        {
            "jobId": job_id,
            "status": "success",
            "output": output,
            "metadata": {
                "processingTimeMs": int((time.time() - started) * 1000),
                "workerVersion": worker_version,
            },
        }
    )
    return 0
