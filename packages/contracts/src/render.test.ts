import { describe, expect, it } from 'vitest';
import { RenderInput, RenderOutput, RenderValidation, RenderWarning } from './render';

describe('render contracts', () => {
  it('parses a render input with just a projectId', () => {
    expect(RenderInput.safeParse({ projectId: 'prj_1' }).success).toBe(true);
  });

  it('requires a positive version and a non-negative duration', () => {
    expect(
      RenderOutput.safeParse({
        projectId: 'prj_1',
        version: 1,
        path: 'storage/renders/prj_1/render_001.mp4',
        durationMs: 4000,
        warningCount: 0,
      }).success,
    ).toBe(true);
    expect(
      RenderOutput.safeParse({
        projectId: 'prj_1',
        version: 0,
        path: 'storage/renders/prj_1/render_001.mp4',
        durationMs: 4000,
        warningCount: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a warning with only its code', () => {
    expect(RenderWarning.safeParse({ code: 'EMPTY_TIMELINE' }).success).toBe(true);
  });

  it('rejects an unknown warning code', () => {
    expect(RenderWarning.safeParse({ code: 'NOT_A_CODE' }).success).toBe(false);
  });

  it('parses a validation result with a mix of warnings', () => {
    const result = RenderValidation.safeParse({
      valid: true,
      warnings: [
        { code: 'CLIP_TOO_SHORT', clipId: 'clp_1', durationMs: 210 },
        { code: 'TIMELINE_GAP', startMs: 0, endMs: 25560 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
