import pytest
from transcript_worker.transcriber import _resolve_mlx_repo, transcribe


def test_missing_audio_is_a_successful_empty_transcript():
    result = transcribe(None)
    assert result["segments"] == []
    assert result["model"] == "fixture"


def test_fixture_provider_ignores_audio_path():
    result = transcribe("/tmp/does-not-matter.wav", provider="fixture")
    assert result["segments"] == []
    assert result["modelVersion"] == "1.0.0"


def test_unsupported_provider_raises():
    with pytest.raises(ValueError):
        transcribe("/tmp/audio.wav", provider="unknown")


def test_resolve_mlx_repo_prefixes_short_names():
    assert _resolve_mlx_repo(None) == "mlx-community/whisper-tiny"
    assert _resolve_mlx_repo("whisper-small-mlx") == "mlx-community/whisper-small-mlx"
    assert (
        _resolve_mlx_repo("mlx-community/whisper-small-mlx")
        == "mlx-community/whisper-small-mlx"
    )
