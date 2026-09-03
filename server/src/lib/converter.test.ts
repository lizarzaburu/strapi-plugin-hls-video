import { describe, expect, it, vi } from 'vitest';
import { LocalFfmpegConverter, type RunFn } from './converter';
import { DEFAULT_CONFIG } from './config';
import { planRenditions } from './ladder';

const bins = { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' };

describe('LocalFfmpegConverter', () => {
  it('probes via ffprobe and parses the json', async () => {
    const run: RunFn = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: 'video', width: 640, height: 360, r_frame_rate: '24/1' }],
        format: { duration: '3' },
      }),
      stderr: '',
    }));
    const conv = new LocalFfmpegConverter(bins, run);
    const controller = new AbortController();
    await expect(conv.probe('/in.mp4', controller.signal)).resolves.toEqual({
      width: 640,
      height: 360,
      duration: 3,
      fps: 24,
      hasAudio: false,
    });
    expect(run).toHaveBeenCalledWith(
      '/bin/ffprobe',
      expect.arrayContaining(['-show_streams', '/in.mp4']),
      expect.objectContaining({ signal: controller.signal, niceness: 19 })
    );
  });

  it('rejects with stderr when ffmpeg exits non-zero', async () => {
    const run: RunFn = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom: invalid data' }));
    const conv = new LocalFfmpegConverter(bins, run);
    const plan = planRenditions(
      { width: 640, height: 360, duration: 3, fps: 24, hasAudio: false },
      DEFAULT_CONFIG
    );
    await expect(
      conv.transcode(
        '/in.mp4',
        plan.renditions[0],
        plan,
        { preset: 'fast', threads: 2, segmentSeconds: 4, outDir: '/out/360p' },
        new AbortController().signal
      )
    ).rejects.toThrow(/exit code 1.*boom/s);
  });

  it('passes the abort signal and niceness through', async () => {
    const run: RunFn = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const conv = new LocalFfmpegConverter(bins, run);
    const controller = new AbortController();
    await conv.poster('/in.mp4', '/out/poster.jpg', 1, controller.signal);
    expect(run).toHaveBeenLastCalledWith(
      '/bin/ffmpeg',
      expect.arrayContaining(['-frames:v', '1']),
      expect.objectContaining({ signal: controller.signal, niceness: 19 })
    );
    const plan = planRenditions(
      { width: 640, height: 360, duration: 3, fps: 24, hasAudio: false },
      DEFAULT_CONFIG
    );
    await conv.transcode(
      '/in.mp4',
      plan.renditions[0],
      plan,
      { preset: 'fast', threads: 2, segmentSeconds: 4, outDir: '/o' },
      controller.signal
    );
    expect(run).toHaveBeenLastCalledWith(
      '/bin/ffmpeg',
      expect.any(Array),
      expect.objectContaining({ signal: controller.signal, niceness: 19 })
    );
  });
});
