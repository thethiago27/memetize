# Cut Styles Implementation Plan

**Goal:** Let the Director propose a closed vocabulary of transitions and clip styles, resolve them deterministically against the real source material in the Effects phase, render them with FFmpeg, and show the result (read-only) in the Studio.

**Spec:** `docs/superpowers/specs/2026-09-01-cut-styles-design.md`

**Tech Stack:** TypeScript 5.9, Node.js 22, pnpm/Turborepo, Vitest, Zod, Drizzle/PostgreSQL, Fastify, Next.js/React, FFmpeg.

## Global Constraints

- Write a failing test before each production-code slice where a public seam exists.
- Add no external dependency.
- All times are integer milliseconds. Transition durations are always even so `D/2` stays an integer; the resolver rounds down to the nearest even number after clamping.
- Timeline slots stay contiguous and non-overlapping; `source` always covers the slot. Transitions are boundary metadata with handles, never overlapping slots.
- `schemaVersion` stays `1.0`; every new field is optional with a default so persisted timelines keep parsing.
- The fixture provider stays deterministic and free of API calls.
- Work only on `feat/cut-styles`; commit one slice at a time.
- Update `CHANGELOG.md`, `README.md`, and the sixty-second spec note before finishing.

## File Structure

### Contracts and timeline

- `packages/timeline/src/timeline.ts` (+ `timeline.test.ts`): `TransitionStyle`, `ClipStyle`, `CutDowngradeReason`, `TimelineDirection`, `TimelineTransitionOut`, new optional fields on `TimelineClip`.
- `packages/contracts/src/director.ts` (+ test): `DirectorPick.clipStyle`, `DirectorPick.transitionOut`.
- `packages/contracts/src/render.ts`: no change (validation *errors* live in `packages/renderer/src/types.ts`).
- `packages/contracts/src/registry.ts` (+ `feedback.test.ts` version assertions): `DIRECTOR` 1.2.0, `EFFECTS` 1.2.0.

### Director

- `packages/prompts/src/director.ts` (+ test): `DIRECTOR_PROMPT_V4`, `DIRECTOR_PROMPT_VERSION = 'v4'`.
- `packages/model-providers/src/types.ts`: `DirectorPickSuggestion.clipStyle`, `.transitionOut`; `FixtureOptions.directorStyles: 'plain' | 'styled'`.
- `packages/model-providers/src/gateway.ts` (+ test): `DirectorPicksSchema` with the enums.
- `packages/model-providers/src/fixture.ts` (+ test): `plain` (defaults) and `styled` modes.
- `packages/director/src/assemble.ts` (+ test): map pick styles onto primary / last clip of each segment.
- `packages/director/src/coverage.ts`: expose which resolved clip is `primary` and which is last per segment (already in `CoverageDecision.role`; add `segmentId` ordering helper if needed).
- `workers/director/src/handler.ts`: pass styles through; record them in the debug file.

### Effects resolver

- `packages/effects/src/constants.ts`: duration bases, clamps, speed factors, `MAX_TRANSITION_SLOT_FRACTION = 1/3`.
- `packages/effects/src/cut-styles.ts` (+ `cut-styles.test.ts`): `resolveCutStyles(timeline, context)` and `CutDecision`.
- `packages/effects/src/types.ts`: `EffectsContext.beatMs`, `EffectsContext.sourceBoundsByMomentId`, `CutDecision`, `EffectsResult.cuts`.
- `packages/effects/src/plan.ts` (+ test): call the resolver first; zoom respects `hold` and skips `slow_down`.
- `workers/effects/src/handler.ts`: build the new context (audio analysis for `beatMs`, moment rows for bounds), write `cuts` to the debug file.
- `packages/projects/src/swap.ts` (+ integration test): re-resolve the swapped clip and its neighbors.

### Renderer

- `packages/renderer/src/constants.ts`: `XFADE_TRANSITION_BY_STYLE`.
- `packages/renderer/src/types.ts`: new `TimelineIssue` codes.
- `packages/renderer/src/cuts.ts` (+ test): pure helpers `handlesFor(clip, previous, next)`, `buildBoundaryFadeFilters`, `buildHoldFilter`, `buildSpeedFilter`, `parseHoldEffect`, `parseSpeedEffect`.
- `packages/renderer/src/graph.ts` (+ test): accumulator with `concat` / `xfade`, handles in `trim`, per-clip filter order, `fps` pinning.
- `packages/renderer/src/validate-timeline.ts` (+ test): the three new errors, `hold` and `speed` accepted.
- `packages/renderer/src/zoom.ts`: zoom window clipped by `hold` (or handled in the resolver only; see Task 8).

### Studio

- `apps/web/src/lib/api.ts`: `TimelineClip.direction`, `.transitionOut`, effect entries with `requested` / `downgradeReason`.
- `apps/web/src/lib/labels.ts`: style and reason labels in Portuguese.
- `apps/web/src/components/TimelineStrip.tsx`: boundary marker, clip style icon.
- `apps/web/src/components/Inspector.tsx`: "Corte" line.
- `apps/web/src/app/globals.css`: marker and icon classes.

### Docs

- `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-continuous-sixty-second-video-design.md` (note), `project.md` §33/§57 (short note pointing to the spec).

---

## Phase 1: Contract

- [x] **Task 1: Timeline schema.** Test first in `timeline.test.ts`: a persisted timeline without the new fields parses to defaults; `direction.transitionOut: 'glitch'` is rejected; `transitionOut.durationMs` must be a non-negative even integer. Add the enums and `direction` / `transitionOut` to `TimelineClip`. Export the enum arrays for the Studio labels. Commit `feat: add cut style fields to the timeline contract`.

- [x] **Task 2: Director pick contract.** Test: `DirectorPick.parse({segmentId, momentId})` yields `clipStyle: 'none'`, `transitionOut: 'hard'`; an unknown style fails. Bump `WORKER_VERSION.DIRECTOR` and `EFFECTS` to `1.2.0` and update the version assertions in `packages/contracts/src/feedback.test.ts`. Commit `feat: let director picks carry cut styles`.

## Phase 2: Director proposes

- [x] **Task 3: Prompt v4.** Test in `packages/prompts`: v4 contains every vocabulary word and the "at most one third" rule. Write `DIRECTOR_PROMPT_V4` as v3 plus the spec paragraph; set `DIRECTOR_PROMPT_VERSION = 'v4'`. Commit `feat: describe cut styles in the director prompt`.

- [x] **Task 4: Providers.** Gateway test: `DirectorPicksSchema` accepts omitted styles and explicit styles, rejects an unknown one. Fixture tests: `plain` mode emits only defaults; `styled` mode is deterministic and assigns by segment index (`i % 5` over the transition enum, `i % 4` over the clip enum, last segment `hard`). Add `directorStyles` to the fixture options and thread `DirectorPickSuggestion` fields through `DirectTimelineResult`. Commit `feat: emit cut styles from the fixture and gateway providers`.

- [x] **Task 5: Assemble.** Test in `assemble.test.ts`: a segment tiled into three clips gets `direction.clipStyle` only on the `primary` clip and `direction.transitionOut` only on the last clip; other clips get `none` / `hard`; a pick without styles yields defaults on every clip. Use `CoverageDecision.role` and clip order per segment to place them. Update `workers/director/src/handler.ts` to pass the styles and add them to the debug file. Commit `feat: place director cut styles on assembled clips`.

## Phase 3: Resolver

- [x] **Task 6: Constants and types.** Add duration bases, clamps, speed factors, and `MAX_TRANSITION_SLOT_FRACTION` to `packages/effects/src/constants.ts`. Extend `EffectsContext` with `beatMs` and `sourceBoundsByMomentId`; add `CutDecision` and `EffectsResult.cuts`. No commit alone; folds into Task 7.

- [x] **Task 7: `resolveCutStyles`.** Test table in `cut-styles.test.ts`, one row per case, each asserting resolved style, duration, and reason:
  - `crossfade` with handles on both sides → `crossfade`, duration = clamp(beat).
  - `crossfade` with a handle only on one side → shrinks to the minimum if that fits, else `dip_black` / `no_source_handle`.
  - `crossfade` where a neighbor slot is under `3 × D_min` → `dip_black` / `slot_too_short`.
  - `whip` without handles → `hard` / `no_source_handle`.
  - `dip_black` and `flash` on normal slots → as requested; on a slot under `2 × D_min` → `hard` / `slot_too_short`.
  - `hold` on a 2,000 ms slot at 120 bpm → 500 ms hold; on a 400 ms slot → `none` / `slot_too_short`.
  - `speed_up` with 25 % extra source in the moment → `speed` effect with `factor 1.25` and `source.endMs` extended; without → `none` / `no_source_handle`.
  - `slow_down` → always `speed` with `factor 0.8`.
  - Last clip requests `crossfade` → `hard` / `last_clip`.
  - (`overlapping_transitions` cannot occur under the one-third cap; it is tested on the validator in Task 11.)
  - Determinism: two runs give deep-equal output.
  - Slots never move; only `source.endMs` for `speed_up`.
  Implement the resolver visiting clips in timeline order, clip style before transition. Commit `feat: resolve director cut styles against source handles`.

- [x] **Task 8: `planEffects` integration.** Tests in `plan.test.ts`: zoom window ends where `hold` starts; `slow_down` suppresses zoom; a re-run does not accumulate `hold` / `speed` entries; `EffectsResult.cuts` lists every decision. Call `resolveCutStyles` first, then the zoom. Commit `feat: plan cut styles before the punchline zoom`.

- [x] **Task 9: Effects worker.** Load audio analysis (`beatMs` from the project's tempo, fallback 500 ms when absent) and moment rows for bounds, mirroring the Timing worker; write `cuts` to the effects debug file; set `effectsPlannerVersion` from the registry. Extend the existing worker integration test if one exists, else add a focused one around the context builder. Commit `feat: resolve cut styles in the effects worker`.

- [x] **Task 10: Swap re-resolution.** Integration test in `swap.integration.test.ts`: a clip with `transitionOut: crossfade` swapped to a moment with no tail handle persists as `dip_black` with `no_source_handle`, and its neighbors are re-resolved. Load audio analysis and the three moments' bounds inside `swapClip`, call `resolveCutStyles` on a three-clip window, and merge the result back. Commit `fix: revalidate cut styles when a clip is swapped`.

## Phase 4: Renderer

- [ ] **Task 11: Validation.** Tests in `validate-timeline.test.ts`: `hold` and `speed` produce no `UNKNOWN_EFFECT`; an unknown style is still rejected (rename the `fade` test); `TRANSITION_TOO_LONG` when `durationMs > min(slotA, slotB) / 3`; `TRANSITION_HANDLE_OUT_OF_BOUNDS` when `source.startMs − D/2 < 0`; `OVERLAPPING_TRANSITIONS` when incoming plus outgoing exceed the slot. Add the codes to `TimelineIssue` and the checks. Commit `feat: validate transitions and clip styles in the timeline`.

- [ ] **Task 12: Cut helpers.** Tests in `cuts.test.ts` for `handlesFor` (incoming and outgoing halves, zero for `hard` and non-overlapping styles), `buildBoundaryFadeFilters` (black and white, in and out, `st` and `d` values), `buildHoldFilter`, `buildSpeedFilter` (`setpts` and trimmed source length for `slow_down`), and the parsers' rejection of malformed entries. Commit `feat: add renderer helpers for cut styles`.

- [ ] **Task 13: Graph.** Tests in `graph.test.ts`:
  - No styles → graph identical to today (existing tests keep passing).
  - Two clips with `crossfade` 300 ms → `[v0][v1]xfade=transition=fade:duration=0.300:offset=<slotA−0.150>[x1]`, A trimmed to `source.endMs + 150`, B from `source.startMs − 150`.
  - Three clips, hard then whip → `concat` of the first two, then `xfade=transition=slideleft` with offset = `slotA + slotB − D/2`.
  - `dip_black` → `fade=t=out` on A and `fade=t=in` on B, still `concat`.
  - `hold` → `tpad=stop_mode=clone:stop_duration=` present only with a declared hold; the existing "no clone padding" assertion becomes "no clone padding without a hold".
  - `speed` filters in the documented order relative to zoom and hold.
  - `fps=<canvas fps>` on every segment when any `xfade` exists.
  - Sum of segment lengths minus every `xfade` duration equals `durationMs`.
  Replace the terminal `concat` with the accumulator. Commit `feat: render transitions and clip styles in the ffmpeg graph`.

- [ ] **Task 14: End to end.** Extend the existing CLI e2e render test (or add `cut-styles.e2e.test.ts` next to it) to run the fixture in `styled` mode: assert output duration, resolution, fps, at least one `xfade` and one `fade` in the generated graph, and `blackdetect` finds black only inside declared `dip_black` windows. Commit `test: render a styled timeline end to end`.

## Phase 5: Studio

- [ ] **Task 15: Client types and labels.** Add the fields to `TimelineClip` in `apps/web/src/lib/api.ts`. Add `TRANSITION_STYLE_LABELS`, `CLIP_STYLE_LABELS`, and `CUT_DOWNGRADE_LABELS` in Portuguese to `lib/labels.ts` ("corte seco", "dip to black", "flash", "crossfade", "whip"; "hold", "acelerado", "câmera lenta"; the four reason strings from the spec). Commit `feat: add cut style labels to the studio`.

- [ ] **Task 16: Strip and inspector.** `TimelineStrip`: thin marker between clips whose `transitionOut.style !== 'hard'`, with a `title` naming the style and duration; small icon on clips with any effect. `Inspector`: "Corte" line as specified, with the downgrade sentence when `downgradeReason` is set. Run `pnpm --filter web typecheck` and lint. Commit `feat: show cut styles in the studio editor`.

## Phase 6: Verification and docs

- [ ] **Task 17: Full verification.** `rtk pnpm test`, `rtk pnpm typecheck`, `rtk pnpm lint`, affected E2E suites. Fix anything that surfaces.

- [ ] **Task 18: Docs.** README: replace the "hard cuts only" sentence with the vocabulary, the handle model, and the downgrade table. CHANGELOG entry. Note in the sixty-second spec's non-goals pointing to the cut-styles spec. Short pointer in `project.md` §33 and §57. Commit `docs: document cut styles`.
