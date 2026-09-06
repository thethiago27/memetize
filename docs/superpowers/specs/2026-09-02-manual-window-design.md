# Manual edit window

**Date:** 2026-09-02  
**Status:** Approved for planning  
**Branch:** `feat/manual-window`

## Objective

Let the editor choose which stretch of the song the video covers when the automatic pick is wrong. The choice is made on the "Análise" tab by dragging the window band, refined with `mm:ss` fields, saved on the project, and honored by the pipeline until the editor returns to the automatic choice.

The rest of the pipeline is unchanged: narrative, match, director, timing, effects, and render already work from whatever `edit_windows` row is latest, and already support windows shorter than 30 seconds (short tracks).

## Rules

- Start and end are free, in source time.
- Duration between `MIN_MANUAL_WINDOW_MS = 5_000` and `MAX_OUTPUT_DURATION_MS = 30_000`, inclusive.
  (Amended 2026-09-06 from 60_000; see the amendment note in the sixty-second-video design.)
- `0 <= sourceStartMs < sourceEndMs <= audio.durationMs`.
- Edges snap to the nearest downbeat while dragging; holding Shift disables snapping. The `mm:ss` fields never snap. Snapping is a Studio convenience; the API accepts any millisecond values that pass the rules above.

`ManualWindowInput` in `@memetize/contracts` (`audio.ts`) holds the shape `{ sourceStartMs, sourceEndMs }` with integer, non-negative checks and the duration bounds as a refinement. The upper bound on `sourceEndMs` (track duration) is checked by the API and CLI against `audio_analysis`, since the contract cannot see the track.

## Data

Two nullable columns on `projects`, added by migration `0011_manual_window.sql`:

- `manual_window_start_ms integer`
- `manual_window_end_ms integer`

Both null means automatic. They are set and cleared together. `ProjectRow` gains `manualWindowStartMs` and `manualWindowEndMs`.

`edit_windows` rows created from a manual choice use `selector = 'manual'`, `selectorVersion = '1.0.0'`, `targetDurationMs = durationMs`, and a `score` / `scoreBreakdown` computed by the highlight scorer for the chosen range, so the Studio can show how the manual pick compares to the automatic one. The scorer is exposed from `@memetize/edit-planner` as `scoreEditWindow(startMs, endMs, input)`; `selectEditWindow` keeps its behavior.

## Pipeline

`@memetize/projects` gains `resolveEditWindow(db, projectId, input)` used by the `NARRATIVE` handler in place of the direct `selectEditWindow` call:

1. Load the project. If `manualWindowStartMs` and `manualWindowEndMs` are set, validate them against `audio.durationMs`; on failure throw `JobFailure('MANUAL_WINDOW_INVALID', …, false)`. Otherwise return the manual selection with `selector = 'manual'`.
2. Else return `selectEditWindow(input)` as today.

The handler inserts the returned selection exactly as it does now. Everything downstream is untouched.

`setManualWindow(db, projectId, { sourceStartMs, sourceEndMs })` and `clearManualWindow(db, projectId)` live in `@memetize/projects` (`window.ts`). Both refuse with `ProjectBusyError` while a job for the project is `RUNNING` (same guard as `deleteProject`), then update the columns and call `reprocessProject(db, projectId, 'narrative')`.

## API

- `PUT /v1/projects/:id/window`, body `ManualWindowInput`. `404` unknown project, `400 INVALID_INPUT` for a body outside the rules or an end past the track, `409 PROJECT_BUSY` while a job runs, `409 NO_AUDIO` before audio analysis exists. On success `{ ok: true, manualWindow: { sourceStartMs, sourceEndMs } }` and a drain kick.
- `DELETE /v1/projects/:id/window`: clears and reprocesses. Same `404` / `409`. Returns `{ ok: true }`.
- `GET /v1/projects/:id` gains `manualWindow: { sourceStartMs, sourceEndMs } | null` next to `editWindow`. `GET /v1/projects` is unchanged.

## CLI

`pnpm cli project window <projectId> --start <mm:ss|ms> --end <mm:ss|ms> [--no-wait]` sets the window and drains; `pnpm cli project window <projectId> --auto` clears it. Times accept `mm:ss`, `mm:ss.mmm`, or plain milliseconds. Errors print the same messages as the API.

## Studio: "Análise" tab

### Header

- When `manualWindow` is set: pill "Trecho manual" plus a ghost button "Voltar à escolha automática". Clicking asks for confirmation in a dialog ("A IA vai escolher o trecho de novo e o vídeo será refeito."), then calls `DELETE`.
- Otherwise: pill "Trecho automático" with the score in muted mono.
- A primary-looking `btn` "Escolher trecho" enters selection mode. Disabled while jobs are active or without `audio`.

### Selection mode

- The chart keeps every track. The window band becomes a draft band with two 8px handles at its edges. Dragging a handle moves that edge; dragging inside the band moves the whole window; pressing and dragging outside the band creates a new draft from the press point. Shift while dragging disables downbeat snapping.
- Click-to-seek is disabled in selection mode.
- Below the chart, a `cluster`: field "Início" (`mm:ss`), field "Fim" (`mm:ss`), the resulting duration, "cobre N linhas da letra", and the buttons "Usar este trecho" (`btn-primary`) and "Cancelar" (`btn-ghost`).
- The draft starts from the current window (`editWindow`) so small adjustments are one drag away.
- Validation messages appear inline under the fields in `notice[data-tone="bad"]`: "Mínimo de 5 segundos", "Máximo de 30 segundos", "O fim precisa vir depois do início", "Fora da música".
- "Usar este trecho" calls `PUT`, shows the toast "Trecho salvo. O motor está refazendo o vídeo com ele.", leaves selection mode, and lets the existing polling follow the jobs.

### Time helpers

`apps/web/src/lib/analysis-time.ts` gains:

- `snapToDownbeat(ms, downbeats, toleranceMs)`: nearest downbeat within `toleranceMs`, else `ms`. Tolerance is 2% of the track duration, at least 250 ms.
- `parseTimecode('mm:ss' | 'mm:ss.mmm')` returning ms or `null`.
- `clampWindow(draft, durationMs)` that keeps `[start, end]` inside the track without changing its length when the whole band is dragged.
- `linesWithin(lines, start, end)` count.

## Out of scope

- Choosing a window per timeline version or keeping several manual windows.
- Editing the window on the home cards.
- Changing how the automatic selector scores candidates.
- Windows longer than 30 seconds.

## Testing

- Contracts: `ManualWindowInput` accepts 5 s and 30 s, rejects 4.999 s, 30.001 s, negative start, end before start.
- Edit planner: `scoreEditWindow` returns a breakdown in `[0, 1]` for an arbitrary range and matches `selectEditWindow`'s winner score for the winner's range.
- Projects (integration): `resolveEditWindow` returns the manual selection when the columns are set and the automatic one when null; `setManualWindow` writes the columns, drops `NARRATIVE` and downstream jobs, enqueues a fresh `NARRATIVE`; `clearManualWindow` nulls the columns and enqueues; both raise `ProjectBusyError` with a `RUNNING` job.
- Narrative worker (integration): with the columns set, the inserted `edit_windows` row has `selector = 'manual'` and the chosen bounds.
- API: `PUT` happy path and `400` / `404` / `409`; `DELETE` happy path; detail returns `manualWindow`.
- Web: unit tests for `snapToDownbeat`, `parseTimecode`, `clampWindow`, `linesWithin`.
- Manual: drag the band on a completed project, save, watch the stepper rerun from narrative, and confirm the new render covers the chosen stretch; revert and confirm the automatic window returns.
