# Continuous Sixty-Second Video Implementation Plan

> **Note (2026-09-06).** Every task here shipped; the boxes were never ticked,
> so the plan read as untouched work. They are ticked now. The output window is
> **30 seconds**, not 60 — see the amendment at the top of the design document.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce a deterministic full-track-or-60-second edit with continuous visual coverage, beat-aligned hard cuts, correctly rebased audio, and no renderer-created black or frozen frames.

**Architecture:** Select and persist an edit window before narrative planning, normalize that window into continuous semantic spans, and resolve each span into duration-compatible catalog clips. Timing moves shared boundaries, strict validation rejects incomplete timelines, and FFmpeg only executes already-valid edits.

**Tech Stack:** TypeScript 5.9, Node.js 22, pnpm/Turborepo, Vitest, Zod, Drizzle/PostgreSQL, Fastify, Next.js/React, FFmpeg/ffprobe, existing Python audio analysis.

**Spec:** `docs/superpowers/specs/2026-08-30-continuous-sixty-second-video-design.md`

## Global Constraints

- Define and run a red-capable test before every production-code slice.
- Tracks of at most `60_000` ms use the complete source; longer tracks select exactly `60_000` ms.
- Store and compare all time values as integer milliseconds.
- New timelines must cover `[0, durationMs]` exactly with no overlap and no source-short clip.
- Keep hard cuts; do not add crossfades, looping, slow motion, generated filler, black filler, or cloned-frame padding.
- Use `asetpts=PTS-STARTPTS` after `atrim` for a cropped audio source.
- Add no external dependency. Any new internal workspace dependency must use the exact workspace version `workspace:0.0.0`.
- Keep the existing 1080x1920, 30 fps, H.264/AAC render contract.
- Work only on `fix/continuous-sixty-second-video`; do not push directly to `main`.
- Update `CHANGELOG.md` and `README.md` before opening a pull request.

---

## File Structure

### New planning module

- `packages/edit-planner/src/highlight.ts` — deterministic source-window candidate generation and scoring.
- `packages/edit-planner/src/highlight.test.ts` — public highlight-selection behavior.
- `packages/edit-planner/src/coverage.ts` — clipping, instrumental gap filling, and beat-aware span splitting.
- `packages/edit-planner/src/coverage.test.ts` — public continuous-coverage behavior.
- `packages/edit-planner/src/constants.ts` — duration, score-weight, and slot-duration constants.
- `packages/edit-planner/src/index.ts` — public exports only.
- `packages/edit-planner/package.json` and `tsconfig.json` — workspace package metadata with exact internal dependency pins.

### Persistence and contracts

- `packages/contracts/src/audio.ts` — `EditWindowSelection`, score breakdown, and narrative source-kind contracts.
- `packages/database/src/schema.ts` — append-only `edit_windows` table and narrative `source_kind` column.
- `packages/database/drizzle/0009_edit_windows.sql` and metadata snapshot — generated edit-window migration.
- `packages/database/drizzle/0010_narrative_source_kind.sql` and metadata snapshot — generated narrative source migration.
- `packages/projects/src/window.ts` — append/read edit-window versions.
- `packages/projects/src/window.integration.test.ts` — versioning and project isolation.
- `packages/shared/src/ids.ts` and `ids.test.ts` — `win_` IDs.

### Pipeline behavior

- `workers/narrative-analyzer/src/handler.ts` — window selection, persistence, window-scoped provider input, and coverage normalization.
- `packages/model-providers/src/types.ts`, `fixture.ts`, and tests — window-aware narrative provider contract.
- `packages/prompts/src/narrative.ts` — window-bounded narrative prompt version 2.
- `packages/clip-ranker/src/diversity.ts` and tests — avoid adjacent asset reuse without banning reuse for the whole video.
- `packages/contracts/src/match.ts` — six-candidate shortlist for coverage.
- `packages/director/src/coverage.ts` and tests — duration-compatible fallback and multi-clip resolution.
- `packages/director/src/assemble.ts` and tests — zero-based assembly from the selected source window.
- `workers/director/src/handler.ts` and tests/E2E expectations — fetch the window and all fallback moments, then fail an insufficient catalog before rendering.

### Timing and renderer

- `packages/timing/src/optimize.ts`, `types.ts`, and tests — shared-boundary snapping with source-capacity constraints.
- `workers/timing/src/handler.ts` — rebase beats to the selected window and supply moment bounds.
- `packages/renderer/src/validate-timeline.ts`, `types.ts`, and tests — strict coverage and source-duration errors.
- `packages/renderer/src/graph.ts`, `types.ts`, `constants.ts`, and tests — no black/tpad fallback; rebased audio and edge fades.
- `workers/renderer/src/handler.ts` — pass source-audio duration and record timing metrics.

### Product surface and verification

- `apps/api/src/routes/projects.ts` and `app.test.ts` — return latest edit-window metadata.
- `apps/web/src/lib/api.ts` and `app/projects/[id]/page.tsx` — show selected range, score reason, and failed-job guidance.
- `apps/cli/src/commands/project.ts` — expose the selected window in CLI inspection.
- `apps/cli/src/director.e2e.test.ts` and `renderer.e2e.test.ts` — continuous timeline, insufficient catalog, exact duration, black detection, and timestamp checks.
- `README.md` and `CHANGELOG.md` — required user-facing documentation.

---

### Task 1: Deterministic Highlight Selector

**Files:**

- Create: `packages/edit-planner/package.json`
- Create: `packages/edit-planner/tsconfig.json`
- Create: `packages/edit-planner/src/constants.ts`
- Create: `packages/edit-planner/src/highlight.ts`
- Create: `packages/edit-planner/src/highlight.test.ts`
- Create: `packages/edit-planner/src/index.ts`
- Modify: `packages/contracts/src/audio.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `AudioSection[]`, `BeatPoint[]`, `number[]` downbeats, `EnergyPoint[]`, and `LyricLine[]` from `@memetize/contracts`.
- Produces: `selectEditWindow(input: HighlightSelectionInput): EditWindowSelection`.
- Produces constants: `MAX_OUTPUT_DURATION_MS = 60_000`, score weights totaling `1`, `MIN_VISUAL_SLOT_MS = 1_000`, `MAX_VISUAL_SLOT_MS = 4_000`.

- [x] **Step 1: Write the failing public-seam tests**

```ts
import { describe, expect, it } from 'vitest';
import { selectEditWindow } from './highlight';

describe('selectEditWindow', () => {
  it('uses a 45-second source in full', () => {
    expect(selectEditWindow({
      trackDurationMs: 45_000,
      sections: [], beats: [], downbeats: [], energyCurve: [], lyrics: [],
    })).toMatchObject({ sourceStartMs: 0, sourceEndMs: 45_000, durationMs: 45_000 });
  });

  it('treats exactly 60 seconds as an uncropped full source', () => {
    const selected = selectEditWindow({
      trackDurationMs: 60_000,
      sections: [], beats: [], downbeats: [], energyCurve: [], lyrics: [],
    });
    expect(selected).toMatchObject({ sourceStartMs: 0, sourceEndMs: 60_000, durationMs: 60_000 });
  });

  it('selects the energetic chorus window from a 120-second source', () => {
    const selected = selectEditWindow({
      trackDurationMs: 120_000,
      sections: [
        { type: 'intro', startMs: 0, endMs: 60_000 },
        { type: 'chorus', startMs: 60_000, endMs: 120_000 },
      ],
      beats: [{ timeMs: 0, strength: 0.2 }, { timeMs: 60_000, strength: 1 }],
      downbeats: [0, 60_000],
      energyCurve: [{ timeMs: 0, value: 0.1 }, { timeMs: 60_000, value: 0.9 }],
      lyrics: [{ startMs: 61_000, endMs: 90_000, text: 'hook and payoff', words: [] }],
    });
    expect(selected.sourceStartMs).toBe(60_000);
    expect(selected.sourceEndMs).toBe(120_000);
  });

  it('falls back deterministically when optional analysis is empty', () => {
    const input = {
      trackDurationMs: 90_000,
      sections: [], beats: [], downbeats: [], energyCurve: [], lyrics: [],
    };
    expect(selectEditWindow(input)).toEqual(selectEditWindow(input));
    expect(selectEditWindow(input).sourceStartMs).toBe(0);
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/edit-planner/src/highlight.test.ts`

Expected: FAIL because `packages/edit-planner/src/highlight.ts` and `selectEditWindow` do not exist.

- [x] **Step 3: Add the contracts and exact constants**

Add to `packages/contracts/src/audio.ts`:

```ts
export const HighlightScoreBreakdown = z.object({
  section: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
  lyrics: z.number().min(0).max(1),
  narrativeArc: z.number().min(0).max(1),
  boundaries: z.number().min(0).max(1),
});
export type HighlightScoreBreakdown = z.infer<typeof HighlightScoreBreakdown>;

export const EditWindowSelection = z.object({
  sourceStartMs: z.number().int().nonnegative(),
  sourceEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  targetDurationMs: z.number().int().positive(),
  score: z.number().min(0).max(1),
  scoreBreakdown: HighlightScoreBreakdown,
  selector: z.string(),
  selectorVersion: z.string(),
});
export type EditWindowSelection = z.infer<typeof EditWindowSelection>;
```

Add to `packages/edit-planner/src/constants.ts`:

```ts
export const MAX_OUTPUT_DURATION_MS = 60_000;
export const MIN_VISUAL_SLOT_MS = 1_000;
export const MAX_VISUAL_SLOT_MS = 4_000;
export const HIGHLIGHT_SELECTOR = 'structural-highlight';
export const HIGHLIGHT_SELECTOR_VERSION = '1.0.0';
export const HIGHLIGHT_WEIGHTS = {
  section: 0.3,
  energy: 0.2,
  lyrics: 0.15,
  narrativeArc: 0.15,
  boundaries: 0.2,
} as const;
```

- [x] **Step 4: Implement candidate generation, normalized scoring, and deterministic tie-breaking**

Use this public shape in `highlight.ts`:

```ts
import type { AudioSection, BeatPoint, EditWindowSelection, EnergyPoint, LyricLine } from '@memetize/contracts';

export interface HighlightSelectionInput {
  trackDurationMs: number;
  sections: readonly AudioSection[];
  beats: readonly BeatPoint[];
  downbeats: readonly number[];
  energyCurve: readonly EnergyPoint[];
  lyrics: readonly LyricLine[];
}

export function selectEditWindow(input: HighlightSelectionInput): EditWindowSelection;
```

Implementation rules:

1. Reject non-positive or non-integer `trackDurationMs`.
2. Return the whole source immediately when duration is at most `60_000`.
3. Generate starts from `0`, `trackDurationMs - 60_000`, section starts, `section.endMs - 60_000`, downbeats, `downbeat - 60_000`, and lyric starts within 2,000 ms of a section/downbeat.
4. Clamp starts to `[0, trackDurationMs - 60_000]`, round to integer milliseconds, and deduplicate.
5. Score every component in `[0, 1]`. Give `chorus`, `payoff`, and `climax` section overlap full structural value; normalize mean energy; normalize covered lyric milliseconds; reward rising energy into the final third; reward exact downbeat/section boundaries and low boundary energy discontinuity.
6. Compute the weighted sum with `HIGHLIGHT_WEIGHTS` and round stored component/total values to six decimals.
7. Sort by total score descending and `sourceStartMs` ascending.

- [x] **Step 5: Add package metadata without a loose dependency**

```json
{
  "name": "@memetize/edit-planner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@memetize/contracts": "workspace:0.0.0" }
}
```

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` includes `packages/edit-planner` and no external package is added.

- [x] **Step 6: Run tests and typecheck GREEN**

Run: `pnpm exec vitest run packages/edit-planner/src/highlight.test.ts packages/contracts/src/audio.test.ts`

Run: `pnpm --filter @memetize/edit-planner typecheck`

Expected: all commands pass.

- [x] **Step 7: Commit the highlight slice**

```bash
git add packages/edit-planner packages/contracts/src/audio.ts pnpm-lock.yaml
git commit -m "feat: select deterministic sixty-second highlights"
```

---

### Task 2: Append-Only Edit Window Persistence

**Files:**

- Modify: `packages/shared/src/ids.ts`
- Modify: `packages/shared/src/ids.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/testing.ts`
- Create: `packages/database/drizzle/0009_edit_windows.sql`
- Create: `packages/database/drizzle/meta/0009_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `packages/projects/src/window.ts`
- Create: `packages/projects/src/window.integration.test.ts`
- Modify: `packages/projects/src/index.ts`

**Interfaces:**

- Consumes: `EditWindowSelection` from Task 1.
- Produces: `insertEditWindow(db, { projectId, selection })`, `getLatestEditWindow(db, projectId)`, and `listEditWindows(db, projectId)`.

- [x] **Step 1: Write the failing ID and persistence tests**

Add `editWindowId()` expectation to `ids.test.ts`:

```ts
expect(editWindowId()).toMatch(/^win_[0-9a-z]{21}$/);
```

Create the integration test with two inserts for one project and one insert for another:

```ts
async function seedProject(db: Database, id: string): Promise<void> {
  await db.insert(projects).values({ id, filename: 'song.mp3', status: 'PLANNING' });
}

function selection(sourceStartMs: number): EditWindowSelection {
  return {
    sourceStartMs,
    sourceEndMs: sourceStartMs + 60_000,
    durationMs: 60_000,
    targetDurationMs: 60_000,
    score: 0.8,
    scoreBreakdown: { section: 1, energy: 0.8, lyrics: 0.7, narrativeArc: 0.7, boundaries: 0.8 },
    selector: 'structural-highlight',
    selectorVersion: '1.0.0',
  };
}

await seedProject(db, 'prj_window_a');
await seedProject(db, 'prj_window_b');
const first = await insertEditWindow(db, { projectId: 'prj_window_a', selection: selection(0) });
const second = await insertEditWindow(db, { projectId: 'prj_window_a', selection: selection(30_000) });
const other = await insertEditWindow(db, { projectId: 'prj_window_b', selection: selection(0) });
expect([first.version, second.version, other.version]).toEqual([1, 2, 1]);
expect((await getLatestEditWindow(db, 'prj_window_a'))?.sourceStartMs).toBe(30_000);
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/shared/src/ids.test.ts packages/projects/src/window.integration.test.ts`

Expected: FAIL because the ID and repository functions do not exist. The database test may skip when `TEST_DATABASE_URL` is unavailable; the ID test must still fail.

- [x] **Step 3: Add the ID and database schema**

Add `win` to `IdPrefix` and export `editWindowId`.

Add this table shape to `schema.ts`:

```ts
export const editWindows = pgTable('edit_windows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  sourceStartMs: integer('source_start_ms').notNull(),
  sourceEndMs: integer('source_end_ms').notNull(),
  durationMs: integer('duration_ms').notNull(),
  targetDurationMs: integer('target_duration_ms').notNull(),
  score: real('score').notNull(),
  scoreBreakdown: jsonb('score_breakdown').$type<HighlightScoreBreakdown>().notNull(),
  selector: text('selector').notNull(),
  selectorVersion: text('selector_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('edit_windows_unique').on(table.projectId, table.version),
  index('edit_windows_project_idx').on(table.projectId),
]);
```

Export row types and include `edit_windows` in `truncateAll` before `projects`.

- [x] **Step 4: Generate and inspect migration 0009**

Run: `pnpm --filter @memetize/database db:generate -- --name edit_windows`

Expected: `0009_edit_windows.sql` creates the table, foreign key, unique index, and project index; the journal and snapshot advance exactly once.

Run: `rg -n "edit_windows|source_start_ms|edit_windows_unique" packages/database/drizzle/0009_edit_windows.sql`

Expected: all three patterns are present.

- [x] **Step 5: Implement append-only versioning**

Use the same transaction pattern as `insertTimelineVersion`:

```ts
export async function insertEditWindow(
  db: Database,
  params: { projectId: string; selection: EditWindowSelection },
): Promise<EditWindowRow> {
  return db.transaction(async (tx) => {
    const [latest] = await tx.select({ version: editWindows.version })
      .from(editWindows)
      .where(eq(editWindows.projectId, params.projectId))
      .orderBy(desc(editWindows.version))
      .limit(1);
    const [row] = await tx.insert(editWindows).values({
      id: editWindowId(),
      projectId: params.projectId,
      version: (latest?.version ?? 0) + 1,
      ...params.selection,
    }).returning();
    if (!row) throw new Error('failed to insert edit window');
    return row;
  });
}
```

- [x] **Step 6: Verify migration and repository GREEN**

Run: `pnpm db:migrate`

Run with test DB configured: `pnpm exec vitest run packages/shared/src/ids.test.ts packages/projects/src/window.integration.test.ts`

Expected: migration applies and tests pass.

- [x] **Step 7: Commit persistence**

```bash
git add packages/shared packages/database packages/projects/src/window.ts packages/projects/src/window.integration.test.ts packages/projects/src/index.ts
git commit -m "feat: persist selected edit windows"
```

---

### Task 3: Continuous Narrative Coverage Planner

**Files:**

- Modify: `packages/contracts/src/audio.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/projects/src/narrative.ts`
- Create: `packages/projects/src/narrative.integration.test.ts`
- Create: `packages/database/drizzle/0010_narrative_source_kind.sql`
- Create: `packages/database/drizzle/meta/0010_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `packages/edit-planner/src/coverage.ts`
- Create: `packages/edit-planner/src/coverage.test.ts`
- Modify: `packages/edit-planner/src/index.ts`

**Interfaces:**

- Consumes: selected absolute source window, provider narrative suggestions, audio sections, beats/downbeats, and energy curve.
- Produces: `planNarrativeCoverage(input: NarrativeCoverageInput): NarrativeSegment[]` whose ranges cover the source window exactly.

- [x] **Step 1: Write failing coverage tests**

```ts
it('fills lyric gaps with instrumental spans and covers the window exactly', () => {
  const result = planNarrativeCoverage({
    window: { sourceStartMs: 10_000, sourceEndMs: 16_000 },
    suggestions: [lyric(11_000, 13_000), lyric(14_000, 15_000)],
    sections: [{ type: 'chorus', startMs: 10_000, endMs: 16_000 }],
    beats: [10_000, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000],
    energyCurve: [{ timeMs: 10_000, value: 0.8 }],
  });
  expect(result[0]?.startMs).toBe(10_000);
  expect(result.at(-1)?.endMs).toBe(16_000);
  expect(result.some((segment) => segment.sourceKind === 'INSTRUMENTAL')).toBe(true);
  result.slice(1).forEach((segment, index) => {
    expect(result[index]?.endMs).toBe(segment.startMs);
  });
});

it('merges a terminal remainder shorter than one second', () => {
  const result = planNarrativeCoverage({
    window: { sourceStartMs: 0, sourceEndMs: 4_500 },
    suggestions: [],
    sections: [{ type: 'verse', startMs: 0, endMs: 4_500 }],
    beats: [0, 2_000, 4_000, 4_500],
    energyCurve: [],
  });
  expect(result.every((segment) => segment.endMs - segment.startMs >= 1_000)).toBe(true);
});
```

Define the fixture builder in the same test file:

```ts
function lyric(startMs: number, endMs: number): CoverageSuggestion {
  return {
    startMs,
    endMs,
    lyrics: 'fixture lyric',
    meaning: 'fixture meaning',
    emotion: 'neutral',
    narrativeFunction: 'verse',
    visualIdeas: ['reaction'],
    literalness: 0.5,
    ironyPotential: 0.5,
    energy: 0.5,
  };
}
```

- [x] **Step 2: Run the coverage test and verify RED**

Run: `pnpm exec vitest run packages/edit-planner/src/coverage.test.ts`

Expected: FAIL because `planNarrativeCoverage` does not exist.

- [x] **Step 3: Add narrative source kind to contracts and persistence**

```ts
export const NarrativeSourceKind = z.enum(['LYRIC', 'INSTRUMENTAL']);

export const NarrativeSegment = z.object({
  sourceKind: NarrativeSourceKind.default('LYRIC'),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  lyrics: z.string(),
  meaning: z.string(),
  emotion: z.string(),
  narrativeFunction: z.string(),
  visualIdeas: z.array(z.string()).default([]),
  literalness: z.number().min(0).max(1),
  ironyPotential: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
});
```

Add `sourceKind` to `narrative_segments`, `toNarrativeSegmentRows`, fixtures, and assertions. Generate the migration:

Run: `pnpm --filter @memetize/database db:generate -- --name narrative_source_kind`

Expected: `0010_narrative_source_kind.sql` adds a non-null text column with a safe default for historical rows and a check constraint for `LYRIC|INSTRUMENTAL`.

- [x] **Step 4: Implement deterministic normalization**

Implementation invariants in `coverage.ts`:

```ts
export interface NarrativeCoverageInput {
  window: { sourceStartMs: number; sourceEndMs: number };
  suggestions: readonly CoverageSuggestion[];
  sections: readonly AudioSection[];
  beats: readonly number[];
  energyCurve: readonly EnergyPoint[];
}

export type CoverageSuggestion = Omit<NarrativeSegment, 'sourceKind'>;
export function planNarrativeCoverage(input: NarrativeCoverageInput): NarrativeSegment[];
```

Use half-open source ranges. Clamp suggestions, sort them, trim overlaps by advancing the later start, synthesize instrumental spans for every uncovered interval, and split spans longer than `4_000` ms at the strongest available beat. If the last split would be below `1_000` ms, merge it into the previous split. For an entire window shorter than `1_000` ms, emit one full-window span. Instrumental spans use the containing section type for `narrativeFunction`, `instrumental <type>` for meaning, `[type, 'instrumental']` as visual ideas, and nearest energy with neutral emotional defaults.

- [x] **Step 5: Verify coverage and persistence GREEN**

Run: `pnpm exec vitest run packages/edit-planner/src/coverage.test.ts packages/projects/src/narrative.integration.test.ts`

Run: `pnpm --filter @memetize/edit-planner typecheck && pnpm --filter @memetize/projects typecheck`

Expected: all tests and typechecks pass.

- [x] **Step 6: Commit continuous narrative coverage**

```bash
git add packages/contracts packages/database packages/projects packages/edit-planner
git commit -m "feat: plan continuous narrative coverage"
```

---

### Task 4: Integrate Window Selection into Narrative Processing

**Files:**

- Modify: `packages/model-providers/src/types.ts`
- Modify: `packages/model-providers/src/fixture.ts`
- Modify: `packages/model-providers/src/fixture.test.ts`
- Modify: `packages/model-providers/src/gateway.test.ts`
- Modify: `packages/prompts/src/narrative.ts`
- Modify: `workers/narrative-analyzer/package.json`
- Modify: `workers/narrative-analyzer/src/handler.ts`
- Create: `workers/narrative-analyzer/src/handler.integration.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Task 1 selector, Task 2 persistence, Task 3 coverage planner.
- Changes `NarrativeAnalyzeInput` to include `sourceStartMs` and `sourceEndMs`; provider outputs remain in absolute source time.
- Produces a debug artifact containing `window`, raw provider spans, and normalized spans.

- [x] **Step 1: Write failing window-scoped provider and handler tests**

Add a fixture-provider test:

```ts
const result = await provider.analyzeNarrative({
  durationMs: 120_000,
  sourceStartMs: 60_000,
  sourceEndMs: 120_000,
  sections: [{ type: 'chorus', startMs: 60_000, endMs: 120_000 }],
  energyCurve: [{ timeMs: 60_000, value: 0.9 }],
  lyrics: [{ startMs: 61_000, endMs: 63_000, text: 'hook' }],
});
expect(result.segments).toEqual([
  expect.objectContaining({ startMs: 61_000, endMs: 63_000, lyrics: 'hook' }),
]);
```

The handler integration test seeds audio/lyrics, runs `NARRATIVE`, then asserts the latest edit window and exact narrative coverage:

```ts
const window = await getLatestEditWindow(db, projectId);
const segments = await listNarrativeSegments(db, projectId);

expect(window).toMatchObject({
  sourceStartMs: expectedSelection.sourceStartMs,
  sourceEndMs: expectedSelection.sourceEndMs,
  durationMs: expectedSelection.durationMs,
  version: 1,
});
expect(segments[0]?.startMs).toBe(window?.sourceStartMs);
expect(segments.at(-1)?.endMs).toBe(window?.sourceEndMs);
for (let index = 1; index < segments.length; index += 1) {
  expect(segments[index - 1]?.endMs).toBe(segments[index]?.startMs);
}
expect(segments.every((segment) => segment.endMs > segment.startMs)).toBe(true);
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/model-providers/src/fixture.test.ts workers/narrative-analyzer/src/handler.integration.test.ts`

Expected: FAIL because provider input lacks window fields and the handler does not persist/select a window.

- [x] **Step 3: Make the provider contract window-aware**

```ts
export interface NarrativeAnalyzeInput {
  durationMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  sections: AudioSectionRef[];
  energyCurve: EnergyPointRef[];
  lyrics: LyricLineRef[];
}
```

Update fixture and gateway tests to pass these fields. Bump `NARRATIVE_PROMPT_VERSION` to `v2` and explicitly require suggestions inside `[sourceStartMs, sourceEndMs]` with absolute source timestamps.

- [x] **Step 4: Integrate selection and coverage in the handler**

After loading audio and lyrics:

```ts
const selection = selectEditWindow({
  trackDurationMs: audio.durationMs,
  sections: audio.sections,
  beats: audio.beats,
  downbeats: audio.downbeats,
  energyCurve: audio.energyCurve,
  lyrics: lyricsRow.lines,
});
const window = await insertEditWindow(ctx.db, { projectId, selection });
```

Filter/clamp sections, energy points, and lyrics to the selected source interval before calling the provider. Pass raw provider output plus full structural context into `planNarrativeCoverage`, validate every normalized span, and persist only normalized spans. Include selection version and score breakdown in `narrative.json`.

Add the exact internal dependency:

```json
"@memetize/edit-planner": "workspace:0.0.0"
```

- [x] **Step 5: Verify the integrated narrative slice GREEN**

Run: `pnpm install --lockfile-only`

Run: `pnpm exec vitest run packages/model-providers/src/fixture.test.ts packages/model-providers/src/gateway.test.ts packages/edit-planner/src/coverage.test.ts workers/narrative-analyzer/src/handler.integration.test.ts`

Run: `pnpm --filter @memetize/narrative-analyzer typecheck`

Expected: window is persisted, provider input is bounded, and normalized spans exactly cover the window.

- [x] **Step 6: Commit narrative integration**

```bash
git add packages/model-providers packages/prompts workers/narrative-analyzer pnpm-lock.yaml
git commit -m "feat: scope narrative planning to selected window"
```

---

### Task 5: Coverage-Friendly Matching and Adjacent Diversity

**Files:**

- Modify: `packages/contracts/src/match.ts`
- Modify: `packages/contracts/src/match.test.ts`
- Modify: `packages/clip-ranker/src/diversity.ts`
- Modify: `packages/clip-ranker/src/diversity.test.ts`
- Modify: `workers/matching/src/handler.ts`

**Interfaces:**

- Consumes: continuous normalized narrative spans.
- Produces: up to six ranked/diversified candidates per span, allowing non-adjacent reuse while avoiding consecutive asset repetition.

- [x] **Step 1: Write failing adjacent-diversity tests**

Replace the global no-reuse assertion with this sequence:

```ts
function segment(segmentId: string, ranked: RankedCandidate[]): SegmentRankedInput {
  return { segmentId, narrativeFunction: 'setup', ranked };
}

const segments = [
  segment('nar_1', [candidate('mom_a1', 'ast_a', 0.9), candidate('mom_b1', 'ast_b', 0.8)]),
  segment('nar_2', [candidate('mom_a2', 'ast_a', 0.95), candidate('mom_b2', 'ast_b', 0.7)]),
  segment('nar_3', [candidate('mom_a3', 'ast_a', 0.99), candidate('mom_c3', 'ast_c', 0.6)]),
];
const result = diversify(segments, noMoments, 6);
expect(result.get('nar_2')?.[0]?.assetId).toBe('ast_b');
expect(result.get('nar_3')?.[0]?.assetId).toBe('ast_a');
```

Add a contract test that `SHORTLIST_LIMIT` equals `6`.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run packages/clip-ranker/src/diversity.test.ts packages/contracts/src/match.test.ts`

Expected: FAIL because reuse is currently banned across the complete project and the shortlist limit is three.

- [x] **Step 3: Restrict the hard diversity rule to adjacent spans**

Replace `usedAssetIds` as the hard skip with `lastAssetId`. Keep the existing category/subject penalties and `previouslyShortlisted` novelty signal. For a segment, first consider candidates whose asset differs from `lastAssetId`; relax with `same_asset_relaxed` only when no candidate survives. Set `SHORTLIST_LIMIT = 6`.

- [x] **Step 4: Add duration observability to matching debug output**

Include `segmentDurationMs` and each candidate's `momentDurationMs` in `match.json` debug entries. Do not filter short candidates here because the Director's Coverage Resolver needs them to tile a span.

> **Amended 2026-09-06 (F02).** `ensureCoverageCandidates` does now reorder at
> this stage: when the top slice holds no moment long enough to cover the
> segment, it swaps the lowest-scoring entries for the best covering ones,
> keeping the list `RANK_LIMIT` long. It still filters nothing out of the full
> ranking — short candidates remain available to tile — but the top slice is no
> longer purely score-ordered. This was the fix for a spurious
> `INSUFFICIENT_CATALOG` with a full catalog.

- [x] **Step 5: Verify matching GREEN**

Run: `pnpm exec vitest run packages/clip-ranker/src/diversity.test.ts packages/clip-ranker/src/rank.test.ts packages/contracts/src/match.test.ts apps/cli/src/matching.e2e.test.ts`

Run: `pnpm --filter @memetize/matching typecheck`

Expected: adjacent repetition is avoided, non-adjacent reuse remains available, and each shortlist can contain six candidates.

- [x] **Step 6: Commit matching changes**

```bash
git add packages/contracts packages/clip-ranker workers/matching
git commit -m "fix: keep enough diverse candidates for coverage"
```

---

### Task 6: Duration-Compatible Director Coverage Resolver

**Files:**

- Create: `packages/director/src/coverage.ts`
- Create: `packages/director/src/coverage.test.ts`
- Modify: `packages/director/package.json`
- Modify: `packages/director/src/assemble.ts`
- Modify: `packages/director/src/assemble.test.ts`
- Modify: `packages/director/src/index.ts`
- Modify: `workers/director/src/handler.ts`
- Modify: `workers/director/src/validate.test.ts`
- Modify: `packages/prompts/src/director.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: latest edit window, absolute narrative spans, model picks, ranked matches, candidate moment bounds, and absolute beat/downbeat points.
- Produces: `resolveCoverage(input): CoverageResolution` and a fully covered zero-based `Timeline`.
- Throws: `InsufficientCatalogError` with code `INSUFFICIENT_CATALOG`.

- [x] **Step 1: Write failing resolver tests**

```ts
it('tiles a three-second span with two short moments and no frozen tail', () => {
  const result = resolveCoverage({
    window: { sourceStartMs: 10_000, sourceEndMs: 13_000 },
    segments: [{ id: 'nar_1', startMs: 10_000, endMs: 13_000 }],
    picks: [{ segmentId: 'nar_1', momentId: 'mom_a' }],
    matches: matchMap('nar_1', ['mom_a', 'mom_b']),
    moments: new Map([
      ['mom_a', { assetId: 'ast_a', startMs: 0, endMs: 1_200, durationMs: 1_200 }],
      ['mom_b', { assetId: 'ast_b', startMs: 2_000, endMs: 3_800, durationMs: 1_800 }],
    ]),
    beats: [10_000, 11_200, 13_000],
  });
  expect(result.clips.map((clip) => clip.timeline)).toEqual([
    { startMs: 0, endMs: 1_200 },
    { startMs: 1_200, endMs: 3_000 },
  ]);
  expect(result.clips.every((clip) =>
    clip.source.endMs - clip.source.startMs === clip.timeline.endMs - clip.timeline.startMs,
  )).toBe(true);
});

it('uses the top eligible fallback when the provider omits a pick', () => {
  expect(resolveCoverage(fallbackFixture()).clips[0]?.momentId).toBe('mom_top');
});

it('throws when no moment can cover the minimum slot', () => {
  expect(() => resolveCoverage(insufficientFixture())).toThrow(InsufficientCatalogError);
});
```

Define the test builders in `coverage.test.ts` so every referenced fixture is executable:

```ts
function matchMap(segmentId: string, momentIds: string[]): Map<string, AssembleSegmentMatch> {
  const ranked = momentIds.map((momentId, index) => ({
    momentId,
    assetId: momentId.replace('mom_', 'ast_'),
    semanticScore: 1 - index * 0.1,
    emotionScore: 1,
    narrativeScore: 1,
    durationScore: 1,
    energyScore: 1,
    qualityScore: 1,
    noveltyScore: 1,
    usageScore: 1,
    finalScore: 1 - index * 0.1,
  }));
  return new Map([[segmentId, {
    ranked,
    shortlist: ranked.map(({ momentId, assetId, finalScore }) => ({
      momentId,
      assetId,
      finalScore,
      penalties: [],
    })),
  }]]);
}

function fallbackFixture(): ResolveCoverageInput {
  return {
    window: { sourceStartMs: 0, sourceEndMs: 1_000 },
    segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
    picks: [],
    matches: matchMap('nar_1', ['mom_top']),
    moments: new Map([
      ['mom_top', { assetId: 'ast_top', startMs: 0, endMs: 1_000, durationMs: 1_000 }],
    ]),
    beats: [0, 1_000],
  };
}

function insufficientFixture(): ResolveCoverageInput {
  return {
    window: { sourceStartMs: 0, sourceEndMs: 1_000 },
    segments: [{ id: 'nar_1', startMs: 0, endMs: 1_000 }],
    picks: [],
    matches: matchMap('nar_1', ['mom_short']),
    moments: new Map([
      ['mom_short', { assetId: 'ast_short', startMs: 0, endMs: 500, durationMs: 500 }],
    ]),
    beats: [0, 1_000],
  };
}
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/director/src/coverage.test.ts packages/director/src/assemble.test.ts`

Expected: FAIL because `resolveCoverage` and `InsufficientCatalogError` do not exist.

- [x] **Step 3: Implement deterministic tiling**

Use these exports:

```ts
export class InsufficientCatalogError extends Error {
  readonly code = 'INSUFFICIENT_CATALOG';
}

export interface CoverageResolution {
  clips: ResolvedCoverageClip[];
  decisions: CoverageDecision[];
}

export function resolveCoverage(input: ResolveCoverageInput): CoverageResolution;
```

For every segment in chronological order, place the provider's valid primary first, followed by shortlist score order, then remaining ranked score order. Use a moment at most once inside one segment. Prefer a candidate covering the full remainder. Otherwise split at the strongest interior beat that the candidate can reach while leaving either zero or at least `1_000` ms. If no beat qualifies, use the candidate duration only when the remainder rule still holds. Avoid `lastAssetId` when an eligible alternative exists. Extend the previous clip into unused source capacity to absorb a sub-minimum final remainder. Throw the structured error when coverage is impossible.

Add the exact internal dependency and refresh the lockfile:

```json
"@memetize/edit-planner": "workspace:0.0.0"
```

Run: `pnpm install --lockfile-only`

- [x] **Step 4: Make assembly source-window aware**

Change assembly inputs from `durationMs` to:

```ts
window: { sourceStartMs: number; sourceEndMs: number; durationMs: number };
beats: readonly number[];
```

Call `resolveCoverage`, subtract `window.sourceStartMs` from every absolute timeline boundary, set `timeline.durationMs = window.durationMs`, and set `audio.sourceStartMs = window.sourceStartMs`. Remove `Math.min(moment.durationMs, segmentDurationMs)` and never emit a source-short clip.

- [x] **Step 5: Integrate with the Director worker**

Load `getLatestEditWindow`; fail with `DIRECTOR_NO_WINDOW` when an old project has not been reprocessed from narrative. Fetch moments referenced by both `shortlist` and `ranked`, rebase audio beats only for assembly input, catch `InsufficientCatalogError`, set project status to `FAILED`, and throw `JobFailure('INSUFFICIENT_CATALOG', message, false)`. Add coverage decisions and edit-window version to `director.json`.

Bump `DIRECTOR_PROMPT_VERSION` to `v2`: the provider selects a primary candidate for every non-empty shortlist, while the deterministic resolver owns fallback and tiling.

- [x] **Step 6: Verify director GREEN**

Run: `pnpm exec vitest run packages/director/src/coverage.test.ts packages/director/src/assemble.test.ts workers/director/src/validate.test.ts`

Run: `pnpm --filter @memetize/director typecheck && pnpm --filter @memetize/director-worker typecheck`

Expected: complete coverage, equal source/slot durations, deterministic fallback, and structured insufficient-catalog failure.

- [x] **Step 7: Commit director coverage**

```bash
git add packages/director packages/prompts/src/director.ts workers/director pnpm-lock.yaml
git commit -m "fix: resolve every edit span into usable clips"
```

---

### Task 7: Shared-Boundary Timing

**Files:**

- Modify: `packages/timing/src/types.ts`
- Modify: `packages/timing/src/constants.ts`
- Modify: `packages/timing/src/optimize.ts`
- Modify: `packages/timing/src/optimize.test.ts`
- Modify: `workers/timing/src/handler.ts`

**Interfaces:**

- Consumes: zero-based beats, shared clip boundaries, and `momentId -> { startMs, endMs }` source bounds.
- Produces: a gap-free Timeline where each adjusted internal boundary is written to both neighboring clips.

- [x] **Step 1: Replace independent-movement expectations with failing shared-boundary tests**

```ts
it('snaps one shared cut without creating a gap', () => {
  const result = optimizeTiming(buildTimeline([
    buildClip('clp_a', { startMs: 0, endMs: 1_040 }),
    buildClip('clp_b', { startMs: 1_040, endMs: 2_000 }),
  ], 2_000), context({ beats: [{ timeMs: 1_000, strength: 1, isDownbeat: true }] }));
  expect(result.timeline.clips[0]?.timeline.endMs).toBe(1_000);
  expect(result.timeline.clips[1]?.timeline.startMs).toBe(1_000);
});

it('does not lengthen a source past its moment bound', () => {
  const result = optimizeTiming(sourceBoundFixture(), context({
    beats: [{ timeMs: 1_200, strength: 1, isDownbeat: true }],
    sourceBoundsByMomentId: new Map([
      ['mom_clp_a', { startMs: 0, endMs: 1_000 }],
      ['mom_clp_b', { startMs: 0, endMs: 1_000 }],
    ]),
  }));
  expect(result.adjustments[0]?.snappedTo).toBe('none');
});
```

Add this helper beside the existing `buildClip` and `buildTimeline` helpers:

```ts
function context(overrides: Partial<TimingContext> = {}): TimingContext {
  return {
    beats: [],
    segmentFunctionById: new Map(),
    sourceBoundsByMomentId: new Map([
      ['mom_clp_a', { startMs: 0, endMs: 4_000 }],
      ['mom_clp_b', { startMs: 0, endMs: 4_000 }],
    ]),
    ...overrides,
  };
}
```

Define the bounded fixture explicitly:

```ts
function sourceBoundFixture(): Timeline {
  return buildTimeline([
    buildClip('clp_a', { startMs: 0, endMs: 1_000 }, {
      source: { assetId: 'ast_a', startMs: 0, endMs: 1_000 },
    }),
    buildClip('clp_b', { startMs: 1_000, endMs: 2_000 }, {
      source: { assetId: 'ast_b', startMs: 0, endMs: 1_000 },
    }),
  ], 2_000);
}
```

- [x] **Step 2: Run timing tests and verify RED**

Run: `pnpm exec vitest run packages/timing/src/optimize.test.ts`

Expected: FAIL because the current optimizer moves whole clips independently.

- [x] **Step 3: Implement shared-boundary snapping**

Change context to include:

```ts
sourceBoundsByMomentId: ReadonlyMap<string, { startMs: number; endMs: number }>;
```

Add `MIN_TIMED_CLIP_MS = 1_000` to `packages/timing/src/constants.ts`. Iterate internal boundaries only. For a candidate target, calculate the previous and next durations after the move. Reject targets that create a duration below `MIN_TIMED_CLIP_MS`, exceed either moment's available duration from its selected source start, or leave source ranges out of bounds. On acceptance, write the target to both adjacent timeline ranges and resize their source end points to equal the new durations. Keep timeline `0` and `durationMs` fixed.

- [x] **Step 4: Rebase worker beats and load source bounds**

Use `sourceStartMs = sourceVersion.data.audio.sourceStartMs`. Convert only beats inside the selected source window:

```ts
const beats = mergeBeats(audio.beats, audio.downbeats)
  .filter((beat) => beat.timeMs >= sourceStartMs && beat.timeMs <= sourceEndMs)
  .map((beat) => ({ ...beat, timeMs: beat.timeMs - sourceStartMs }));
```

Query moment bounds for timeline moment IDs through `ctx.db.query.moments.findMany` and pass the map to the pure optimizer.

- [x] **Step 5: Verify timing GREEN**

Run: `pnpm exec vitest run packages/timing/src/beats.test.ts packages/timing/src/optimize.test.ts`

Run: `pnpm --filter @memetize/timing typecheck && pnpm --filter @memetize/timing-worker typecheck`

Expected: every adjacent pair shares one boundary and every source remains usable.

- [x] **Step 6: Commit shared timing**

```bash
git add packages/timing workers/timing
git commit -m "fix: snap shared clip boundaries to beats"
```

---

### Task 8: Strict Validation and Fallback-Free Rendering

**Files:**

- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/constants.ts`
- Modify: `packages/renderer/src/validate-timeline.ts`
- Modify: `packages/renderer/src/validate-timeline.test.ts`
- Modify: `packages/renderer/src/graph.ts`
- Modify: `packages/renderer/src/graph.test.ts`
- Modify: `workers/renderer/src/handler.ts`
- Modify: `apps/cli/src/renderer.e2e.test.ts`

**Interfaces:**

- Consumes: a fully covered Timeline and `ResolvedAssets` including `audioDurationMs`.
- Produces: FFmpeg graph without black/tpad fallback and debug performance metrics.
- Adds hard issue codes: `EMPTY_TIMELINE`, `TIMELINE_GAP`, and `SOURCE_SHORTER_THAN_SLOT`.

- [x] **Step 1: Change validator tests from warning to hard failure**

```ts
expect(validateTimeline(timeline({ durationMs: 3_000, clips: [] }))).toMatchObject({
  ok: false,
  errors: [expect.objectContaining({ code: 'EMPTY_TIMELINE' })],
});

expect(validateTimeline(gappedTimeline()).errors).toContainEqual(
  expect.objectContaining({ code: 'TIMELINE_GAP' }),
);

expect(validateTimeline(sourceShortTimeline()).errors).toContainEqual(
  expect.objectContaining({ code: 'SOURCE_SHORTER_THAN_SLOT', clipId: 'clp_1' }),
);
```

Change graph tests to assert:

```ts
expect(graph.filterComplex).not.toContain('color=c=black');
expect(graph.filterComplex).not.toContain('tpad=stop_mode=clone');
expect(graph.filterComplex).toContain(
  'atrim=start=30.000:duration=60.000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.120,afade=t=out:st=59.750:d=0.250',
);
```

- [x] **Step 2: Run renderer tests and verify RED**

Run: `pnpm exec vitest run packages/renderer/src/validate-timeline.test.ts packages/renderer/src/graph.test.ts`

Expected: FAIL because gaps/empty/source-short are warnings and the graph still creates black and clone padding.

- [x] **Step 3: Make validation strict**

Extend `TimelineIssue['code']`. Detect every positive initial, internal, or trailing gap. Move empty/source-short conditions from `warnings` into `errors`. Preserve historical `RenderWarningCode` values so existing JSON rows still parse.

- [x] **Step 4: Remove renderer fallbacks and rebase audio**

Add:

```ts
export const AUDIO_FADE_IN_MS = 120;
export const AUDIO_FADE_OUT_MS = 250;
```

Add `audioDurationMs: number` to `ResolvedAssets`. Throw from `buildFfmpegGraph` when `clips.length === 0`, when a gap is observed, or when a source is short; validation should normally catch these first.

Construct audio filters in this order:

```text
atrim=start=<sourceStart>:duration=<timelineDuration>,asetpts=PTS-STARTPTS,<conditional fades>,volume=<volume>
```

Use fade-in only when `sourceStartMs > 0`; fade-out only when `sourceStartMs + durationMs < audioDurationMs`. Keep three-decimal second formatting.

- [x] **Step 5: Add renderer wall-time metrics**

Measure with `performance.now()` around timeline validation, graph construction, FFmpeg, and output probing. Persist in `render.json`:

```ts
performance: {
  validationMs,
  graphBuildMs,
  ffmpegMs,
  probeMs,
  clipCount: timeline.clips.length,
  uniqueSourceCount: new Set(resolvedClips.map((clip) => clip.videoPath)).size,
}
```

Pass `projectAudio.durationMs` as `audioDurationMs`.

- [x] **Step 6: Replace empty-black E2E expectation**

The no-catalog pipeline must now fail at Director with `INSUFFICIENT_CATALOG`; it must create no render row and no MP4. Update the renderer E2E test accordingly.

- [x] **Step 7: Verify renderer GREEN**

Run: `pnpm exec vitest run packages/renderer/src/validate-timeline.test.ts packages/renderer/src/graph.test.ts packages/renderer/src/validate-output.test.ts`

Run: `pnpm --filter @memetize/renderer typecheck && pnpm --filter @memetize/renderer-worker typecheck`

Expected: strict tests pass and graph snapshots contain no fallback filters.

- [x] **Step 8: Commit validation and rendering**

```bash
git add packages/renderer workers/renderer apps/cli/src/renderer.e2e.test.ts
git commit -m "fix: reject incomplete timelines before rendering"
```

---

### Task 9: API, CLI, and Studio Visibility

**Files:**

- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/projects/[id]/page.tsx`
- Modify: `apps/cli/src/commands/project.ts`

**Interfaces:**

- Consumes: `getLatestEditWindow` and existing job error fields.
- Produces: `editWindow` in project detail/list responses and visible selection/failure information in CLI and web studio.

- [x] **Step 1: Write the failing API response test**

Seed an edit window, request the project, and assert:

```ts
expect(response.json().editWindow).toMatchObject({
  sourceStartMs: 30_000,
  sourceEndMs: 90_000,
  durationMs: 60_000,
  selector: 'structural-highlight',
  selectorVersion: '1.0.0',
});
```

- [x] **Step 2: Run API test and verify RED**

Run: `pnpm exec vitest run apps/api/src/app.test.ts`

Expected: FAIL because project responses omit `editWindow`.

- [x] **Step 3: Return edit-window metadata from API routes**

Fetch `getLatestEditWindow` in both list and detail endpoints. Detail returns the complete record; list returns `outputDurationMs`, `sourceStartMs`, and `sourceEndMs` for compact rendering.

- [x] **Step 4: Update web types and display**

Add exact `EditWindowRow` and job error fields in `apps/web/src/lib/api.ts`. In the project page, render a compact panel:

```tsx
{detail.editWindow ? (
  <section className="panel">
    <p className="kicker">Selected source window</p>
    <p className="mono">
      {formatTimecode(detail.editWindow.sourceStartMs)}–
      {formatTimecode(detail.editWindow.sourceEndMs)} · {formatTimecode(detail.editWindow.durationMs)}
    </p>
    <p className="mute">
      {detail.editWindow.selector} v{detail.editWindow.selectorVersion}
    </p>
  </section>
) : null}
```

For a failed job, show `errorCode` and `errorMessage`; special-case `INSUFFICIENT_CATALOG` with guidance to add more or longer source videos.

- [x] **Step 5: Add CLI inspection output**

Print selected absolute source range, output duration, selector/version, and total score immediately after audio analysis details.

- [x] **Step 6: Verify API and UI GREEN**

Run: `pnpm exec vitest run apps/api/src/app.test.ts`

Run: `pnpm --filter @memetize/api typecheck && pnpm --filter @memetize/web typecheck && pnpm --filter @memetize/web build`

Expected: API test, typechecks, and production web build pass.

- [x] **Step 7: Commit product visibility**

```bash
git add apps/api apps/web apps/cli/src/commands/project.ts
git commit -m "feat: show selected window and catalog failures"
```

---

### Task 10: End-to-End Regression, Performance Evidence, and Documentation

**Files:**

- Modify: `apps/cli/src/director.e2e.test.ts`
- Modify: `apps/cli/src/renderer.e2e.test.ts`
- Create: `README.md`
- Create: `CHANGELOG.md`

**Interfaces:**

- Verifies the complete public pipeline, real FFmpeg output, documentation, and performance evidence.
- Produces no new production interface.

- [x] **Step 1: Add moving fixtures and failing duration/coverage assertions**

Generate source videos with FFmpeg `testsrc2` rather than static colors:

```ts
await execFileAsync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${durationSeconds}`,
  '-pix_fmt', 'yuv420p', path,
]);
```

Add a short-track case and a 75-second long-track case. Assert:

```ts
expect(shortTimeline.data.durationMs).toBe(shortTrackDurationMs);
expect(longTimeline.data.durationMs).toBe(60_000);
expect(longTimeline.data.audio.sourceStartMs).toBeGreaterThanOrEqual(0);
assertContinuous(longTimeline.data);
```

`assertContinuous` checks first start `0`, every shared boundary, last end equals duration, and exact source/slot duration equality.

Define it in the E2E test:

```ts
function assertContinuous(timeline: Timeline): void {
  expect(timeline.clips.length).toBeGreaterThan(0);
  expect(timeline.clips[0]?.timeline.startMs).toBe(0);
  for (let index = 1; index < timeline.clips.length; index += 1) {
    expect(timeline.clips[index - 1]?.timeline.endMs).toBe(timeline.clips[index]?.timeline.startMs);
  }
  expect(timeline.clips.at(-1)?.timeline.endMs).toBe(timeline.durationMs);
  for (const clip of timeline.clips) {
    expect(clip.source.endMs - clip.source.startMs)
      .toBe(clip.timeline.endMs - clip.timeline.startMs);
  }
}
```

- [x] **Step 2: Run E2E tests and prove the duration assertion is red-capable**

Run with `TEST_DATABASE_URL` configured:

`pnpm exec vitest run apps/cli/src/director.e2e.test.ts apps/cli/src/renderer.e2e.test.ts`

Before the real run, temporarily change the long-track expectation from `60_000` to `59_999`, run the two tests, and confirm the long-track assertion fails. Restore `60_000` immediately and rerun. Expected after restoration: both suites pass if Tasks 1–9 are fully integrated; otherwise use the first real failure to close the missing integration and rerun its narrow test before these suites.

- [x] **Step 3: Add real output checks**

After rendering, run ffprobe and `blackdetect` through `execFileAsync`. Assert duration within 200 ms, video/audio `start_time` within one frame of zero, and no `black_start` output for the non-black moving fixtures. Assert the saved filter graph contains neither `color=c=black` nor `tpad=stop_mode=clone`.

- [x] **Step 4: Re-run the original artifact diagnostic**

Run:

```bash
jq -e '([.clips[]|(.timeline.endMs-.timeline.startMs)]|add//0) == .durationMs and all(.clips[]; (.source.endMs-.source.startMs) >= (.timeline.endMs-.timeline.startMs))' storage/cache/prj_aiu3rd27bizmr6q2k8ez7/timeline.json
```

Expected for the historical artifact: exit `1`, proving it remains a valid red-capable regression fixture. Reprocess that project from narrative, then run the same command against its newest `timeline.json`; expected exit `0`.

Reprocess command:

```bash
pnpm cli project reprocess prj_aiu3rd27bizmr6q2k8ez7 --from narrative
```

- [x] **Step 5: Capture performance evidence**

Record old artifact metrics (`172_251` ms, 27 clips, four unique sources) and the newly reprocessed/rendered `performance` block. Report selection, narrative, FFmpeg wall time, clip count, unique source count, and output duration. Do not add a timing threshold to CI. If repeated inputs remain dominant, record source-input deduplication as a measured follow-up instead of adding an unbenchmarked `split` graph.

- [x] **Step 6: Add README and changelog**

`README.md` must document prerequisites, setup, project/asset commands, the full-track-or-60-second policy, deterministic window selection, continuous-coverage guarantee, `INSUFFICIENT_CATALOG`, render output, and test commands.

`CHANGELOG.md` must include an `Unreleased` entry covering highlight selection, instrumental gap coverage, multi-clip resolution, shared timing, strict validation, audio timestamp rebasing, fade behavior, UI visibility, and measured performance.

- [x] **Step 7: Run the complete verification matrix**

Run:

```bash
pnpm exec vitest run
pnpm py:test
pnpm typecheck
pnpm lint
pnpm --filter @memetize/web build
```

Run affected E2E suites explicitly with the integration database:

```bash
pnpm exec vitest run apps/cli/src/matching.e2e.test.ts apps/cli/src/director.e2e.test.ts apps/cli/src/renderer.e2e.test.ts apps/api/src/app.test.ts
```

Expected: every command passes. If an environment prerequisite is absent, record the exact skipped command and missing prerequisite; do not claim it passed.

- [x] **Step 8: Run review and cleanup gates**

Invoke the `code-review` skill against the branch diff from `2156ed9`. Fix all correctness findings, rerun the narrow tests for each fix, then run:

```bash
rg -n '\[DEBUG-[^]]+\]' apps packages workers scripts
git diff --check
git status --short
```

Expected: no temporary debug markers, no whitespace errors, and only intended files changed.

- [x] **Step 9: Commit documentation and final verification changes**

```bash
git add apps/cli/src/director.e2e.test.ts apps/cli/src/renderer.e2e.test.ts README.md CHANGELOG.md
git commit -m "test: verify continuous sixty-second renders"
```

---

## Completion Evidence

Before declaring the work complete, include in the handoff:

- selected window for one short and one long track;
- timeline coverage/source-duration diagnostic output;
- ffprobe duration, resolution, frame rate, codecs, and start timestamps;
- `blackdetect` result for the moving E2E fixture;
- before/after render performance measurements;
- full verification command results;
- remaining measured performance opportunities;
- branch name and commit list;
- confirmation that README and changelog were updated.
