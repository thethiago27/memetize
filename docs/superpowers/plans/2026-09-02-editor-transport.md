# Editor Transport Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-02-editor-transport-design.md`

## Constraints

- No new dependency; React 19, Next 15, plain CSS, Vitest.
- No API change. The timeline document already carries `audio.path`, `audio.sourceStartMs`, `audio.timelineStartMs`.
- Portuguese labels everywhere in `apps/web`.
- Pure helpers first, with tests; hooks and components on top.

## Tasks

- [x] **Task 1: Pure helpers.** `lib/storyboard-clock.ts` (output ↔ source ms) and `lib/strip-geometry.ts` (`msToPx`, `pxToMs`, `rulerTicks`, `clipAt`, `outputDownbeats`), each with a Vitest file. `api.ts` types gain `TimelineAudio` on `timeline.data`.
- [x] **Task 2: Hooks.** `lib/use-element-width.ts` (ResizeObserver), `lib/use-transport.ts` (mode, position, play/pause/seek, rAF loop, media ref), `lib/use-editor-actions.ts` (busy set, groups, `run`, `timelineLocked`).
- [x] **Task 3: Strip.** `components/editor/TimelineStrip.tsx` with ruler, absolute clips, overlay cut markers, downbeat marks, playhead, scrub and click-to-select. CSS for `.ruler`, `.playhead`, absolute `.clip`, `.cut-marker` overlay.
- [x] **Task 4: Preview and transport bar.** `components/editor/Preview.tsx` (video / storyboard / empty, hidden audio) and `components/editor/TransportBar.tsx` (play, timecode, clip name, mode chip, stale toggle, range). CSS for the storyboard overlay and the bar.
- [x] **Task 5: Header, pipeline status, tabs.** `EditorHeader`, `PipelineStatus`, `EditorTabs`, `NarrativeTab` (row selects segment), `RendersTab`, `MemoryTab`, `JobsTab`. `AnalysisPanel` takes `positionMs` and `onSeek`.
- [x] **Task 6: Page orchestration.** Rewrite `app/projects/[id]/page.tsx` on the hooks and components; selection fallback; swap applies its timeline immediately; `.editor` grid areas; remove the old `components/TimelineStrip.tsx`.
- [x] **Task 7: Verification and docs.** Vitest, `pnpm typecheck`, `pnpm lint`, web build, manual walkthrough on the running Studio, CHANGELOG entry, README note.
