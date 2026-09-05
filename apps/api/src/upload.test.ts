import { describe, expect, it } from 'vitest';
import { uploadedDisplayName } from './upload';

describe('uploadedDisplayName (minor issue)', () => {
  it('keeps a clean filename', () => {
    expect(uploadedDisplayName('My Song.mp3')).toBe('My Song.mp3');
  });

  it('strips any leading path', () => {
    expect(uploadedDisplayName('/Users/me/clips/clip.mp4')).toBe('clip.mp4');
    expect(uploadedDisplayName('C:\\videos\\clip.mp4')).toBe('clip.mp4');
  });

  it('removes control characters', () => {
    expect(uploadedDisplayName('a\u0000b\u001f.mp3')).toBe('ab.mp3');
  });

  it('falls back to "upload" for degenerate names', () => {
    expect(uploadedDisplayName('')).toBe('upload');
    expect(uploadedDisplayName('..')).toBe('upload');
    expect(uploadedDisplayName('/')).toBe('upload');
  });
});
