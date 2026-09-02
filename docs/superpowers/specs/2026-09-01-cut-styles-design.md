# Cut styles: transitions and clip styles chosen by the Director

**Date:** 2026-09-01  
**Status:** Approved for planning  
**Branch:** `feat/cut-styles`  
**Increment:** 1 of 2 (pipeline and read-only Studio). Increment 2 (human editing in the Studio and editorial-memory learning) gets its own spec once this one ships.

## Objective

Give the Director a closed vocabulary of cut styles so it can shape how scenes join, not only which moment fills each segment. The Director proposes a style per segment boundary and per primary clip; a deterministic resolver validates each proposal against the real source material, downgrades what cannot render, records why, and the renderer executes the result. Every timeline still renders, still covers the output window exactly, and still has no gaps or overlapping slots.

This revises two earlier decisions on purpose: the continuous-sixty-second spec's "hard cuts rather than crossfades" non-goal, and `project.md` §57's advice against a transitions library. The vocabulary stays deliberately small.

## Vocabulary

Two axes. Both are closed enums; anything outside them is a parse error.

**Transition out of a clip into the next one** (`TransitionStyle`):

| Style | Effect | Renders as |
| --- | --- | --- |
| `hard` | Straight cut on the beat. Default and universal fallback. | `concat`, unchanged from today |
| `dip_black` | Tail of A fades to black, head of B fades in from black. | `fade` on each side, no overlap |
| `flash` | Same as `dip_black` but through white. Drops and peaks. | `fade` with `color=white` on each side |
| `crossfade` | A and B blend for the transition duration. | `xfade=fade`, needs source handles |
| `whip` | Fast lateral slide. | `xfade=slideleft`, needs source handles |

**Clip style** (`ClipStyle`), one per clip, on top of the automatic punchline zoom:

| Style | Effect | Renders as |
| --- | --- | --- |
| `none` | Nothing. Default. | |
| `hold` | Last frame frozen for the hold duration before the cut. | `trim` to `slot − N` then `tpad=stop_mode=clone:stop_duration=N` |
| `speed_up` | Whole clip at 1.25×. Consumes extra source. | `setpts=PTS/1.25` |
| `slow_down` | Whole clip at 0.8×. Consumes less source. | `setpts=PTS/0.8` over `slot × 0.8` of source |

Left out on purpose: `jump_cut` and `match_cut` (moment selection, already the Director's picks), `glitch` (needs shaders or pre-rendered frames), explicit early/late cuts (would fight the Timing optimizer's beat snapping).

## Time model

Timeline slots stay contiguous and non-overlapping. A transition is metadata on the boundary between clip A and clip B, centered on that boundary. Each side contributes half the transition duration as a **source handle**: A's rendered segment extends `D/2` past `source.endMs`, B's starts `D/2` before `source.startMs`. `xfade` consumes exactly `D`, so the sum of rendered segments equals `durationMs` and the output length does not change.

`dip_black` and `flash` need no handles: each side fades within its own slot for `D/2`.

`hold` and `slow_down` consume less source than the slot; `clip.source` stays equal to the slot and the renderer uses only what it needs. `speed_up` needs `slot × 0.25` of extra source; the resolver extends `clip.source.endMs` when the moment has it. The existing invariant "source covers the slot" keeps holding for the base range.

## Timeline contract

`packages/timeline`. `schemaVersion` stays `1.0`; the new fields are optional so every persisted timeline keeps parsing.

```ts
TransitionStyle = z.enum(['hard', 'dip_black', 'flash', 'crossfade', 'whip'])
ClipStyle       = z.enum(['none', 'hold', 'speed_up', 'slow_down'])
CutDowngradeReason = z.enum([
  'no_source_handle', 'slot_too_short', 'overlapping_transitions', 'last_clip',
])

TimelineClip gains:
  direction?: {                      // what the Director asked for; immutable through Timing
    clipStyle: ClipStyle,            // default 'none'
    transitionOut: TransitionStyle,  // default 'hard'
  }
  transitionOut?: {                  // what the resolver decided
    style: TransitionStyle,
    durationMs: number,              // 0 for 'hard'
    requested: TransitionStyle,
    downgradeReason?: CutDowngradeReason,
  }
```

`hold` and `speed` become `effects` entries alongside `zoom`, using the existing open `TimelineEffect` shape:

```ts
{ type: 'hold',  startMs, endMs }                       // window is the frozen tail
{ type: 'speed', startMs, endMs, factor: 1.25 | 0.8 }   // window is the whole slot
```

Both carry `requested: ClipStyle` and, when downgraded, `downgradeReason`. A clip whose requested style was downgraded to `none` keeps no effect entry; the decision lives in the Effects debug file.

Only the **primary** clip of a segment carries `direction.clipStyle`; only the **last** clip of a segment carries `direction.transitionOut`. Tiles and fallbacks get `none` / `hard`. A clip with no `direction` resolves as `none` / `hard`.

## Director

`packages/contracts` `DirectorPick` grows to:

```ts
{ segmentId, momentId, clipStyle?: ClipStyle, transitionOut?: TransitionStyle }
```

with defaults `none` / `hard` so the model may omit them. The gateway's `DirectorPicksSchema` uses the same enums, so a style outside the vocabulary fails at `generateObject` and surfaces as `DIRECTOR_ERROR` like any malformed response.

`DIRECTOR_PROMPT_VERSION` becomes `v4` = v3 plus one paragraph:

- `hard` is the default and right for most meme cuts.
- `flash` on drops and energy peaks; `whip` when both sides are visually close and energy is high.
- `crossfade` only on low-energy or setup passages; `dip_black` to separate acts.
- `hold` right before a punchline for comic timing; `speed_up` on high energy; `slow_down` on dramatic or low-energy moments.
- Use something other than `hard` on at most one third of the boundaries.
- A deterministic resolver may downgrade a style the source cannot support; do not try to predict source margins.

The Director still never sees source bounds or beats. `assembleDirectedTimeline` maps each pick's styles onto the resolved clips as described above. Editorial memory does not change in this increment.

The fixture provider emits `none` / `hard` everywhere by default (pipeline tests stay deterministic) and has a second mode, `styled`, that assigns fixed styles by segment position for resolver, renderer, and end-to-end tests.

`WORKER_VERSION.DIRECTOR` bumps a minor; `promptVersion` on `timeline_versions` records `v4`.

## Resolver

`packages/effects` gains a pure `resolveCutStyles(timeline, context)` that `planEffects` calls before the punchline zoom. Context: the post-Timing timeline, `sourceBoundsByMomentId` (the map the Timing worker already builds), `beatMs` from the audio analysis, and `segmentById` for energy. Output: the resolved timeline plus a decision list `{ clipId, kind: 'transition' | 'clip', requested, resolved, durationMs, reason? }` written to the Effects debug file next to `planned`.

**Durations come from tempo, not from the model.** Named constants in `packages/effects/src/constants.ts`:

| Style | Base | Clamp |
| --- | --- | --- |
| `crossfade` | 1 beat | 200 to 500 ms |
| `whip` | ½ beat | 120 to 250 ms |
| `dip_black` | ½ beat | 150 to 400 ms |
| `flash` | ¼ beat | 80 to 160 ms |
| `hold` | 1 beat | 200 to 600 ms |
| `speed_up` | factor 1.25, whole clip | |
| `slow_down` | factor 0.8, whole clip | |

**Resolution order:** two passes. First every clip style, because `hold` and `speed_up` change how much source is left for a handle and the transition out of clip A needs clip B's playback factor too. Then every transition, in timeline order, so a clip's incoming transition is known before its outgoing one is decided.

Feasibility and downgrade rules:

- Every transition, overlapping or not, is capped at one third of the smaller neighboring slot (`MAX_TRANSITION_SLOT_FRACTION`); this subsumes the looser "slot at least `2 × D`" bound for fades.
- `crossfade` and `whip` need a handle of `D/2` of output time on both sides inside the moment bounds, scaled by each side's playback factor (a sped-up clip needs `1.25 ×` as much source). A clip whose tail is frozen by `hold` needs no tail handle: the freeze extends into the transition. If not feasible, shrink `D` down to the clamp minimum; if still not feasible, `crossfade` becomes `dip_black` and `whip` becomes `hard`, with `no_source_handle` or `slot_too_short`.
- `dip_black` and `flash` need no handles; if the tempo-derived `D` exceeds the cap, shrink to the minimum or become `hard` with `slot_too_short`.
- `hold` needs `slot − N ≥ MIN_ZOOM_MS` (300 ms); otherwise shrink to the minimum or become `none` with `slot_too_short`.
- `speed_up` needs `slot × 0.25` of source after `source.endMs` inside the moment bounds; otherwise `none` with `no_source_handle`.
- `slow_down` always fits.
- The last clip of the timeline always resolves to `hard` with `last_clip`.
- Incoming plus outgoing transition on one clip may not exceed the slot. Under the one-third cap the resolver can never produce this, so `overlapping_transitions` is a validator defense for hand-edited timelines (increment 2), not a resolver outcome.

**Punchline zoom** stays automatic and independent, with two interactions: when the clip has `hold`, the zoom window ends where the hold starts; a clip with `slow_down` gets no zoom.

**Determinism:** same timeline and context give the same output; no randomness. The resolver never moves slots; it only extends `source.endMs` for `speed_up`.

**Swap** (`packages/projects/src/swap.ts`) runs the same resolver over the swapped clip and its two neighbors with the new moment's bounds before persisting the version, so a swap never leaves a `crossfade` without a handle. The swapped clip keeps its `direction`.

## Renderer

`packages/renderer/src/graph.ts` replaces the single terminal `concat` with a left-to-right accumulator:

- Boundary `hard`, `dip_black`, or `flash`: `concat` the accumulator with the next segment.
- Boundary `crossfade` or `whip`: `xfade` the accumulator with the next segment, `transition=fade` or `slideleft`, `duration=D`, `offset` = accumulated length − `D/2`.

Each clip segment is trimmed with its handles applied: A's `trim` ends at `source.endMs + D/2` when it exits through an overlapping transition; B's starts at `source.startMs − D/2` when it enters through one. `fps` is pinned on every segment before any `xfade`, since `xfade` requires matching rate and format on both inputs.

Per-clip filter order after `trim`, `setpts`, and the transform:

1. `speed`: `setpts=PTS/1.25` or `setpts=PTS/0.8` (for `slow_down` the `trim` consumes `slot × 0.8` of source).
2. `zoom`: as today.
3. `hold`: `trim` to `slot − N`, then `tpad=stop_mode=clone:stop_duration=N + H`, where `H` is the outgoing overlap handle (`D/2` for `crossfade` / `whip`, else 0), so the frozen frame carries the clip through the transition.
4. Outgoing `dip_black` or `flash`: `fade=t=out:st=slot−D/2:d=D/2:color=black|white`. Incoming: `fade=t=in:st=0:d=D/2` with the same color.
5. `setsar=1`.

Audio does not change: one track, no participation in transitions.

**Timeline validation** (`validate-timeline.ts`) gains hard errors `TRANSITION_TOO_LONG`, `TRANSITION_HANDLE_OUT_OF_BOUNDS` (a handle before source time 0), and `OVERLAPPING_TRANSITIONS`. `hold` and `speed` leave the `UNKNOWN_EFFECT` set. The test that asserts `fade` is rejected becomes "a style outside the vocabulary is rejected".

**Output validation** does not change. The sixty-second spec's "no black interval" criterion becomes "no black interval outside declared `dip_black` windows", and the graph test that forbids `tpad=stop_mode=clone` forbids it only without a declared `hold`.

## Studio (read-only in this increment)

The API shape does not change; the new fields travel inside `timeline.data`.

- `TimelineStrip`: a boundary whose resolved transition is not `hard` shows a thin marker between the two clips; a clip with `hold`, `speed`, or `zoom` shows a small icon in a corner.
- `Inspector`: a "Corte" line under the current moment, in Portuguese: "Saída: crossfade, 300 ms". When downgraded: "Pedido: crossfade. Ficou dip to black porque a fonte não tinha margem." Downgrade reasons map to fixed Portuguese strings:
  - `no_source_handle` → "a fonte não tinha margem"
  - `slot_too_short` → "o clipe é curto demais"
  - `overlapping_transitions` → "a transição de entrada já ocupa o clipe"
  - `last_clip` → "é o último clipe"

No new buttons.

## Contract for increment 2

Recorded here so increment 1 does not paint it into a corner:

- Human edits write `direction` on the clip and run the same `resolveCutStyles`, producing a new timeline version with `effectsPlanner: 'manual'`.
- The feedback event is `CUT_STYLE_SET` carrying `clipId`, `kind`, `requested`, and `resolved`; the Director's memory examples will include it.
- The Inspector selector uses the same two enums; nothing in the vocabulary is Studio-specific.

## Errors

- A pick with a style outside the enum fails to parse in the gateway → `DIRECTOR_ERROR`.
- The resolver never fails for a missing handle; it downgrades.
- `EFFECTS_INVALID_RESULT` remains the safety net if the resolver produces something the validator rejects. That is a bug, not an expected state.
- `INSUFFICIENT_CATALOG` semantics do not change; cut styles never cause it.

## Testing

Vertical TDD slices, as in previous increments:

- `timeline`: a persisted timeline without the new fields parses; a style outside the enum is rejected.
- `director`: `assembleDirectedTimeline` puts `direction.clipStyle` only on the primary clip and `direction.transitionOut` only on the last clip of each segment; tiles get defaults.
- `effects`: a table of cases per style covering feasible, shrunk, and downgraded, each with the expected reason; `hold` and zoom interaction; `slow_down` suppresses zoom; last clip always `hard`; incoming plus outgoing overflow; determinism; swap revalidates neighbors.
- `renderer`: the generated graph for each style; `xfade` offsets with two and with three clips; handle sums closing on `durationMs`; the three new validation codes; `fps` pinned before `xfade`.
- `model-providers`: v4 schema with omitted and explicit styles; fixture in both modes.
- End to end: a render with the fixture in `styled` mode, checking duration, resolution, fps, and no black interval outside declared `dip_black` windows.

Full TypeScript tests, typecheck, lint, and affected E2E suites at completion.

## Versioning and docs

- `WORKER_VERSION.DIRECTOR` and `WORKER_VERSION.EFFECTS` bump a minor.
- `DIRECTOR_PROMPT_VERSION = 'v4'`.
- `README.md`: the vocabulary, the time model, and the downgrade table replace the "hard cuts only" sentence.
- `CHANGELOG.md` entry.
- `docs/superpowers/specs/2026-08-30-continuous-sixty-second-video-design.md` gets a note pointing here for the revised non-goal.

## Non-goals

- Human editing of cut styles in the Studio (increment 2).
- Feedback events or editorial memory for cut styles (increment 2).
- Transition durations chosen by the model.
- `glitch`, `jump_cut`, `match_cut`, early/late cut offsets.
- Audio ducking, audio crossfades, or any change to the audio chain.
- Transitions between tiles inside one segment.
- GPU or shader-based transitions.

## Acceptance criteria

1. A Director response with styles renders end to end; a response with no styles renders exactly as today.
2. Every timeline still covers the window with contiguous, non-overlapping slots, and the rendered duration matches `durationMs` within `DURATION_DRIFT_MS`.
3. Every downgrade is recorded on the clip with its reason and shown in the Inspector in Portuguese.
4. A swap never produces a transition without a handle.
5. The same input always produces the same resolved timeline.
6. Focused, full, typecheck, lint, and affected E2E verification passes.
7. README, changelog, and the sixty-second spec note accompany the implementation.
