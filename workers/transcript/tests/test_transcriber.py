import pytest
from transcript_worker.transcriber import transcribe


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
