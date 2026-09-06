"""Tests for the shared Node <-> Python protocol."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from memetize_worker.protocol import is_retryable, run_worker  # noqa: E402


def _run(monkeypatch, capsys, request_text: str, handle):
    monkeypatch.setattr(sys, "stdin", io.StringIO(request_text))
    code = run_worker(worker="test", error_code="TEST_ERROR", handle=handle)
    return code, json.loads(capsys.readouterr().out)


def test_success_echoes_the_job_id_and_output(monkeypatch, capsys):
    request = json.dumps({"jobId": "job_1", "workerVersion": "2.0.0", "input": {"n": 2}})
    code, result = _run(monkeypatch, capsys, request, lambda data: {"doubled": data["n"] * 2})

    assert code == 0
    assert result["jobId"] == "job_1"
    assert result["status"] == "success"
    assert result["output"] == {"doubled": 4}
    assert result["metadata"]["workerVersion"] == "2.0.0"


def test_a_failure_keeps_the_job_id_so_the_node_side_can_read_it(monkeypatch, capsys):
    def boom(_data):
        raise ValueError("bad frame")

    request = json.dumps({"jobId": "job_2", "input": {}})
    code, result = _run(monkeypatch, capsys, request, boom)

    assert code == 1
    # The decoder rejects a response whose jobId does not match the request, so
    # echoing it is what keeps the structured error from being discarded (F14).
    assert result["jobId"] == "job_2"
    assert result["error"]["code"] == "TEST_ERROR"
    assert result["error"]["message"] == "bad frame"
    assert result["error"]["retryable"] is False


def test_a_transient_failure_is_reported_as_retryable(monkeypatch, capsys):
    def boom(_data):
        raise RuntimeError("failed to download model weights")

    request = json.dumps({"jobId": "job_3", "input": {}})
    code, result = _run(monkeypatch, capsys, request, boom)

    assert code == 1
    assert result["error"]["retryable"] is True


def test_an_unreadable_request_says_so_rather_than_emitting_a_bare_job_id(monkeypatch, capsys):
    code, result = _run(monkeypatch, capsys, "not json", lambda _data: {})

    assert code == 1
    assert result["status"] == "failed"
    assert result["error"]["code"] == "BAD_REQUEST"
    assert "could not decode the request" in result["error"]["message"]


@pytest.mark.parametrize(
    "error",
    [
        ConnectionError("reset by peer"),
        TimeoutError("took too long"),
        MemoryError("out of memory"),
        OSError(28, "No space left on device"),
        RuntimeError("Rate limit exceeded"),
    ],
)
def test_transient_faults_are_retryable(error):
    assert is_retryable(error) is True


@pytest.mark.parametrize(
    "error",
    [
        ValueError("unsupported codec"),
        KeyError("segments"),
        FileNotFoundError(2, "No such file or directory"),
    ],
)
def test_permanent_faults_are_not_retryable(error):
    assert is_retryable(error) is False
