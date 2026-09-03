import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveBinaries } from '../lib/binaries';
import { DEFAULT_CONFIG } from '../lib/config';
import { LocalFfmpegConverter, runProcess } from '../lib/converter';
import { FILE_UID } from '../lib/strapi-types';
import type { HlsFormat, UploadFile } from '../lib/types';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import { createConversionService } from './conversion';
import { createJobsService, type JobsService } from './jobs';

const bins = resolveBinaries(DEFAULT_CONFIG);
const hasBins = Boolean(bins.ffmpeg && bins.ffprobe);
const HASH = 'e2e_clip';

describe.skipIf(!hasBins)('conversion service (integration)', () => {
  let publicDir: string;

  beforeAll(async () => {
    publicDir = await mkdtemp(path.join(os.tmpdir(), 'hls-e2e-'));
    await mkdir(path.join(publicDir, 'uploads'), { recursive: true });
    const input = path.join(publicDir, 'uploads', `${HASH}.mp4`);
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
    if (publicDir) await rm(publicDir, { recursive: true, force: true });
  });

  it('converts a real clip end-to-end with LocalFfmpegConverter', async () => {
    const fake: FakeStrapi = createFakeStrapi({ publicDir });
    const jobs: JobsService = createJobsService({ strapi: fake.strapi });

    const file = await fake.strapi.db.query<UploadFile>(FILE_UID).create({
      data: {
        name: 'clip.mp4',
        hash: HASH,
        ext: '.mp4',
        mime: 'video/mp4',
        url: `/uploads/${HASH}.mp4`,
        provider: 'local',
        formats: null,
      },
    });

    await jobs.enqueue({ fileId: file.id, fileHash: HASH, version: 1 });
    const job = await jobs.claimNext();
    if (!job) throw new Error('expected a claimable job');

    const converter = new LocalFfmpegConverter({
      ffmpeg: bins.ffmpeg as string,
      ffprobe: bins.ffprobe as string,
    });
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: { ...DEFAULT_CONFIG, preset: 'ultrafast' },
      converter,
    });

    const result = await service.run(job);
    expect(result.outputDir).toBe(`hls/${HASH}-v1`);

    const outDir = path.join(publicDir, 'uploads', 'hls', `${HASH}-v1`);
    const master = await readFile(path.join(outDir, 'master.m3u8'), 'utf8');
    const idx720 = master.indexOf('720p/index.m3u8');
    const idx480 = master.indexOf('480p/index.m3u8');
    expect(idx720).toBeGreaterThanOrEqual(0);
    expect(idx480).toBeGreaterThanOrEqual(0);
    expect(idx720).toBeLessThan(idx480);

    const poster = await stat(path.join(outDir, 'poster.jpg'));
    expect(poster.size).toBeGreaterThan(1000);

    const updated = fake.tables[FILE_UID][0] as unknown as UploadFile & {
      formats: { hls: HlsFormat };
    };
    expect(updated.formats.hls).toMatchObject({
      url: `/uploads/hls/${HASH}-v1/master.m3u8`,
      poster: `/uploads/hls/${HASH}-v1/poster.jpg`,
      hasAudio: true,
      renditions: [720, 480],
      version: 1,
    });
    expect(updated.formats.hls.duration).toBeGreaterThan(2.5);

    expect(fake.events).toEqual([
      { name: 'media.update', payload: { media: expect.objectContaining({ id: file.id }) } },
    ]);
  }, 60_000);
});
