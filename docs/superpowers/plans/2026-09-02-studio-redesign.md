# Studio Redesign Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-02-studio-redesign-design.md`

## Constraints

- No new dependency; React 19, Next 15, plain CSS.
- Portuguese labels everywhere in `apps/web`.
- API changes are additive (`moments` projection).

## Tasks

- [ ] **Task 1: API projection.** `moments` map on project detail with description, asset filename, nearest frame thumbnail. Test in `app.test.ts`.
- [ ] **Task 2: Web foundation.** `lib/labels.ts` (status and function labels, colors), `components/Toast.tsx` provider, `components/StatusPill.tsx`, new `globals.css` tokens and component classes, nav and layout in Portuguese, `/projects` redirect.
- [ ] **Task 3: Projetos home.** Cards grid, "Novo projeto" dialog, empty state, polling.
- [ ] **Task 4: Editor.** Header with actions and rating, stepper from jobs, preview + timeline strip with seek and playhead highlight, inspector with segment, current moment, candidates, tabs (Narrativa, Renders, Memória, Jobs).
- [ ] **Task 5: Biblioteca and asset page.** Dropzone upload, cards grid, asset header with ban toggle, scene frames, moments with thumbnails.
- [ ] **Task 6: Verification and docs.** Build, typecheck, lint, README note, CHANGELOG entry.
