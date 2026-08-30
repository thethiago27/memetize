import { describe, expect, it } from 'vitest';
import { DirectorInput, DirectorOutput, DirectorPick } from './director';

describe('director contracts', () => {
  it('parses a director input with just a projectId', () => {
    expect(DirectorInput.safeParse({ projectId: 'prj_1' }).success).toBe(true);
  });

  it('requires a positive version and a non-negative clip count', () => {
    expect(DirectorOutput.safeParse({ projectId: 'prj_1', version: 1, clipCount: 0 }).success).toBe(
      true,
    );
    expect(DirectorOutput.safeParse({ projectId: 'prj_1', version: 0, clipCount: 0 }).success).toBe(
      false,
    );
    expect(
      DirectorOutput.safeParse({ projectId: 'prj_1', version: 1, clipCount: -1 }).success,
    ).toBe(false);
  });

  it('parses a pick as a plain segmentId/momentId pair', () => {
    const result = DirectorPick.safeParse({ segmentId: 'nar_1', momentId: 'mom_1' });
    expect(result.success).toBe(true);
  });
});
