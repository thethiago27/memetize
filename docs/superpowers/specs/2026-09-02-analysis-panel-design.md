# Analysis panel

**Date:** 2026-09-02  
**Status:** Approved for planning  
**Branch:** `feat/analysis-panel`

## Objective

Show, for one project, what the audio analyzer and the lyrics worker produced, on one shared time axis: musical sections, energy, beats and downbeats, and every lyric line placed at the instant it is sung. The panel lives inside the Studio editor as a new tab, "Análise", and follows the video preview when it plays.

Nothing changes in the API, the pipeline, or the database. The web client only widens one TypeScript type to match what the API already returns.

## Problems being fixed

1. The editor shows the analysis as two numbers (duration and bpm) and the lyrics only indirectly, through narrative segments.
2. There is no way to see whether the sections, the energy curve, or the lyric timings are right before trusting the Director's picks.
3. The selected 60-second window is shown as a range in text; nothing shows where it falls in the song.

## Data

`GET /v1/projects/:id` already returns:

- `audio`: the latest `audio_analysis` row: `durationMs`, `bpm`, `beats[] {timeMs, strength}`, `downbeats[] (ms)`, `sections[] {type, startMs, endMs}`, `energyCurve[] {timeMs, value}`, `analyzer`, `analyzerVersion`.
- `lyrics`: the latest `lyrics` row: `source` (`USER` | `TRANSCRIPT` | `FIXTURE`), `lines[] {startMs, endMs, text, words[]}`, `model`, `modelVersion`.
- `editWindow`: `sourceStartMs`, `sourceEndMs`, `durationMs`.

The web `ProjectDetail['audio']` type gains `beats`, `downbeats`, `energyCurve`, `analyzer`, and `analyzerVersion`; `ProjectDetail['lyrics']` gains `model` and `modelVersion`. No route, projection, or schema change.

Section types seen in the analyzers and fixtures: `intro`, `verse`, `chorus`, `bridge`, `outro`, `drop`, `break`. Unknown types render with their raw name.

## Time model

Two clocks exist:

- **Source time**: milliseconds into the original song. The analysis, the lyrics, and the edit window use it.
- **Output time**: milliseconds into the rendered video. The `<video>` element and `playheadMs` use it.

The panel draws everything in source time over `[0, audio.durationMs]`. Conversions:

- `toSource(outputMs) = editWindow.sourceStartMs + outputMs`
- `toOutput(sourceMs) = sourceMs - editWindow.sourceStartMs`, valid only when `sourceStartMs <= sourceMs <= sourceEndMs`.

Without an edit window (no `editWindow`), the panel is read-only: no playhead, no seek.

A pure module `apps/web/src/lib/analysis-time.ts` owns these conversions plus `toPercent(ms, durationMs)` for layout, and a `lineAt(lines, sourceMs)` helper that returns the lyric line whose range contains the instant. It has unit tests.

## Screen: "Análise" tab

Position: between "Narrativa" and "Renders" in the editor tabs.

### Empty and partial states

- No `audio`: "A análise de áudio ainda não terminou." Nothing else renders.
- `audio` but no `lyrics`: the lyric track shows "Sem letra: projeto instrumental ou letra ainda em processamento." The other tracks render normally.
- `lyrics` with zero lines: same message as no lyrics.

### Header

A `cluster` of pills and mono text:

- `120 bpm` (rounded), `03:42` (duration), `7 seções`.
- Lyric origin: "Letra do usuário", "Letra transcrita", or "Letra de fixture", followed by `modelo · versão` in muted mono.
- Analyzer name and version in muted mono.

### Chart

One `AnalysisPanel` component (`apps/web/src/components/AnalysisPanel.tsx`) renders a single inline SVG sized to the container width (`viewBox="0 0 1000 H"`, `preserveAspectRatio="none"`). Labels are SVG `<text>` elements with `vector-effect` unaffected: text is drawn inside a nested `<svg>` per track with `preserveAspectRatio="xMinYMid meet"` so glyphs never stretch. Four horizontal tracks share the x axis, x = `toPercent(ms, durationMs) * 1000`:

1. **Seções** (height 28): one rect per section, fill from a per-type palette using existing CSS variables, label in Portuguese (Intro, Verso, Refrão, Ponte, Final, Drop, Pausa) centered when the rect is wide enough, otherwise shown only in the hover title.
2. **Energia** (height 72): filled area from `energyCurve` (polyline closed to the baseline); downbeats as full-height thin lines at 60% opacity; beats as short ticks at the bottom with opacity `0.2 + 0.8 * strength`. When `beats` exceeds 2000 points, ticks are thinned by an even stride so no more than 2000 render.
3. **Letra** (height 40): one rounded rect per lyric line from `startMs` to `endMs`, text truncated with ellipsis inside, full text and `mm:ss` range on hover (`<title>`). Lines shorter than 1.5% of the width show no text.
4. **Régua** (height 18): tick every 10 seconds with `mm:ss` labels, every 30 seconds bold.

Overlays across all tracks:

- **Janela selecionada**: translucent rect from `sourceStartMs` to `sourceEndMs` with a 1px border in the accent color and labels `mm:ss` at both edges above the sections track. Absent without an edit window.
- **Playhead**: 2px vertical line at `toSource(playheadMs)`, only while `playheadMs !== null`. The lyric line containing that instant gets the selected style.

### Interaction

- Click anywhere on the chart: compute `sourceMs` from the click x. If an edit window exists and `sourceMs` is inside it, set `video.currentTime = toOutput(sourceMs) / 1000` on the existing `videoRef`. Outside the window, or with no preview, do nothing; the cursor is `not-allowed` outside the window and `pointer` inside.
- Hover: native `<title>` tooltips on sections and lyric lines. No custom tooltip component.
- Resize: the SVG scales with its container through `width: 100%`; no JS measurement.

### Wiring in the editor

- `Tab` union gains `'analise'`; the tab list gains `['analise', 'Análise']`.
- The tab body renders `<AnalysisPanel audio lyrics editWindow playheadMs onSeek />` where `onSeek(outputMs)` is defined in the page and writes to `videoRef.current.currentTime`.
- `playheadMs` is already tracked by the page; no new state.

## Labels

`apps/web/src/lib/labels.ts` gains `SECTION_LABEL` (the seven types above), `sectionLabel(type)` with raw fallback, and `LYRIC_SOURCE_LABEL` for `USER`, `TRANSCRIPT`, `FIXTURE`.

## Visual system

Same tokens as the rest of the Studio (`--panel`, `--rule`, `--tape`, `--cut`, `--fn-color` palette). Section colors come from a fixed map of the seven types onto existing hues so the same type is always the same color across projects. Text stays within the panel's mono/small styles; no new font sizes.

## Out of scope

- Zoom or horizontal scroll on the chart.
- Editing lyric timings or section boundaries.
- Word-level rendering (`words[]` stays unused).
- Showing narrative segments on this chart; the "Narrativa" tab keeps that.
- Any API or CLI change.

## Testing

- Unit tests for `analysis-time.ts`: `toPercent` clamps to `[0, 1]`; `toSource`/`toOutput` round-trip; `toOutput` returns `null` outside the window; `lineAt` returns the containing line, the first when ranges overlap, and `null` between lines.
- Beat thinning helper tested for the 2000-point cap and for preserving first and last beats.
- No component rendering tests, matching the rest of the Studio.
- Manual check: open a completed project, play the render, confirm the playhead moves across the chart and the current lyric line highlights; click inside the window and confirm the video seeks; click outside and confirm nothing happens.
