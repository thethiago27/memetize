# Translated subtitles burned into the render

**Date:** 2026-09-05  
**Status:** Approved for planning  
**Branch:** `feat/translated-subtitles`

## Objective

Every rendered MP4 whose project has lyrics carries the lyrics translated to Brazilian Portuguese, burned into the picture as bottom-third captions timed to the original lines. Instrumental projects (zero lyric lines) render exactly as today.

Decisions taken during brainstorming:

- Only the translation is shown, never the original alongside it.
- Target language is fixed: `pt-BR`. No per-project or environment configuration.
- Subtitles are always on when lyrics exist. There is no toggle.
- When the lyrics are already in Portuguese, or when the LLM provider is the fixture, the original lines are shown as they are. The video is always captioned when there are lyrics; the result records whether a translation actually happened.
- Translation runs as its own pipeline step. The renderer keeps its rule of touching FFmpeg only, never a model provider.
- Text is rasterized to PNG in Node and composited with FFmpeg's `overlay` filter. The local FFmpeg (Homebrew 9.0.1) has neither `libass`, `freetype` nor `drawtext`, and the output must be identical on any machine and in CI.

## Pipeline

A new job type `SUBTITLES` runs after `LYRICS`, in parallel with `NARRATIVE`, and never blocks anything downstream. `RENDER` reads its persisted result.

```
AUDIO_ANALYZE ─┐
LYRICS ────────┼─► NARRATIVE ─► MATCH ─► DIRECTOR ─► TIMING ─► EFFECTS   (unchanged)
               └─► SUBTITLES ─────────────────────────────────────────► RENDER reads `subtitles`
```

- `evaluateBarriers` in `@memetize/runtime` enqueues `SUBTITLES` when a `LYRICS` job completes, inside the same publication transaction that evaluates the NARRATIVE barrier, with the completing job's `generationId` and `stepKey = stepKeyFor('SUBTITLES')`. The enqueue is idempotent per (entity, generation, step), like NARRATIVE.
- Registry: resource class `CPU_LIGHT` (one LLM call, like NARRATIVE), worker version `1.0.0`.
- `REPROCESS_STAGES` gains `subtitles`. `STAGE_JOBS`:
  - `lyrics` also supersedes `SUBTITLES`.
  - `subtitles: ['SUBTITLES', 'RENDER']`. Pending jobs of those types become CANCELLED; `subtitles` rows and `timeline_versions` are never dropped.
  - `audio` is unchanged: audio analysis does not affect the lyrics.
- `renderProject` treats `SUBTITLES` as a stage job: a RUNNING one answers `409 PROJECT_BUSY`, as for other stages.
- Render before subtitles exist: when the project's `lyrics` row has at least one line and no `subtitles` row exists, the RENDER job fails with `JobFailure('RENDER_SUBTITLES_MISSING', …, false)` whose message tells the user to wait for `SUBTITLES` or run `project reprocess <id> --from subtitles`. Silently rendering without captions is never an option. In practice the translation finishes long before `EFFECTS`.

## Worker: `workers/subtitles` (`@memetize/subtitles`)

Handler `createSubtitlesHandler()`:

1. Parse `SubtitlesInput`; invalid payload throws `JobFailure('INVALID_INPUT', …, false)`.
2. Load the project's `lyrics` row via `getLyrics`. Missing row is `JobFailure('SUBTITLES_NO_LYRICS', …, false)`.
3. Zero lines: persist a `subtitles` row with `lines = []`, `translated = false`, `sourceLanguage = null`, `model = 'none'`, `modelVersion = '1.0.0'`, and return. No provider call.
4. Otherwise obtain `{ llm }` from `createProviders(ctx.config)` (as the NARRATIVE handler does) and call `llm.translateLyrics({ lines: texts, targetLanguage: 'pt-BR' })`.
5. Guard: the provider must return exactly one output line per input line. A mismatch throws `JobFailure('SUBTITLES_INVALID_OUTPUT', …, true)` so the job system retries. The gateway provider already retries once internally before surfacing the error.
6. Persist with `replaceSubtitles`: in one transaction, delete every `subtitles` row of the project and insert the new one, so a project has exactly one current row (simpler than `replaceLyrics`, which keys on source/model, because the renderer must never have to choose between rows). Each persisted line keeps the source line's `startMs`/`endMs` (song time) and the translated `text`, trimmed. Lines whose translated text is empty after trimming keep the original text, so a dropped line never appears as a blank gap.
7. Write a debug snapshot `subtitles.json` next to `lyrics.json` in the project debug directory.

Constant `SUBTITLE_TARGET_LANGUAGE = 'pt-BR'` lives in the worker.

## Contracts (`@memetize/contracts`, `audio.ts`, `enums.ts`)

```ts
JobType: + 'SUBTITLES'

SubtitlesInput = { projectId: string; generationId?: string }

SubtitleLine = { startMs: int >= 0; endMs: int >= 0; text: string }

SubtitlesOutput = {
  projectId: string;
  language: string;          // 'pt-BR'
  sourceLanguage: string | null;
  translated: boolean;
  lineCount: int >= 0;
  model: string;
  modelVersion: string;
}
```

## Model provider (`@memetize/model-providers`, `@memetize/prompts`, `@memetize/shared`)

`LLMProvider` gains:

```ts
translateLyrics(input: {
  lines: string[];
  targetLanguage: string;
}): Promise<{
  lines: string[];            // same length and order as input
  sourceLanguage: string;     // BCP-47-ish tag the model detected, or 'und'
  translated: boolean;        // false when source already is the target language
  model: string;
  modelVersion: string;
  promptVersion: string;
}>
```

- `LLM_STAGES` gains `'subtitles'`; `LLM_SUBTITLES_MODEL` overrides the model for this stage and falls back to `LLM_MODEL`. `.env.example` and the README's provider section document it.
- `GatewayLLMProvider.translateLyrics` uses `generateObject` with schema `{ sourceLanguage: string, alreadyTargetLanguage: boolean, lines: string[] }` and the prompt from `packages/prompts/src/subtitles.ts` (`SUBTITLES_PROMPT_VERSION = '1.0.0'`). The prompt asks for a natural, singable-length translation line by line, keeping line count and order, keeping proper nouns, and returning the lines unchanged with `alreadyTargetLanguage = true` when the lyrics already are in the target language. When the object has the wrong number of lines the provider retries once, then throws. `translated = !alreadyTargetLanguage`. `model`/`modelVersion` follow the existing `gatewayModelVersion` convention.
- `FixtureLLMProvider.translateLyrics` returns the input lines unchanged, `sourceLanguage = 'und'`, `translated = false`, `model = 'fixture'`, `modelVersion = '1.0.0'`.
- `PROVIDER_MODE=production` already refuses a fixture LLM; nothing new is needed.

## Database (`@memetize/database`, migration `0016_subtitles.sql`)

```
subtitles
  id               text primary key
  project_id       text not null references projects(id) on delete cascade
  language         text not null
  source_language  text
  translated       boolean not null default false
  lines            jsonb not null default '[]'   -- SubtitleLine[]
  model            text not null
  model_version    text not null
  created_at       timestamptz not null default now()

index subtitles_project_idx (project_id)
```

Additive migration, no backfill. Projects created before it have no `subtitles` row; their next render fails with `RENDER_SUBTITLES_MISSING` until `reprocess --from subtitles` runs, which the error message says. `deleteProject` needs no change (cascade).

`@memetize/projects` gains `subtitles.ts` with `replaceSubtitles`, `getSubtitles`, and `subtitlesDebugFile`.

## Renderer (`@memetize/renderer`, new module `src/subtitles/`)

Three units, each pure or testable without FFmpeg:

### `cuesFromLyrics(lines: SubtitleLine[], timeline: Timeline): SubtitleCue[]`

Maps song time to timeline time: `t' = t - audio.sourceStartMs + audio.timelineStartMs`. Clamps each cue to `[0, timeline.durationMs]`, drops cues entirely outside the window, drops cues shorter than one frame after clamping, and drops cues whose text is empty after trimming. When consecutive lines overlap, the earlier cue ends where the next one starts. Output is sorted by `startMs`.

### `layoutCue(text, canvas, style): CueLayout`

Wraps text into at most `MAX_LINES = 3` lines by measuring with `@napi-rs/canvas` and the bundled font. If three lines still exceed the maximum width, the font size is reduced proportionally down to `MIN_FONT_SCALE = 0.6` of the base size; beyond that the longest words are hard-wrapped. Returns the lines, the font size, and the image width and height.

Style constants (`subtitles/constants.ts`), fixed, no configuration:

| Constant | Value | Meaning |
| --- | --- | --- |
| `FONT_FAMILY` | `Inter` | bundled `packages/renderer/assets/fonts/Inter-Bold.ttf` (SIL OFL 1.1, license file alongside) |
| `FONT_SIZE_RATIO` | `0.025` | base font size as a fraction of canvas height (48 px at 1080×1920) |
| `MAX_WIDTH_RATIO` | `0.84` | text block width as a fraction of canvas width |
| `BASELINE_RATIO` | `0.78` | bottom edge of the block as a fraction of canvas height, above TikTok/Reels UI |
| `LINE_HEIGHT` | `1.2` | line height factor |
| `OUTLINE_RATIO` | `0.08` | outline width as a fraction of font size |
| fill / outline / shadow | white / black / black at 45% alpha, offset 0 / +2 px, blur 6 px | |

### `rasterizeCue(layout): Buffer`

Draws the laid-out lines centered on a transparent canvas of the layout's size (outline first, then fill, with the shadow) and returns PNG bytes. The renderer worker writes one PNG per cue under `target.directory/subtitles/cue-<index>.png`; the directory is already removed by `discardAttempt`, so nothing new needs cleanup.

### Graph

`buildFfmpegGraph(timeline, assets, options?: { subtitles?: RenderedCue[] })` where `RenderedCue = { pngPath, startMs, endMs, width, height }`.

- Without cues the graph is byte-identical to today; every existing graph test keeps passing unchanged.
- With cues: the segment join emits `[vjoin]` instead of `[vout]`. Each PNG is appended to `inputs` as `{ path, kind: 'image' }` (`toFfmpegArgs` emits it as a plain `-i`; `overlay`'s default `repeatlast=1` holds a single-frame image for the whole output). The chain is

  ```
  [vjoin][N]overlay=x=(W-w)/2:y=<canvasHeight*BASELINE_RATIO - height>:enable='between(t,<start>,<end>)'[vs0];
  [vs0][N+1]overlay=…[vs1]; … ; last label renamed to [vout]
  ```

  with `start`/`end` in seconds at millisecond precision (`toSeconds`). Cues are contiguous per index, so no two overlays are enabled at the same instant.
- `RENDERER_VERSION` bumps to `1.1.0`: the same timeline now produces a different picture.

### Worker (`workers/renderer`)

After resolving assets: load `getLyrics` and `getSubtitles`. If lyrics have lines and no subtitles row exists, fail `RENDER_SUBTITLES_MISSING`. Otherwise compute cues, lay out and rasterize each one into the attempt directory, and pass them to `buildFfmpegGraph`. The debug file gains `subtitles: { lineCount, cueCount, translated, model }`. Timeout and validation are unchanged.

## API, CLI, Studio

- `GET /v1/projects/:id` and `pnpm cli project inspect` gain `subtitles: { language, sourceLanguage, translated, lineCount, model, modelVersion } | null`. `GET /v1/projects` is unchanged.
- `pnpm cli project reprocess <id> --from subtitles` is accepted.
- Studio: `labels.ts` maps `SUBTITLES` to `Legendas` in the job labels and pipeline steps, so the Stepper and Jobs tab show the step. The Análise or Renders panel shows one line: `Legendas: traduzidas de <sourceLanguage> · <n> linhas` or `Legendas: letra original (já em português / provedor fixture)`. No other UI changes. The storyboard preview does not draw captions; the rendered-video preview shows them by nature.

## Errors

| Code | Where | Retryable |
| --- | --- | --- |
| `SUBTITLES_NO_LYRICS` | SUBTITLES handler, project has no `lyrics` row | no |
| `SUBTITLES_INVALID_OUTPUT` | SUBTITLES handler, line count mismatch after provider retry | yes |
| `RENDER_SUBTITLES_MISSING` | RENDER handler, lyrics present but no `subtitles` row | no |

Provider transport failures surface as they do for NARRATIVE. A terminal SUBTITLES failure marks the project FAILED only when its generation is still active (existing `propagateEntityFailure`).

## Testing

- `packages/renderer`: unit tests for `cuesFromLyrics` (window offset, clamping, dropping, overlap trimming, sub-frame cues), `layoutCue` (wrapping, shrink, hard wrap of an overlong word, deterministic dimensions), `rasterizeCue` (valid PNG of the layout's dimensions), and `buildFfmpegGraph` with cues (input order, `[vjoin]` rename, `enable` expressions, final `[vout]`) plus a case proving no cues yields the current graph.
- `packages/model-providers`: fixture passthrough; gateway with mocked `generateObject` for translation, already-Portuguese, and count mismatch (one retry, then throws).
- `workers/subtitles` integration: persists and replaces; instrumental project persists an empty row without calling the provider; count mismatch surfaces as a retryable failure.
- `packages/projects` integration: LYRICS completion enqueues SUBTITLES once per generation; `reprocess --from lyrics` and `--from subtitles` cancel the right pending jobs; `renderProject` is busy while SUBTITLES runs.
- `apps/cli` render E2E: a project with lyrics renders a valid MP4; a frame sampled with `ffmpeg -ss` inside a cue's interval differs in the caption region from the same render of an instrumental project; a project with lyrics and no `subtitles` row fails with `RENDER_SUBTITLES_MISSING`.
- CI needs nothing new: `@napi-rs/canvas` ships prebuilt binaries for Linux x64 and macOS arm64.

## Documentation

README: `SUBTITLES` in the pipeline description, `LLM_SUBTITLES_MODEL` in the provider section, `--from subtitles` in the reprocess stages, and the upgrade note for pre-existing projects. CHANGELOG entry.

## Non-goals

Configurable target language or style, original plus translation, per-word (karaoke) timing, captions in the Studio storyboard preview, soft subtitle tracks, editing translated lines in the Studio.

## Acceptance criteria

- A project with non-Portuguese lyrics renders with Portuguese captions timed to the original lines; `project inspect` shows `translated: true` and the model.
- A project with Portuguese lyrics, or any project under the fixture LLM, renders with the original lines as captions and `translated: false`.
- An instrumental project renders exactly as before this change.
- `reprocess --from subtitles` re-translates and re-renders without touching the timeline.
- All existing renderer graph tests pass unchanged.
