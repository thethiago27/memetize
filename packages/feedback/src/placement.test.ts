import { Timeline } from '@memetize/timeline';
import { describe, expect, it } from 'vitest';
import { toPlacedEvents } from './placement';

const timeline = Timeline.parse({
  projectId: 'prj_1',
  durationMs: 4000,
  audio: { path: 'storage/audio/prj_1/song.mp3', timelineStartMs: 0, sourceStartMs: 0 },
  clips: [
    {
      id: 'clp_1',
      momentId: 'mom_a',
      timeline: { startMs: 0, endMs: 2000 },
      source: { assetId: 'ast_1', startMs: 0, endMs: 2000 },
      reason: { segmentId: 'seg_1', semanticScore: 0.9, finalScore: 0.8 },
    },
    {
      id: 'clp_2',
      momentId: 'mom_b',
      timeline: { startMs: 2000, endMs: 4000 },
      source: { assetId: 'ast_2', startMs: 500, endMs: 2500 },
      reason: { segmentId: 'seg_missing', semanticScore: 0.7, finalScore: 0.6 },
    },
  ],
});

describe('toPlacedEvents', () => {
  it('emits one SYSTEM PLACED event per clip with the segment snapshot', () => {
    const events = toPlacedEvents({
      projectId: 'prj_1',
      timelineVersion: 3,
      timeline,
      segments: [
        {
          id: 'seg_1',
          startMs: 0,
          endMs: 2000,
          emotion: 'joy',
          narrativeFunction: 'setup',
          visualIdeas: ['cat'],
          energy: 0.4,
          lyrics: 'hello',
          meaning: 'greeting',
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'PLACED',
      source: 'SYSTEM',
      projectId: 'prj_1',
      timelineVersion: 3,
      clipId: 'clp_1',
      segmentId: 'seg_1',
      momentId: 'mom_a',
      assetId: 'ast_1',
      context: { narrativeFunction: 'setup', emotion: 'joy', visualIdeas: ['cat'] },
    });
    expect(events[1]?.context).toEqual({ segmentId: 'seg_missing' });
  });
});
