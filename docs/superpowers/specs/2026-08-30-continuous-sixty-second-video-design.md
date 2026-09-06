# Continuous, musically selected video design

**Date:** 2026-08-30  
**Status:** Approved for planning  
**Branch:** `fix/continuous-sixty-second-video`

> **Amendment — 2026-09-06.** The output window policy is **30 seconds**, not 60.
> `MAX_OUTPUT_DURATION_MS` was reduced to `30_000` in `4c87e45`
> ("adjust output window limits") and the acceptance tests were rewritten to
> match, but this document was not, so for a while the specification and the
> code disagreed and only the code was enforced. Every "60 second" / `60_000`
> below now reads 30 / `30_000`; the file name keeps its original slug so
> existing links still resolve. The design — one continuous, musically selected,
> deterministic window — is unchanged; only the length is.

## Objective

Produce a continuous vertical meme video from a music project with no black gaps, no renderer-created frozen tails, and cuts aligned to musical timing.

- A source track of at most 30 seconds is used in full.
- A source track longer than 30 seconds yields one continuous, musically selected window of exactly 30,000 ms.
- The rendered video covers the complete output window.
- The renderer rejects an incomplete edit instead of concealing it with black frames or cloned frames.

The existing architectural principle remains intact: planning decides the edit and FFmpeg executes a deterministic timeline.

## Confirmed problem

The existing real artifact at `storage/cache/prj_aiu3rd27bizmr6q2k8ez7/timeline.json` has:

- 172,251 ms total duration;
- 109,580 ms of clip coverage;
- 62,671 ms of gaps that render as black, or 36.4% of the output;
- 12,207 ms of source shortages across 16 of 27 clips, rendered by cloning the last frame;
- 27 video inputs in the graph but only four unique source assets;
- five visual slots shorter than 1,500 ms, including one 400 ms slot.

The current implementation causes these symptoms through four connected behaviors:

1. narrative segments follow lyric lines when lyrics exist, leaving intros, pauses, and instrumental spans uncovered;
2. the Director is allowed to skip a segment;
3. assembly gives a whole narrative segment to one moment even when the moment is shorter;
4. the renderer turns gaps into `color=c=black` and source shortages into `tpad=stop_mode=clone`.

The existing renderer tests deliberately accept black output for an empty or incomplete timeline. Those expectations must be replaced by failure expectations.

## Product behavior

### Output window

Let `trackDurationMs` be the probed source duration.

- When `trackDurationMs <= 30_000`, select `[0, trackDurationMs]`.
- When `trackDurationMs > 30_000`, select a bounded interval `[sourceStartMs, sourceStartMs + 30_000]`.
- An exact 30-second track is not considered cropped.
- The timeline clock always begins at zero. Source-audio times remain absolute and are translated at the timeline boundary.

The studio displays the selected source range, output duration, selector version, and a concise score explanation.

### Visual style

- Use hard cuts rather than crossfades.
- Snap shared cut boundaries to beats or downbeats.
- Prefer visual slots between 1,000 and 4,000 ms.
- For an exceptional source track shorter than 1,000 ms, use one slot spanning the whole track.
- Use shorter slots during high-energy passages and longer slots during low-energy passages.
- Do not repeat the same asset in adjacent slots when another eligible candidate exists.
- Instrumental spans receive visual coverage just like lyrical spans.

### Failure behavior

If no usable catalog moment can cover a minimum slot, stop before rendering with `INSUFFICIENT_CATALOG`. The UI explains that more or longer catalog clips are required. A black video is never a successful fallback.

## Architecture

```text
source audio + lyrics
        |
        v
audio analysis
        |
        v
Highlight Selector
        |
        v
selected source window (full track or 30 seconds)
        |
        v
Narrative Coverage Planner
        |
        v
matching + direction + coverage resolution
        |
        v
shared-boundary Timing Optimizer
        |
        v
strict Timeline Validator
        |
        v
FFmpeg renderer
```

The selector runs before narrative matching and direction. This bounds downstream work to at most 30 seconds and avoids spending retrieval or model work on discarded parts of a long track.

## Component design

### 1. Highlight Selector

Add a pure module with one public selection seam. It consumes:

- track duration;
- audio sections;
- beats and downbeats;
- energy curve;
- lyric line ranges.

It returns:

```ts
interface EditWindowSelection {
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  targetDurationMs: number;
  score: number;
  scoreBreakdown: {
    section: number;
    energy: number;
    lyrics: number;
    narrativeArc: number;
    boundaries: number;
  };
  selector: string;
  selectorVersion: string;
}
```

For long tracks, candidate windows are generated from:

- downbeats and section boundaries as possible starts;
- downbeats and section boundaries as possible ends, translated back by 30,000 ms;
- the first and last possible 30-second windows;
- lyric starts near a structural boundary.

Candidates are clamped to `[0, trackDurationMs - 30_000]`, deduplicated, and scored. Every score component is normalized to `[0, 1]`, and the version-1 weights are `section=0.30`, `energy=0.20`, `lyrics=0.15`, `narrativeArc=0.15`, and `boundaries=0.20`. The narrative-arc component is a structural proxy available before LLM narrative analysis: it rewards a lower-energy setup followed by a higher-energy section or chorus in the final third. The boundary component rewards proximity to a downbeat or section edge and low local energy discontinuity. Ties resolve to the earliest start, making selection deterministic.

If analysis data is missing, the fallback is still deterministic: use the earliest valid full-duration window. Missing optional features do not produce `NaN` or an invalid range.

The selected window is persisted with its score breakdown and version. Reprocessing may create a new selection version without destroying the older audit record.

### 2. Narrative Coverage Planner

The narrative provider remains responsible for meaning, emotion, function, and visual ideas. A deterministic post-processor makes its result safe for editing:

1. discard spans outside the selected window;
2. clamp spans crossing a window edge;
3. fill all uncovered intervals with instrumental spans derived from the containing audio section and local energy;
4. split long spans at beat-aware boundaries into visual planning units;
5. merge a terminal remainder below 1,000 ms into a neighbor rather than creating a flash cut;
6. preserve absolute source times in persistence and translate to zero-based timeline times only during assembly.

Each normalized span records whether it came from lyrics or instrumental gap filling. The normalized sequence is ordered, non-overlapping, and covers the selected source window exactly.

### 3. Matching, direction, and coverage resolution

Duration becomes an eligibility constraint. A candidate shorter than a visual slot cannot be the only source for that slot.

The Director still selects a primary moment from a segment shortlist. A deterministic Coverage Resolver converts that decision into one or more timeline clips:

- use the primary moment first when eligible;
- if a semantic span needs multiple clips, use other ranked shortlist moments in score order;
- split at the strongest interior beat when no single candidate covers the planned interval;
- continue splitting until eligible sources exist or the 1,000 ms minimum is reached;
- avoid adjacent reuse of the same asset when possible;
- record every fallback and split in the Director debug artifact.

The Director may no longer leave output time uncovered. If a provider omits a choice, the top eligible ranked candidate is used as a deterministic fallback. If no candidate can cover the minimum interval, resolution fails with `INSUFFICIENT_CATALOG`. For an entire output shorter than 1,000 ms, that output duration replaces the normal minimum.

Timeline source cuts never exceed a moment's `[startMs, endMs]`. When a moment is longer than its assigned slot, only the required subrange is used. When a moment is shorter, it is not padded; another clip must cover the remainder.

### 4. Shared-boundary Timing Optimizer

The current timing optimizer moves each clip independently while preserving its duration. Independent movement can create gaps. The replacement operates on shared boundaries:

- boundary zero remains zero;
- the last boundary remains `timeline.durationMs`;
- each internal boundary is shared by `previous.endMs` and `next.startMs`;
- snap an internal boundary to the best beat/downbeat inside its allowed window, constrained by both neighboring source moments' available duration;
- enforce the minimum duration on both neighboring clips;
- never create gaps or overlaps.

Source ranges change by the same amount needed to keep each source duration equal to its final slot duration and remain within moment bounds.

### 5. Strict Timeline Validator

The following become hard errors:

- empty timeline;
- initial, internal, or trailing visual gap of any positive integer duration;
- overlapping clips;
- invalid or out-of-bounds ranges;
- source duration shorter than timeline slot duration;
- timeline duration different from the selected edit-window duration.

`TIMELINE_GAP`, `EMPTY_TIMELINE`, and `SOURCE_SHORTER_THAN_SLOT` are no longer successful render warnings. Existing historical render records remain readable, but new renders cannot be produced from such timelines.

### 6. Renderer

The graph builder assumes a valid, fully covered timeline.

- Remove black gap generation.
- Remove cloned-frame `tpad` fallback.
- Keep per-clip `trim`, `setpts=PTS-STARTPTS`, transform, SAR normalization, and hard concatenation.
- Trim audio at `timeline.audio.sourceStartMs` for `timeline.durationMs`.
- Add `asetpts=PTS-STARTPTS` after `atrim` so a mid-track selection starts at output timestamp zero.
- Add a 120 ms audio fade-in only when `sourceStartMs > 0`.
- Add a 250 ms audio fade-out only when `sourceEndMs < trackDurationMs`.
- Keep the existing 1080x1920, 30 fps, H.264/AAC output contract.

The render handler already resolves project media before graph construction. It will also pass the probed track duration in the renderer context so the graph can decide whether each edge is cropped without changing the persisted Timeline schema. Fade durations are capped at half the output duration for exceptionally short tracks.

The renderer records graph-build time, FFmpeg wall time, validation time, clip count, unique source count, and output duration. Repeated source-input optimization is performed only after a before/after benchmark; source grouping or FFmpeg `split` must not be introduced without proving that it reduces wall time and memory for the representative fixture.

FFmpeg's current documentation states that `atrim` does not modify timestamps and recommends `asetpts` to restart them at zero. It also requires concat inputs to begin at timestamp zero. These requirements justify the timestamp reset rather than relying on output `-t` to hide desynchronization.

## Persistence and API

Add an append-only edit-window record associated with a project:

- project ID and monotonically increasing version;
- selected start, end, duration, and target duration;
- total score and JSON score breakdown;
- selector name and version;
- creation time.

The latest selected window is returned by project-detail and project-list endpoints. The web studio shows:

- source range;
- output duration;
- selector/version;
- selection reason;
- `INSUFFICIENT_CATALOG` guidance when applicable.

The target duration is an internal 30,000 ms policy for this increment. There is no misleading duration control with only one valid value. The API contract remains ready to accept a configurable target in a future feature.

## Error handling

| Code | Trigger | Result |
| --- | --- | --- |
| `HIGHLIGHT_INVALID_ANALYSIS` | selector input is contradictory or out of bounds | fail planning; do not match or render |
| `NARRATIVE_COVERAGE_INVALID` | normalized spans cannot cover the window | fail narrative stage |
| `INSUFFICIENT_CATALOG` | no eligible moment covers a minimum slot | fail direction with actionable UI guidance |
| `TIMING_INVALID_RESULT` | shared-boundary optimization creates an invalid range | preserve the previous version and fail timing |
| `RENDER_INVALID_TIMELINE` | strict validation finds a gap, overlap, empty timeline, or short source | do not invoke FFmpeg |

Every failure retains the last valid timeline/render and writes structured debug context without adding untagged diagnostic logging.

## Test plan and approved seams

No production change is written before its failing test at one of these seams.

### Highlight selection seam

- 45-second track selects `[0, 45_000]`.
- exact 30-second track selects `[0, 30_000]` and is not marked cropped.
- long track selects exactly 30,000 ms inside source bounds.
- high-value chorus/payoff window beats a low-energy intro in a worked fixture.
- missing lyrics, beats, sections, or energy uses a deterministic bounded fallback.
- identical input yields identical selection and score breakdown.

### Narrative coverage seam

- gaps between lyric lines become instrumental spans.
- normalized spans cover the selected interval exactly.
- a long span splits on beat-aware boundaries.
- a remainder below 1,000 ms merges instead of becoming a flash slot.
- crossing lyric lines are clamped to the selected window.

### Coverage resolution seam

- an eligible primary candidate fills a slot without fallback.
- a short primary results in multiple eligible clips rather than padding.
- consecutive asset repetition is avoided when an alternative exists.
- a missing provider pick uses the top eligible candidate.
- an unusable catalog raises `INSUFFICIENT_CATALOG`.

### Timing seam

- internal cuts snap to beats while neighboring ranges share the same boundary.
- first and last boundaries stay fixed.
- no gap, overlap, or sub-minimum slot is introduced.
- source duration remains equal to slot duration and in bounds.

### Validation and graph seams

- empty, gapped, overlapping, out-of-bounds, or source-short timelines fail validation.
- a contiguous full-coverage timeline passes.
- generated filter graph contains neither black `color` segments nor cloned-frame `tpad`.
- mid-track audio uses `atrim` followed by `asetpts=PTS-STARTPTS`.
- fades appear only at cropped source edges.

### End-to-end seam

Generate moving synthetic source videos and both short and long synthetic tracks, then run the real local pipeline and FFmpeg:

- short track output has its natural duration;
- long track output is 30,000 ms within frame/codec tolerance;
- output remains 1080x1920 at 30 fps with AAC audio;
- timeline JSON has complete coverage and no short source;
- FFmpeg `blackdetect` finds no black interval in a fixture whose sources contain no black frames;
- audio and video begin at output timestamp zero;
- a second run is deterministic and preserves versioning.

### Regression and performance verification

- run the focused TypeScript tests after each vertical TDD slice;
- run relevant Python tests when audio analysis changes;
- run full TypeScript tests, Python tests, typecheck, lint, and affected E2E suites at completion;
- rerun the existing artifact diagnostic, which currently exits nonzero because coverage is incomplete and sources are short;
- capture before/after render wall time on the same representative fixture;
- treat performance numbers as reported measurements, not flaky CI timing assertions.

## Documentation and delivery

Before opening a pull request:

- add a `CHANGELOG.md` entry describing selection, continuous coverage, strict validation, and timestamp correction;
- update `README.md` with the 30-second policy, insufficient-catalog behavior, commands, and UI behavior;
- pin any dependency added or changed to an exact current stable version after checking its official release source;
- do not use prerelease dependencies.

## Non-goals

- crossfade or decorative transition effects (revised on 2026-09-01 by `2026-09-01-cut-styles-design.md`, which adds a closed vocabulary of transitions and clip styles while keeping slots contiguous; the "no black interval" check becomes "no black interval outside declared `dip_black` windows");
- generative filler video;
- looping or slow-motion stretching of short clips;
- configurable output durations other than the approved 30-second maximum policy;
- publishing or social-network upload;
- renderer optimization without a measured baseline.

## Acceptance criteria

The increment is complete when all of the following are proven in the local environment:

1. tracks at or below 30 seconds use their full duration;
2. longer tracks produce a deterministic, continuous 30-second selection;
3. no successful timeline has an empty frame interval or a source-short clip;
4. no generated graph uses black gap filler or cloned-frame padding;
5. mid-track audio starts at output timestamp zero and ends without an abrupt cut;
6. cuts share beat-aware boundaries without overlap or gaps;
7. insufficient catalogs fail before FFmpeg with an actionable error;
8. focused, full, Python, typecheck, lint, and affected E2E verification passes;
9. before/after performance measurements and remaining limitations are reported;
10. README and changelog changes accompany the implementation.

## Research basis

- FFmpeg filter documentation: <https://ffmpeg.org/ffmpeg-filters.html>
- librosa temporal segmentation documentation: <https://librosa.org/doc/0.11.0/segment.html>
- librosa recurrence-matrix documentation: <https://librosa.org/doc/main/api/generated/librosa.segment.recurrence_matrix.html>
- librosa Laplacian segmentation example: <https://librosa.org/doc/main/auto_tutorials/03-advanced/plot_segmentation.html>
