import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../lib/config';
import { FILE_UID, JOB_UID } from '../lib/strapi-types';
import type { JobRow, UploadFile } from '../lib/types';
import { createFakeConverter } from '../test/fake-converter';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import { ConversionError, createConversionService } from './conversion';
import { createJobsService, type JobsService } from './jobs';

describe('conversion service', () => {
  let publicDir: string;
  let fake: FakeStrapi;
  let jobs: JobsService;

  const seedFile = async (over: Partial<UploadFile> = {}): Promise<UploadFile> => {
    const file = await fake.strapi.db.query<UploadFile>(FILE_UID).create({
      data: {
        name: 'clip.mp4',
        hash: 'clip_abc',
        ext: '.mp4',
        mime: 'video/mp4',
        url: '/uploads/clip_abc.mp4',
        provider: 'local',
        formats: null,
        ...over,
      },
    });
    await mkdir(path.join(publicDir, 'uploads'), { recursive: true });
    await writeFile(path.join(publicDir, 'uploads', 'clip_abc.mp4'), Buffer.alloc(10));
    return file;
  };

  const seedJob = async (file: UploadFile, version = 1): Promise<JobRow> => {
    await jobs.enqueue({ fileId: file.id, fileHash: file.hash, version });
    return (await jobs.claimNext()) as JobRow;
  };

  beforeEach(async () => {
    publicDir = await mkdtemp(path.join(os.tmpdir(), 'hls-public-'));
    fake = createFakeStrapi({ publicDir });
    jobs = createJobsService({ strapi: fake.strapi });
  });

  afterEach(async () => {
    await rm(publicDir, { recursive: true, force: true });
  });

  it('converts a file, writes master + poster, updates formats.hls and emits media.update', async () => {
    const file = await seedFile();
    const job = await seedJob(file);
    const converter = createFakeConverter({ bytes: { '1080p': 5000, '720p': 2500, '480p': 1000 } });
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter,
      now: () => new Date('2026-09-03T12:00:00Z'),
    });

    const result = await service.run(job);

    expect(result.outputDir).toBe('hls/clip_abc-v1');
    expect(converter.calls).toEqual([
      'probe',
      'transcode:1080p',
      'transcode:720p',
      'transcode:480p',
      'poster',
    ]);
    const outDir = path.join(publicDir, 'uploads', 'hls', 'clip_abc-v1');
    expect(await readdir(outDir)).toEqual(
      expect.arrayContaining(['master.m3u8', 'poster.jpg', '1080p', '720p', '480p'])
    );
    expect(await readdir(path.join(publicDir, 'uploads', 'hls'))).toEqual(['clip_abc-v1']);
    const master = await readFile(path.join(outDir, 'master.m3u8'), 'utf8');
    expect(master).toContain('RESOLUTION=1920x1080');
    expect(master.indexOf('1080p/index.m3u8')).toBeLessThan(master.indexOf('480p/index.m3u8'));

    const updated = fake.tables[FILE_UID][0] as unknown as UploadFile;
    expect(updated.formats).toEqual({
      hls: {
        url: '/uploads/hls/clip_abc-v1/master.m3u8',
        poster: '/uploads/hls/clip_abc-v1/poster.jpg',
        duration: 10,
        width: 1920,
        height: 1080,
        hasAudio: true,
        renditions: [1080, 720, 480],
        version: 1,
        generatedAt: '2026-09-03T12:00:00.000Z',
      },
    });
    expect(fake.events).toEqual([
      { name: 'media.update', payload: { media: expect.objectContaining({ id: file.id }) } },
    ]);
  });

  it('keeps other format keys and removes previous version directories', async () => {
    const file = await seedFile({ formats: { thumbnail: { url: '/x.jpg' } } });
    await mkdir(path.join(publicDir, 'uploads', 'hls', 'clip_abc-v1'), { recursive: true });
    await mkdir(path.join(publicDir, 'uploads', 'hls', 'other-v1'), { recursive: true });
    const oldJob = await jobs.enqueue({ fileId: file.id, fileHash: 'clip_abc', version: 1 });
    await jobs.markReady(oldJob.id, { outputDir: 'hls/clip_abc-v1', durationMs: 1 });
    const job = await seedJob(file, 2);
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: createFakeConverter(),
    });

    await service.run(job);

    const dirs = await readdir(path.join(publicDir, 'uploads', 'hls'));
    expect(dirs.sort()).toEqual(['clip_abc-v2', 'other-v1']);
    const updated = fake.tables[FILE_UID][0] as unknown as UploadFile;
    expect(updated.formats).toMatchObject({ thumbnail: { url: '/x.jpg' }, hls: { version: 2 } });
  });

  it('leaves no temp directory and rethrows when a rendition fails', async () => {
    const file = await seedFile();
    const job = await seedJob(file);
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: createFakeConverter({ failOn: '720p' }),
    });

    await expect(service.run(job)).rejects.toThrow(/720p/);
    expect(await readdir(path.join(publicDir, 'uploads', 'hls')).catch(() => [])).toEqual([]);
    expect(fake.events).toEqual([]);
  });

  it('is not retryable for non-local providers or missing files', async () => {
    const file = await seedFile({ provider: 'aws-s3' });
    const job = await seedJob(file);
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: createFakeConverter(),
    });
    await expect(service.run(job)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/local/),
    });

    const ghost: JobRow = { ...job, id: 999, fileId: 4242 };
    await expect(service.run(ghost)).rejects.toBeInstanceOf(ConversionError);
    await expect(service.run(ghost)).rejects.toMatchObject({ retryable: false });
  });

  it('aborts after maxEncodeMinutes and is not retryable', async () => {
    const file = await seedFile();
    const job = await seedJob(file);
    const converter = createFakeConverter({ hang: true });
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: { ...DEFAULT_CONFIG, maxEncodeMinutes: 0.0005 },
      converter,
    });
    await expect(service.run(job)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/timed out/),
    });
    // hang applies to probe too, so the timeout fires before any rendition starts.
    expect(converter.calls).toEqual(['probe']);
  });

  it('cleans up and fails non-retryably when the file row is deleted mid-conversion', async () => {
    const file = await seedFile();
    const job = await seedJob(file);
    const converter = createFakeConverter();
    const deletingConverter = {
      ...converter,
      async transcode(...args: Parameters<typeof converter.transcode>) {
        const table = fake.tables[FILE_UID];
        const index = table.findIndex((r) => r.id === file.id);
        if (index !== -1) table.splice(index, 1);
        return converter.transcode(...args);
      },
    };
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: deletingConverter,
    });

    await expect(service.run(job)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/deleted during conversion/),
    });
    expect(await readdir(path.join(publicDir, 'uploads', 'hls')).catch(() => [])).toEqual([]);
    expect(fake.events).toEqual([]);
  });

  it('rejects a source url that escapes the uploads directory', async () => {
    const file = await seedFile({ url: '/uploads/../secret.mp4' });
    const job = await seedJob(file);
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: createFakeConverter(),
    });
    await expect(service.run(job)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/unexpected upload url/),
    });
  });

  it('deletes every output directory of a file', async () => {
    const file = await seedFile();
    for (const v of [1, 2]) {
      const j = await jobs.enqueue({ fileId: file.id, fileHash: 'clip_abc', version: v });
      await jobs.markReady(j.id, { outputDir: `hls/clip_abc-v${v}`, durationMs: 1 });
      await mkdir(path.join(publicDir, 'uploads', 'hls', `clip_abc-v${v}`), { recursive: true });
    }
    const service = createConversionService({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      converter: createFakeConverter(),
    });
    await service.deleteOutputsForFile(file.id);
    expect(await readdir(path.join(publicDir, 'uploads', 'hls'))).toEqual([]);
    expect(fake.tables[JOB_UID]).toHaveLength(2);
  });
});
