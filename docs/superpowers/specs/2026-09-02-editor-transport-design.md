# Editor transport and ergonomics

**Date:** 2026-09-02  
**Status:** Approved for planning  
**Branch:** `feat/editor-transport`

## Objective

Make the Studio editor behave like an editing tool before a render exists: one clock that drives the preview, the timeline strip and the Análise tab; a strip that measures itself so pointer positions map exactly to time; a storyboard preview that plays the project's music with the clip thumbnails when there is no current render; and actions that lock only what they touch.

This is the first of three editor increments chosen on 2026-09-02:

1. **Editor transport and ergonomics** (this spec).
2. Hand-editing cut styles in the Inspector (contract in `2026-09-01-cut-styles-design.md`, "Contract for increment 2").
3. Timeline tools: boundary trim, source slip, keyboard shortcuts, strip zoom.

The pipeline does not change. The timeline document already carries `audio.path`, `audio.sourceStartMs` and `audio.timelineStartMs`, which is all the storyboard needs. The API changes in one place: `GET /v1/media/*` honors HTTP `Range` requests (`Accept-Ranges: bytes`, `206 Partial Content`, `416` when unsatisfiable). Without it browsers cannot seek inside a `<video>` or `<audio>`: seeking past the buffer restarts the download from zero and playback snaps back to the start.

## Problems being fixed

1. The playhead exists only while the rendered video plays. Without a render, or with a stale one, clicking a clip shows nothing in the preview.
2. Time is owned by the `<video>` element; the strip and the Análise tab reach into it through a ref.
3. The strip is a flex row with `flex-grow` and a 26px minimum width, so pixel positions are not proportional to time and cannot be scrubbed.
4. Pausing the video sets the playhead to `null`, so the strip forgets where the editor was.
5. A single `busy` string disables every button during any request, including unrelated ones.
6. The editor page is a 562-line component with four tab bodies inlined.

## Layout

The editor fits the viewport, so the preview and the strip are always on screen together. A 9:16 preview at a fixed width pushed the strip below the fold on every laptop screen.

```
+--------------------------------------------------+
| ← MP3 ● Concluído  03:27 · 112 bpm · trecho … · timeline v14 · render v5   Avaliar ★★★★★ [Gerar timeline] [Renderizar] Excluir |
| ● Áudio ● Letra ● Narrativa ● Match ● Direção ● Timing ● Efeitos ● Render   (notices only when they apply) |
+-----------------------------+--------------------+
|  Preview, sized to the      |  Inspector         |
|  height that is left        |  (scrolls)         |
|  TransportBar               |                    |
+-----------------------------+--------------------+
|  Ruler + TimelineStrip (pinned)                  |
+--------------------------------------------------+
|  Tabs: Narrativa | Análise | Renders | …  (page scrolls to them) |
```

`.editor-shell` is a grid with rows `auto auto minmax(0, 1fr) auto` and `height: calc(100dvh - mast - page padding)`, minimum 560px. The header is one line (`.editor-head`): back arrow, title, status pill, and a meta line that gives way before the title does; rating and actions on the right. The pipeline line (`.pipeline-line`) shows the eight steps as dot-and-label chips and, only when they apply, the failed-step and stale-render notices inline. The edit window moves into the header meta ("trecho mm:ss–mm:ss"). `.editor-body` holds the preview beside the inspector, which scrolls inside the row (`min-height: 0; overflow-y: auto`). The preview's screen keeps 9:16 and takes the height left in its column: the wrapper is a size container and the screen's height is `min(100cqh, 100cqw × 16 / 9)`. The strip row sits under the body. The tabs panel follows the shell in normal flow.

Under 960px the shell stops fitting the viewport: `.editor-body` becomes `display: contents` and `order` puts preview, strip, inspector in that sequence; the inspector stops scrolling.

## Components

All new editor pieces live in `apps/web/src/components/editor/`. The page `apps/web/src/app/projects/[id]/page.tsx` becomes an orchestrator: it loads the project, owns selection, calls `useTransport` and `useEditorActions`, and composes the components below. Target: under 200 lines.

| Component | Responsibility | Props (inputs → callbacks) |
| --- | --- | --- |
| `EditorHeader` | Title, status pill, meta line, rating stars, Gerar timeline, Renderizar, Excluir, and the delete dialog | `detail`, `latestRating`, `actions` → `onRate`, `onGenerate`, `onRender`, `onDelete` |
| `PipelineStatus` | Stepper, failed-job notices with the `INSUFFICIENT_CATALOG` hint, stale-render notice, edit-window line | `detail` |
| `Preview` | The 9:16 screen: `<video>` in render mode, storyboard frame in storyboard mode, empty state otherwise; mounts the hidden `<audio>` in storyboard mode | `transport`, `detail`, `clipAtPlayhead`, `moments` |
| `TransportBar` | Play/pause, timecode, current clip description, mode chip, mode toggle when a stale render exists, position slider | `transport`, `clipAtPlayhead`, `canShowRender` → `onToggleMode` |
| `TimelineStrip` | Ruler, clips, cut markers, playhead, scrub and click-to-select | `clips`, `durationMs`, `segments`, `moments`, `downbeatsMs`, `selectedId`, `transport` → `onSelect` |
| `EditorTabs` | Tab bar and the active tab body | `tab`, `detail`, `transport`, `actions` → `onTab`, `onSelectSegment`, `onSetWindow`, `onClearWindow`, `onNote` |
| `NarrativeTab`, `RendersTab`, `MemoryTab`, `JobsTab` | The four inline tab bodies, extracted verbatim except where noted below | per tab |

`Inspector`, `Stepper`, `StatusPill`, `Thumb`, `Toast` and `AnalysisPanel` keep their files. `AnalysisPanel` changes only its time inputs: it receives `positionMs` from the transport and calls `transport.seek` instead of touching the video.

## Transport: one clock

`apps/web/src/lib/use-transport.ts` exports `useTransport(input)`:

```ts
interface TransportInput {
  timeline: { version: number; data: TimelineDocument } | null;
  render: RenderRow | null;
  preferRender: boolean; // user toggle; only honored when a render exists
}

interface Transport {
  mode: 'render' | 'storyboard' | 'none';
  positionMs: number;      // output clock, 0..durationMs
  playing: boolean;
  durationMs: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;  // clamps to [0, durationMs]; moves the media element too
  scrub(ms: number): void; // moves only the clock, for the middle of a drag
  mediaRef: RefObject<HTMLMediaElement | null>; // the element this transport drives
  attachMedia(element: HTMLMediaElement | null): void; // callback ref; seeks the element to positionMs on mount
  onEnded(): void;
}
```

Rules:

- **Mode.** `render` when a render exists and either its `timelineVersion` equals the current timeline version or `preferRender` is true. `storyboard` when a timeline exists and the render rule did not apply. `none` when there is no timeline. Changing mode keeps `positionMs` and pauses.
- **Media.** In `render` mode the transport drives the `<video>`. In `storyboard` mode it drives a hidden `<audio>` whose `src` is `mediaUrl(timeline.data.audio.path)`. `Preview` mounts whichever element the mode needs and assigns it to `mediaRef`.
- **Clock mapping.** `apps/web/src/lib/storyboard-clock.ts` holds the pure functions `outputToSourceMs(outputMs, audio)` = `outputMs - audio.timelineStartMs + audio.sourceStartMs` and `sourceToOutputMs(sourceMs, audio)`, the inverse. Seeking the audio uses the first; reading its `currentTime` uses the second.
- **Position updates.** While `playing`, a `requestAnimationFrame` loop reads `mediaRef.current.currentTime` and updates `positionMs`. The loop stops on pause and when the position reaches `durationMs`, which also pauses the media. Pausing keeps `positionMs`.
- **Seek.** Sets `positionMs` and the media element's `currentTime` if the element is mounted. When the element mounts later (mode change, first render), it starts at the current `positionMs`.
- **Ended.** A `<video>` `ended` event and the storyboard reaching `durationMs` both set `playing` to false and leave `positionMs` at `durationMs`.

`page.tsx` derives `clipAtPlayhead` from `positionMs` and passes it down; it is the clip whose `timeline.startMs <= positionMs < timeline.endMs`, or the last clip when `positionMs === durationMs`.

## Selection

- Clicking a clip in the strip, or a segment row in the Narrativa tab, selects it and seeks to its `timeline.startMs`.
- Playback highlights `clipAtPlayhead` in the strip but does not change the selection, so the Inspector does not jump while the video plays.
- Selection survives reloads. When a reload brings a timeline whose clip ids do not include the selected id, the selection falls back to `clipAtPlayhead`, then to the first clip.

## Timeline strip

`apps/web/src/components/editor/TimelineStrip.tsx` is rewritten on top of two pure helpers in `apps/web/src/lib/strip-geometry.ts`:

```ts
msToPx(ms, durationMs, widthPx): number
pxToMs(px, durationMs, widthPx): number        // clamped to [0, durationMs]
rulerTicks(durationMs, widthPx): { ms: number; label: boolean }[]
clipAt(clips, ms): TimelineClip | null
outputDownbeats(downbeatsMs, editWindow, durationMs): number[]
```

- **Measurement.** `apps/web/src/lib/use-element-width.ts` returns the element's content width through a `ResizeObserver`. Every clip is absolutely positioned with `left = msToPx(startMs)` and `width = msToPx(slotMs)`. There is no minimum width. Clips narrower than 40px render only the function color bar and the thumbnail; the timecode label and the effect badge are hidden.
- **Ruler.** A row above the strip. `rulerTicks` returns a tick every 5 s with `label: true` every 10 s; when `widthPx / (durationMs / 10_000)` is under 56px, labels move to every 20 s. Downbeats from `audio.downbeats`, mapped by `outputDownbeats` through `editWindow.sourceStartMs`, draw as 1px marks in the lower half of the ruler.
- **Playhead.** A 2px `--playhead` line spanning ruler and strip with a small triangular handle inside the ruler, positioned at `msToPx(positionMs)`.
- **Scrub.** `pointerdown` on the ruler or the strip captures the pointer, pauses the transport, and calls `transport.scrub(pxToMs)`, which moves only the clock: the playhead and the storyboard follow it, the media element does not. `pointermove` keeps scrubbing. `pointerup` releases capture and calls `transport.seek`, which is the one media seek of the gesture; seeking a `<video>` on every pointer move stalls it. If the pointer moved less than 3px since `pointerdown`, the gesture counts as a click and selects `clipAt(ms)` instead.
- **Clips stay `<button>`s** for keyboard users: Tab reaches them, Enter or Space selects. Their own `click` handler is suppressed when the strip's pointer handling already consumed the gesture, so a click never selects twice.
- **Cut markers.** A non-`hard` `transitionOut` draws as a 6px overlay centered on the boundary between the clip and the next one, with the same `data-style` variants as today. Markers no longer take horizontal space.
- **Legend.** The narrative-function legend stays under the strip.

## Preview and storyboard

`Preview` renders by mode:

- `render`: `<video>` with `playsInline`, without native controls, `src` from the latest render (or the preferred one). Play, pause and seek come from the transport.
- `storyboard`: an `<img>` of `moments[clipAtPlayhead.momentId].thumbnailPath` filling the 9:16 screen with `object-fit: cover`, a placeholder when the moment has no thumbnail, and an overlay in the lower third with the function pill, the timecode and the text "Prévia sem render". The hidden `<audio preload="auto">` sits inside this branch.
- `none`: the existing empty states.

Known limitation, stated in the overlay's `title`: the storyboard shows one frame per clip, the scene frame nearest the moment start, not the frame at the exact position.

`TransportBar` under the screen:

- Play/pause button (`btn btn-sm`), disabled in mode `none`.
- Timecode `mm:ss.d / mm:ss.d` in mono.
- The current clip's description, ellipsized, or "Nenhum clipe".
- Mode chip: "Render vN" or "Storyboard".
- When a render exists but is stale, a ghost button toggles between "Ver storyboard" and "Ver render vN" by flipping `preferRender`.
- An `<input type="range">` from 0 to `durationMs` bound to `positionMs`; dragging it seeks. This is the keyboard seek path.

## Actions, busy and refresh

`apps/web/src/lib/use-editor-actions.ts` exports `useEditorActions({ projectId, reload, notify, applyTimeline })`:

```ts
interface EditorActions {
  busy: ReadonlySet<string>;
  isBusy(key: string): boolean;
  timelineLocked: boolean; // any timeline-group key busy, or active jobs
  run(key: string, action: () => Promise<unknown>, success?: string): Promise<boolean>;
}
```

- `run` adds `key` to `busy`, awaits the action, shows the success toast, calls `reload()`, and removes the key. Errors show the API message in a red toast. It returns whether the action succeeded, which the Análise tab uses to leave selection mode.
- Keys and groups: `generate`, `swap:<momentId>`, `window:set`, `window:clear` belong to the timeline group and set `timelineLocked` together with `hasActiveJobs`. `rate:<n>`, `up`, `down`, `ban:<momentId>`, `note`, `render`, `delete` are independent; each button disables only on its own key. `render` also disables while `timelineLocked`.
- **Swap applies immediately.** `api.swapClip` returns the new timeline version. The page's `applyTimeline` writes it into `detail.timeline` before `reload()` runs, so the strip, the Inspector's "Em uso" mark and the stale-render notice update in the same frame.
- Polling stays: `useInterval(load, hasActiveJobs)` at 1.5 s.

## Tabs

- `NarrativeTab` gets `onSelectSegment(segmentId)`. Each row is a button; clicking it selects the first clip whose `reason.segmentId` matches and seeks to it. The row of the selected clip's segment is marked `data-selected`.
- `RendersTab`, `MemoryTab` and `JobsTab` move without behavior changes. `MemoryTab` owns the note input state.
- `AnalysisPanel` receives `positionMs` and `onSeek` from the transport, and `locked = actions.timelineLocked`.

## Visual

- Strip height `--strip-h: 84px`; ruler 22px. Clip thumbnails stay as backgrounds; the selected clip keeps the amber inset ring; the playing clip keeps the amber tint.
- Ruler text: mono 0.68rem in `--mute`; downbeat marks in `--rule`.
- `--playhead: var(--amber)`.
- `TransportBar` uses the existing `btn`, `btn-sm`, `btn-ghost`, `pill` and `mono` classes.
- Palette, fonts, radius and spacing tokens do not change. Empty and loading states do not change.

## Files

New:

- `apps/web/src/lib/use-transport.ts`
- `apps/web/src/lib/storyboard-clock.ts` and `.test.ts`
- `apps/web/src/lib/strip-geometry.ts` and `.test.ts`
- `apps/web/src/lib/use-element-width.ts`
- `apps/web/src/lib/use-editor-actions.ts`
- `apps/web/src/components/editor/EditorHeader.tsx`
- `apps/web/src/components/editor/PipelineStatus.tsx`
- `apps/web/src/components/editor/Preview.tsx`
- `apps/web/src/components/editor/TransportBar.tsx`
- `apps/web/src/components/editor/TimelineStrip.tsx` (moved from `components/`)
- `apps/web/src/components/editor/EditorTabs.tsx`, `NarrativeTab.tsx`, `RendersTab.tsx`, `MemoryTab.tsx`, `JobsTab.tsx`

- `apps/api/src/routes/media.test.ts` (`parseRange`)

Changed:

- `apps/api/src/routes/media.ts` (`Range` support, `parseRange`)
- `apps/web/src/app/projects/[id]/page.tsx` (orchestrator)
- `apps/web/src/components/Stepper.tsx` (dot-and-label chips on one line)
- `apps/web/src/components/AnalysisPanel.tsx` (transport inputs)
- `apps/web/src/lib/api.ts`: `ProjectDetail.timeline.data` gains `audio: { path; sourceStartMs; timelineStartMs }`, which the API already returns.
- `apps/web/src/app/globals.css`: `.editor` grid areas, ruler, playhead, absolute clips, transport bar, storyboard overlay.

Removed: `apps/web/src/components/TimelineStrip.tsx`.

## Out of scope

Boundary trim, source slip, strip zoom, keyboard shortcuts beyond focusable controls, cut-style editing, server-sent events, per-position frames inside a clip, and any API change beyond `Range` support on `/v1/media/*`.

## Testing

- Unit tests with Vitest for `strip-geometry.ts` (round trip `msToPx`/`pxToMs`, tick spacing at wide and narrow widths, `clipAt` at boundaries and at `durationMs`, downbeat mapping inside and outside the window) and `storyboard-clock.ts` (both directions, `timelineStartMs` not zero).
- `pnpm --filter @memetize/web build`, `pnpm typecheck` and `pnpm lint` pass.
- Manual walkthrough on the running Studio:
  1. Open a project whose render is older than its timeline: the mode chip says "Storyboard", play runs the music and the thumbnails change on time.
  2. Scrub on the ruler and on the strip; the preview follows; a plain click selects the clip.
  3. Toggle "Ver render vN" and back.
  4. Swap a clip: the strip and "Em uso" update before the reload; the stale notice appears.
  5. Rate the cut while a swap is in flight: the stars stay enabled.
  6. Click a Narrativa row: the matching clip is selected and the preview seeks.
  7. Render: when the job completes, the mode switches to "Render vN" and the video plays from the current position.
  8. Resize the window below 960px: preview, strip and inspector stack.
