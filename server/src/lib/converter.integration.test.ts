import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveBinaries } from './binaries';
import { DEFAULT_CONFIG } from './config';
import { LocalFfmpegConverter, runProcess } from './converter';
import { posterTime } from './ffmpeg-args';
import { planRenditions } from './ladder';

const bins = resolveBinaries(DEFAULT_CONFIG);
const hasBins = Boolean(bins.ffmpeg && bins.ffprobe);

describe.skipIf(!hasBins)('LocalFfmpegConverter (integration)', () => {
  let dir: string;
  let input: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'hls-video-'));
    input = path.join(dir, 'clip.mp4');
    const result = await runProcess(
      bins.ffmpeg as string,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
        '-t',
        '3',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-c:a',
        'aac',
        '-shortest',
        input,
      ],
      {}
    );
    expect(result.code).toBe(0);
  }, 60_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('probes, transcodes one rendition and writes a poster', async () => {
    const conv = new LocalFfmpegConverter({
      ffmpeg: bins.ffmpeg as string,
      ffprobe: bins.ffprobe as string,
    });
    const probe = await conv.probe(input, new AbortController().signal);
    expect(probe).toMatchObject({ width: 1280, height: 720, hasAudio: true });
    expect(probe.duration).toBeGreaterThan(2.5);

    const plan = planRenditions(probe, { ...DEFAULT_CONFIG, renditions: [480] });
    const outDir = path.join(dir, '480p');
    await mkdir(outDir, { recursive: true });
    await conv.transcode(
      input,
      plan.renditions[0],
      plan,
      { preset: 'ultrafast', threads: 2, segmentSeconds: 4, outDir },
      new AbortController().signal
    );

    const files = await readdir(outDir);
    expect(files).toContain('index.m3u8');
    expect(files).toContain('init.mp4');
    expect(files.some((f) => /^seg_\d{3}\.m4s$/.test(f))).toBe(true);
    const playlist = await readFile(path.join(outDir, 'index.m3u8'), 'utf8');
    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(playlist).toContain('#EXT-X-ENDLIST');

    const poster = path.join(dir, 'poster.jpg');
    await conv.poster(input, poster, posterTime(probe.duration), new AbortController().signal);
    expect((await stat(poster)).size).toBeGreaterThan(1000);
  }, 60_000);
});
