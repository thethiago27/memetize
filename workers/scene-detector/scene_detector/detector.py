"""Scene detection core (spec section 16). Times are integer milliseconds."""

from __future__ import annotations

from typing import TypedDict

import scenedetect
from scenedetect import ContentDetector, detect, open_video

DETECTOR_NAME = "pyscenedetect-content"


class SceneInterval(TypedDict):
    startMs: int
    endMs: int


class SceneDetectionResult(TypedDict):
    detector: str
    detectorVersion: str
    scenes: list[SceneInterval]


def _seconds_to_ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def detect_scenes(video_path: str) -> SceneDetectionResult:
    """Detects content cuts. Falls back to a single whole-video scene when the
    clip has no detectable cuts, so every asset yields at least one scene."""
    if not video_path:
        raise ValueError("analysisPath is required")

    scene_list = detect(video_path, ContentDetector())
    scenes: list[SceneInterval] = [
        {
            "startMs": _seconds_to_ms(start.seconds),
            "endMs": _seconds_to_ms(end.seconds),
        }
        for start, end in scene_list
    ]

    if not scenes:
        video = open_video(video_path)
        scenes = [{"startMs": 0, "endMs": _seconds_to_ms(video.duration.seconds)}]

    return {
        "detector": DETECTOR_NAME,
        "detectorVersion": scenedetect.__version__,
        "scenes": scenes,
    }
