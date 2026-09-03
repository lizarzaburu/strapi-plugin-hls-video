import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../lib/config';
import { JOB_UID } from '../lib/strapi-types';
import type { JobRow } from '../lib/types';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import { ConversionError, type ConversionService } from './conversion';
import { createJobsService, type JobsService } from './jobs';
import { createWorker } from './worker';

describe('worker', () => {
  let fake: FakeStrapi;
  let jobs: JobsService;
  const conversionOk: ConversionService = {
    run: vi.fn(async (job: JobRow) => ({
      outputDir: `hls/${job.fileHash}-v${job.version}`,
      durationMs: 5,
    })),
    deleteOutputsForFile: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    fake = createFakeStrapi();
    jobs = createJobsService({ strapi: fake.strapi });
    await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
  });

  it('processes a queued job and marks it ready', async () => {
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      conversion: conversionOk,
      freeMemoryMb: () => 8000,
    });
    await worker.tick();
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      status: 'ready',
      outputDir: 'hls/a-v1',
      durationMs: 5,
    });
    expect(worker.state().busy).toBe(false);
  });

  it('skips the tick when free memory is below the threshold', async () => {
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      conversion: conversionOk,
      freeMemoryMb: () => 500,
    });
    await worker.tick();
    expect(fake.tables[JOB_UID][0].status).toBe('queued');
    expect(conversionOk.run).not.toHaveBeenCalled();
    expect(fake.logs.some((l) => /free memory/.test(l))).toBe(true);
  });

  it('fails jobs immediately when ffmpeg is unavailable', async () => {
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      conversion: null,
      freeMemoryMb: () => 8000,
    });
    await worker.tick();
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/ffmpeg/),
    });
    expect(worker.state().ffmpegAvailable).toBe(false);
  });

  it('requeues retryable failures and fails non-retryable ones', async () => {
    const failing: ConversionService = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new ConversionError('transient', true))
        .mockRejectedValueOnce(new ConversionError('fatal', false)),
      deleteOutputsForFile: vi.fn(),
    };
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      conversion: failing,
      freeMemoryMb: () => 8000,
    });
    await worker.tick();
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: 'transient',
    });
    await fake.strapi.db
      .query<JobRow>(JOB_UID)
      .update({ where: { id: 1 }, data: { notBefore: null } });
    await worker.tick();
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      status: 'failed',
      attempts: 2,
      error: 'fatal',
    });
  });

  it('never runs two jobs at once', async () => {
    let release: () => void = () => undefined;
    const slow: ConversionService = {
      run: vi.fn(
        () =>
          new Promise<{ outputDir: string; durationMs: number }>((resolve) => {
            release = () => resolve({ outputDir: 'x', durationMs: 1 });
          })
      ),
      deleteOutputsForFile: vi.fn(),
    };
    await jobs.enqueue({ fileId: 2, fileHash: 'b', version: 1 });
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: DEFAULT_CONFIG,
      conversion: slow,
      freeMemoryMb: () => 8000,
    });
    const first = worker.tick();
    await worker.tick();
    // The second tick() short-circuits on the busy guard with no internal
    // await, so its promise settles before the first tick's claimNext()
    // chain (findMany -> update, each an async fn hop) reaches conversion.run.
    // Flush the remaining microtasks so that has happened before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(slow.run).toHaveBeenCalledTimes(1);
    expect(worker.state().busy).toBe(true);
    release();
    await first;
    expect(worker.state().busy).toBe(false);
  });

  it('recovers stale jobs on start and polls on an interval', async () => {
    vi.useFakeTimers();
    await jobs.claimNext();
    const worker = createWorker({
      strapi: fake.strapi,
      jobs,
      config: { ...DEFAULT_CONFIG, pollIntervalMs: 1000 },
      conversion: conversionOk,
      freeMemoryMb: () => 8000,
    });
    await worker.start();
    expect(fake.tables[JOB_UID][0].status).toBe('queued');
    await vi.advanceTimersByTimeAsync(1000);
    expect(conversionOk.run).toHaveBeenCalledTimes(1);
    worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(conversionOk.run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
