import { describe, expect, it } from 'vitest';
import {
  assetId,
  audioAnalysisId,
  embeddingId,
  jobId,
  lyricsId,
  matchId,
  momentId,
  narrativeId,
  prefixedId,
  projectId,
  sceneId,
  segmentId,
} from './ids';

describe('ids', () => {
  it('produces prefixed ids', () => {
    expect(assetId()).toMatch(/^ast_[0-9a-z]{21}$/);
    expect(sceneId()).toMatch(/^scn_[0-9a-z]{21}$/);
    expect(jobId()).toMatch(/^job_[0-9a-z]{21}$/);
    expect(momentId()).toMatch(/^mom_[0-9a-z]{21}$/);
    expect(segmentId()).toMatch(/^seg_[0-9a-z]{21}$/);
    expect(embeddingId()).toMatch(/^emb_[0-9a-z]{21}$/);
    expect(projectId()).toMatch(/^prj_[0-9a-z]{21}$/);
    expect(narrativeId()).toMatch(/^nar_[0-9a-z]{21}$/);
    expect(audioAnalysisId()).toMatch(/^aud_[0-9a-z]{21}$/);
    expect(lyricsId()).toMatch(/^lyr_[0-9a-z]{21}$/);
    expect(matchId()).toMatch(/^mat_[0-9a-z]{21}$/);
  });

  it('is collision-resistant across many ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => prefixedId('ast')));
    expect(ids.size).toBe(1000);
  });
});
