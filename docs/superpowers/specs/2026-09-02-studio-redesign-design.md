# Studio redesign

**Date:** 2026-09-02  
**Status:** Approved for planning  
**Branch:** `feat/studio-redesign`

## Objective

Make the Studio usable by someone who did not build it: plain Portuguese labels, one obvious next action per screen, a project editor that looks and behaves like a timeline, and human-readable clips and candidates instead of ids and scores.

The API, the pipeline, and the editorial-memory model do not change in behavior. The API grows one read-only projection so the editor can show descriptions and thumbnails.

## Problems being fixed

1. Film jargon ("bin", "slate", "print", "gate", "motor", "cue") hides what things are.
2. The project page is a flat stack of equally weighted panels; the primary actions sit inside a side panel.
3. The timeline is a vertical list of ids and timecodes with no link to the preview.
4. Clips and candidates are identified by `mom_...` ids and scores.
5. Pipeline state is a raw status string plus job chips; nothing says what happens next.
6. Feedback actions give no confirmation.
7. The home page is the asset library; creating a project is a loose form on a list page.

## Information architecture

| Route | Purpose |
| --- | --- |
| `/` | Projetos: cards for every project and the "Novo projeto" dialog. |
| `/projects` | Redirects to `/`. |
| `/projects/[id]` | Editor: header with actions, pipeline stepper, preview + timeline strip, inspector, tabs. |
| `/library` | Biblioteca: asset cards with thumbnails and an upload dropzone. |
| `/assets/[id]` | Asset detail: header with ban toggle, scenes with frames, moments. |

Navigation: "Projetos" and "Biblioteca", plus the API lamp ("API online" / "API offline").

Language: Portuguese for every label, empty state, error hint, and toast. Domain nouns keep their English name where the code and CLI use them as identifiers (timeline, render, match, job), always alongside a Portuguese explanation on first use in a screen.

## API projection

`GET /v1/projects/:id` gains `moments`: a map keyed by moment id covering every moment referenced by the timeline clips and by every shortlist. Each entry:

```ts
{
  id, assetId, assetFilename,
  description, primaryEmotion,
  startMs, endMs, durationMs,
  thumbnailPath: string | null   // scene frame nearest the moment start, else the asset thumbnail
}
```

`GET /v1/assets/:id` already returns scenes with `frames`; the asset page uses them.

## Screens

### Projetos (`/`)

- Header: "Projetos", one primary button "Novo projeto".
- Cards in a responsive grid: filename, status pill, source duration, selected window, timeline and render versions, last render thumbnail when a render exists (the `<video>` poster is not available, so the card shows a 9:16 placeholder with the render version).
- Status pills map `ProjectStatus` to Portuguese: Criado, Analisando áudio, Planejando, Timeline pronta, Renderizando, Concluído, Falhou. Active states pulse.
- "Novo projeto" opens a dialog: audio file (required), lyrics file (optional), "Criar". On success navigate to the editor.
- Empty state: "Nenhum projeto ainda. Crie um a partir de uma música."

### Editor (`/projects/[id]`)

Header

- Back link "Projetos", filename as title, status pill, meta line (duration, bpm, timeline vN, render vN).
- Right side: "Gerar timeline" (secondary), "Renderizar" (primary), and a 1 to 5 rating control labelled "Avaliar corte" enabled when a timeline exists. The current rating is highlighted.
- When the latest timeline is newer than the latest render: an inline notice "A timeline mudou depois do último render. Renderize para ver a troca."

Stepper

- Steps in order: Áudio, Letra, Narrativa, Match, Direção, Timing, Efeitos, Render.
- Each step derives its state from the project's jobs: concluído, em execução, na fila, falhou, ou pendente. A failed step shows the error code and message; `INSUFFICIENT_CATALOG` adds the guidance "Adicione mais vídeos ou vídeos mais longos à biblioteca e gere a timeline de novo."
- The selected source window shows under the stepper: range, output duration, selector and score.

Editor body: two columns on wide screens, stacked under 960px.

- Left: the 9:16 preview (`<video>` of the latest render, or an empty state "Ainda não há render") and below it the timeline strip.
  - The strip is a horizontal row; each clip's width is proportional to its duration with a minimum width; the clip shows the moment thumbnail as background, a colored top bar by narrative function, and the timecode on hover (`title`).
  - Clicking a clip selects it and seeks the video to the clip start. While the video plays, the clip under the playhead is highlighted.
  - Narrative function colors: setup, escalation, payoff/punchline/climax, and other, each with a fixed hue; a legend under the strip names them.
- Right: the inspector for the selected clip.
  - "Segmento": function and emotion pills, timecode range, lyrics in quotes, meaning.
  - "Momento atual": thumbnail, description, asset filename, source range, score. Buttons "Funcionou" (`CLIP_UP`) and "Não funcionou" (`CLIP_DOWN`).
  - "Candidatos": cards with thumbnail, description, asset filename, score; buttons "Usar" (swap) and "Banir". The current moment is marked "Em uso". Empty: "Sem candidatos para este segmento."
  - No selection: "Selecione um clipe na timeline."

Tabs below the editor

- "Narrativa": segment rows with function, emotion, timecode, lyrics, meaning, energy.
- "Renders": version, timeline version, resolution, warnings, link to the file.
- "Memória editorial": note input with "Adicionar nota" and the event list in Portuguese ("Trocou X por Y como payoff", "Avaliou v3 com 4/5", "Nota: ...").
- "Jobs": type, status, error.

### Biblioteca (`/library`)

- Header "Biblioteca" and a dropzone "Arraste um vídeo ou clique para escolher" that also accepts click-to-browse; uploads immediately and shows a toast.
- Cards grid: thumbnail (or placeholder), filename, status pill (Ingerido, Normalizando, Analisando, Indexando, Pronto, Falhou), duration, "Banido" tag when banned. Cards link to the asset page.
- The list polls while any asset is not terminal.

### Asset (`/assets/[id]`)

- Header: thumbnail, filename, status pill, duration and resolution, "Banir asset" / "Reativar asset".
- "Cenas": for each scene, the extracted frames as a small strip with timecodes.
- "Momentos": rows with the nearest frame, description, range, and "Banido" tag.

## Feedback and toasts

A `ToastProvider` in the layout. Every mutating action shows a toast: "Avaliação salva", "Clipe marcado como funcionou", "Clipe trocado. Gere um render para ver.", "Momento banido", "Asset reativado", "Nota adicionada", "Timeline sendo gerada", "Render iniciado". Errors show the API message in a red toast. Buttons show busy text while a request is in flight.

## Visual system

Keep the dark editing-bay palette (bay, panel, amber, tape, cut) and the three fonts. Add tokens for radius, elevation, pill colors per status, and the four narrative hues. Replace the film-frame preview border with a plain rounded 9:16 frame. Panels get titles as section headings instead of mono kickers. Buttons come in primary (amber fill), secondary (amber outline), danger (cut outline), and ghost.

## Out of scope

Drag to reorder clips, trimming, multiple selection, keyboard shortcuts, dark/light theme switch, mobile-specific layouts beyond the single-column fallback.

## Testing

- `pnpm --filter @memetize/web build` and `pnpm typecheck` pass.
- API test for the `moments` projection in `apps/api/src/app.test.ts`.
- Manual walkthrough on the running Studio: create a project, open the editor, select clips, swap, rate, ban, add a note, render.
