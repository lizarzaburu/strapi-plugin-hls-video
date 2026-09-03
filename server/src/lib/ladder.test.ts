import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { planRenditions } from './ladder';
import type { ProbeResult } from './types';

const probe = (
  h: number,
  w = Math.round((h * 16) / 9),
  extra: Partial<ProbeResult> = {}
): ProbeResult => ({
  width: w,
  height: h,
  duration: 10,
  fps: 25,
  hasAudio: true,
  ...extra,
});

describe('planRenditions', () => {
  it('uses all three renditions for a 1080p source', () => {
    const plan = planRenditions(probe(1080), DEFAULT_CONFIG);
    expect(plan.renditions.map((r) => r.height)).toEqual([1080, 720, 480]);
    expect(plan.renditions[0]).toMatchObject({
      width: 1920,
      crf: 23,
      maxrate: 5000,
      bufsize: 10000,
      level: '4.0',
      dirName: '1080p',
    });
    expect(plan.renditions[2]).toMatchObject({ crf: 26, audioBitrate: 96 });
  });

  it('never upscales', () => {
    const plan = planRenditions(probe(720), DEFAULT_CONFIG);
    expect(plan.renditions.map((r) => r.height)).toEqual([720, 480]);
  });

  it('falls back to a single source-height rendition below 480p', () => {
    const plan = planRenditions(probe(360, 640), DEFAULT_CONFIG);
    expect(plan.renditions).toHaveLength(1);
    expect(plan.renditions[0]).toMatchObject({
      height: 360,
      width: 640,
      crf: 26,
      dirName: '360p',
    });
  });

  it('respects the configured subset', () => {
    const plan = planRenditions(probe(1080), { ...DEFAULT_CONFIG, renditions: [720] });
    expect(plan.renditions.map((r) => r.height)).toEqual([720]);
  });

  it('keeps widths even and aspect ratio (4K vertical source)', () => {
    const plan = planRenditions(probe(3840, 2160), DEFAULT_CONFIG);
    expect(plan.renditions[0]).toMatchObject({ height: 1080, width: 608 });
  });

  it('sets gop from fps and drops audio bitrate without audio', () => {
    const plan = planRenditions(probe(1080, 1920, { fps: 29.97, hasAudio: false }), DEFAULT_CONFIG);
    expect(plan.gop).toBe(60);
    expect(plan.hasAudio).toBe(false);
    expect(plan.renditions.every((r) => r.audioBitrate === 0)).toBe(true);
  });
});
