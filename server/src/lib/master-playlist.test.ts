import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { planRenditions } from './ladder';
import { buildMasterPlaylist, codecString } from './master-playlist';

describe('codecString', () => {
  it('maps levels to avc1 codec ids', () => {
    expect(codecString('4.0', true)).toBe('avc1.640028,mp4a.40.2');
    expect(codecString('3.1', false)).toBe('avc1.64001F');
    expect(codecString('3.0', false)).toBe('avc1.64001E');
  });
});

describe('buildMasterPlaylist', () => {
  const plan = planRenditions(
    { width: 1920, height: 1080, duration: 10, fps: 25, hasAudio: true },
    DEFAULT_CONFIG
  );

  it('lists renditions highest first with bandwidth from real sizes', () => {
    const stats = plan.renditions.map((rendition, i) => ({
      rendition,
      bytes: [5_000_000, 2_500_000, 1_000_000][i],
    }));
    const text = buildMasterPlaylist(stats, plan, 10);
    const lines = text.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXT-X-VERSION:7');
    expect(lines[2]).toBe('#EXT-X-INDEPENDENT-SEGMENTS');
    expect(lines[3]).toBe(
      '#EXT-X-STREAM-INF:BANDWIDTH=4400000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"'
    );
    expect(lines[4]).toBe('1080p/index.m3u8');
    expect(lines[8]).toBe('480p/index.m3u8');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('guards against zero duration', () => {
    const text = buildMasterPlaylist([{ rendition: plan.renditions[2], bytes: 100 }], plan, 0);
    expect(text).toContain('BANDWIDTH=');
    expect(text).not.toContain('Infinity');
  });
});
