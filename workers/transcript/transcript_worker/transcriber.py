"""Transcription core (spec section 17). Times are integer milliseconds."""

from __future__ import annotations

from typing import TypedDict

FIXTURE_MODEL = "fixture"
FIXTURE_VERSION = "1.0.0"


class Word(TypedDict):
    text: str
    startMs: int
    endMs: int


class Segment(TypedDict):
    startMs: int
    endMs: int
    text: str
    words: list[Word]


class TranscriptionResult(TypedDict):
    segments: list[Segment]
    model: str
    modelVersion: str


def transcribe(audio_path: str | None, provider: str = "fixture") -> TranscriptionResult:
    """Deterministic by default (spec section 66): a clip with no audio
    stream, or the fixture provider, both yield an empty *successful*
    transcript rather than an error."""
    if not audio_path or provider == "fixture":
        return {"segments": [], "model": FIXTURE_MODEL, "modelVersion": FIXTURE_VERSION}

    if provider == "mlx":
        return _transcribe_mlx(audio_path)

    raise ValueError(
        f'unsupported TRANSCRIPTION_PROVIDER "{provider}" (only "fixture" and "mlx" are implemented)'
    )


def _transcribe_mlx(audio_path: str) -> TranscriptionResult:
    try:
        import mlx_whisper
    except ImportError as error:
        raise RuntimeError(
            "TRANSCRIPTION_PROVIDER=mlx requires the optional mlx-whisper dependency "
            "(uv sync --extra mlx, Apple Silicon only)"
        ) from error

    output = mlx_whisper.transcribe(audio_path, word_timestamps=True)
    segments: list[Segment] = []
    for raw_segment in output.get("segments", []):
        words: list[Word] = [
            {
                "text": str(word["word"]).strip(),
                "startMs": _seconds_to_ms(word["start"]),
                "endMs": _seconds_to_ms(word["end"]),
            }
            for word in raw_segment.get("words", [])
        ]
        segments.append(
            {
                "startMs": _seconds_to_ms(raw_segment["start"]),
                "endMs": _seconds_to_ms(raw_segment["end"]),
                "text": str(raw_segment["text"]).strip(),
                "words": words,
            }
        )
    return {
        "segments": segments,
        "model": "mlx-whisper",
        "modelVersion": getattr(mlx_whisper, "__version__", "unknown"),
    }


def _seconds_to_ms(seconds: float) -> int:
    return int(round(seconds * 1000))
