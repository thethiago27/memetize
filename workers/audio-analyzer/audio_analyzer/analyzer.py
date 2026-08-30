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


def analyze_audio(duration_ms: int, provider: str = "fixture") -> AudioAnalysisResult:
    if duration_ms <= 0:
        raise ValueError("durationMs must be positive")
    if provider != "fixture":
        raise ValueError(
            f'unsupported AUDIO_PROVIDER "{provider}" (only "fixture" is implemented so far)'
        )
    return _analyze_fixture(duration_ms)


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
