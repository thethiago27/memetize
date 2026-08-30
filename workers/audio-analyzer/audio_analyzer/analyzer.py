"""Audio analysis core (spec section 25). Times are integer milliseconds;
BPM/strength/energy are plain numbers, not durations.

The fixture path is a pure function of `duration_ms`: no file I/O, no GPU, no
optional dependency, so it stays deterministic and free under `pnpm test`
(spec section 66). The same duration always yields the same beats/sections.
"""

from __future__ import annotations

import math
from typing import TypedDict

FIXTURE_NAME = "fixture"
FIXTURE_VERSION = "1.0.0"
LIBROSA_NAME = "librosa"
LIBROSA_VERSION = "1.0.0"

FIXED_BPM = 120.0
BEAT_INTERVAL_MS = round(60_000 / FIXED_BPM)  # 500ms at 120 BPM
BEATS_PER_BAR = 4
SECTION_TYPES = ["intro", "verse", "chorus", "outro"]
ENERGY_STEP_MS = 1000


class Beat(TypedDict):
    timeMs: int
    strength: float


class Section(TypedDict):
    type: str
    startMs: int
    endMs: int


class EnergyPoint(TypedDict):
    timeMs: int
    value: float


class AudioAnalysisResult(TypedDict):
    durationMs: int
    bpm: float
    beats: list[Beat]
    downbeats: list[int]
    sections: list[Section]
    energyCurve: list[EnergyPoint]
    analyzer: str
    analyzerVersion: str


def analyze_audio(
    duration_ms: int,
    provider: str = "fixture",
    path: str | None = None,
) -> AudioAnalysisResult:
    if duration_ms <= 0:
        raise ValueError("durationMs must be positive")
    if provider == "fixture":
        return _analyze_fixture(duration_ms)
    if provider == "librosa":
        if not path:
            raise ValueError("librosa provider requires an audio path")
        return _analyze_librosa(path, duration_ms)
    raise ValueError(
        f'unsupported AUDIO_PROVIDER "{provider}" (only "fixture" and "librosa" are implemented)'
    )


def _analyze_fixture(duration_ms: int) -> AudioAnalysisResult:
    beats: list[Beat] = []
    time_ms = 0
    beat_index = 0
    while time_ms < duration_ms:
        is_downbeat = beat_index % BEATS_PER_BAR == 0
        beats.append({"timeMs": time_ms, "strength": 0.9 if is_downbeat else 0.6})
        beat_index += 1
        time_ms += BEAT_INTERVAL_MS

    downbeats = [beat["timeMs"] for index, beat in enumerate(beats) if index % BEATS_PER_BAR == 0]
    sections = _fixture_sections(duration_ms)
    energy_curve = _fixture_energy_curve(duration_ms)

    return {
        "durationMs": duration_ms,
        "bpm": FIXED_BPM,
        "beats": beats,
        "downbeats": downbeats,
        "sections": sections,
        "energyCurve": energy_curve,
        "analyzer": FIXTURE_NAME,
        "analyzerVersion": FIXTURE_VERSION,
    }


def _fixture_sections(duration_ms: int) -> list[Section]:
    slice_ms = duration_ms // len(SECTION_TYPES)
    sections: list[Section] = []
    cursor = 0
    last_index = len(SECTION_TYPES) - 1
    for index, section_type in enumerate(SECTION_TYPES):
        end_ms = duration_ms if index == last_index else cursor + slice_ms
        sections.append({"type": section_type, "startMs": cursor, "endMs": end_ms})
        cursor = end_ms
    return sections


def _fixture_energy_curve(duration_ms: int) -> list[EnergyPoint]:
    points: list[EnergyPoint] = []
    time_ms = 0
    while time_ms < duration_ms:
        value = round(abs(math.sin(time_ms / 2000 * math.pi)), 3)
        points.append({"timeMs": time_ms, "value": value})
        time_ms += ENERGY_STEP_MS
    return points


def _analyze_librosa(path: str, duration_ms: int) -> AudioAnalysisResult:
    """Real analysis via librosa (spec section 25). Optional extra — tests
    keep using the fixture so `pnpm test` never downloads or loads a model."""
    try:
        import librosa
        import numpy as np
    except ImportError as error:
        raise RuntimeError(
            "AUDIO_PROVIDER=librosa requires the optional librosa dependency "
            "(uv sync --extra librosa)"
        ) from error

    waveform, sample_rate = librosa.load(path, sr=22050, mono=True)
    if waveform.size == 0:
        raise ValueError(f"audio file is empty: {path}")

    onset_env = librosa.onset.onset_strength(y=waveform, sr=sample_rate)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sample_rate)
    bpm = float(np.atleast_1d(tempo)[0])
    if not math.isfinite(bpm) or bpm <= 0:
        bpm = FIXED_BPM

    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate)
    onset_at_beats = onset_env[beat_frames] if beat_frames.size else np.array([])
    peak_onset = float(onset_at_beats.max()) if onset_at_beats.size else 1.0
    if peak_onset <= 0:
        peak_onset = 1.0

    beats: list[Beat] = []
    for index, time_s in enumerate(beat_times):
        time_ms = int(round(time_s * 1000))
        if time_ms >= duration_ms:
            continue
        raw = float(onset_at_beats[index]) if onset_at_beats.size else 0.6
        beats.append({"timeMs": time_ms, "strength": max(0.0, min(1.0, raw / peak_onset))})
    if not beats:
        beats = [{"timeMs": 0, "strength": 0.9}]

    downbeats = [beat["timeMs"] for index, beat in enumerate(beats) if index % BEATS_PER_BAR == 0]
    energy_curve = _librosa_energy_curve(waveform, sample_rate, duration_ms)
    sections = _librosa_sections(waveform, sample_rate, duration_ms, energy_curve)

    return {
        "durationMs": duration_ms,
        "bpm": bpm,
        "beats": beats,
        "downbeats": downbeats,
        "sections": sections,
        "energyCurve": energy_curve,
        "analyzer": LIBROSA_NAME,
        "analyzerVersion": LIBROSA_VERSION,
    }


def _librosa_energy_curve(
    waveform: object,
    sample_rate: int,
    duration_ms: int,
) -> list[EnergyPoint]:
    import librosa
    import numpy as np

    hop_length = sample_rate  # ~1 s, matches the fixture's ENERGY_STEP_MS
    rms = librosa.feature.rms(y=waveform, hop_length=hop_length)[0]
    peak = float(rms.max()) if rms.size else 1.0
    if peak <= 0:
        peak = 1.0
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sample_rate, hop_length=hop_length)
    points: list[EnergyPoint] = []
    for time_s, value in zip(times, rms, strict=False):
        time_ms = int(round(float(time_s) * 1000))
        if time_ms >= duration_ms:
            continue
        points.append({"timeMs": time_ms, "value": max(0.0, min(1.0, float(value) / peak))})
    return points if points else [{"timeMs": 0, "value": 0.5}]


def _librosa_sections(
    waveform: object,
    sample_rate: int,
    duration_ms: int,
    energy_curve: list[EnergyPoint],
) -> list[Section]:
    import librosa

    if duration_ms < 8_000:
        return _fixture_sections(duration_ms)

    chroma = librosa.feature.chroma_stft(y=waveform, sr=sample_rate)
    try:
        bound_frames = librosa.segment.agglomerative(chroma, k=len(SECTION_TYPES))
    except Exception:  # noqa: BLE001 - fall back to equal slices if clustering fails
        return _fixture_sections(duration_ms)

    bound_times = librosa.frames_to_time(bound_frames, sr=sample_rate)
    edges = {0, duration_ms}
    for time_s in bound_times:
        time_ms = int(round(float(time_s) * 1000))
        if 0 < time_ms < duration_ms:
            edges.add(time_ms)
    ordered = sorted(edges)
    intervals = [
        (start, end) for start, end in zip(ordered, ordered[1:], strict=False) if end > start
    ]
    if not intervals:
        return _fixture_sections(duration_ms)

    def mean_energy(start_ms: int, end_ms: int) -> float:
        values = [point["value"] for point in energy_curve if start_ms <= point["timeMs"] < end_ms]
        return sum(values) / len(values) if values else 0.5

    scored = [(start, end, mean_energy(start, end)) for start, end in intervals]
    labels = ["verse"] * len(scored)
    labels[0] = "intro"
    if len(labels) > 1:
        labels[-1] = "outro"
    middle = range(1, len(scored) - 1)
    if middle:
        chorus_index = max(middle, key=lambda index: scored[index][2])
        labels[chorus_index] = "chorus"

    return [
        {"type": labels[index], "startMs": scored[index][0], "endMs": scored[index][1]}
        for index in range(len(scored))
    ]
