import { beforeEach, describe, expect, it } from 'vitest';
import { JOB_UID, type QueryApi } from '../lib/strapi-types';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import type { JobRow } from '../lib/types';
import { createJobsService, type JobsService } from './jobs';

describe('jobs service', () => {
  let fake: FakeStrapi;
  let jobs: JobsService;

  beforeEach(() => {
    fake = createFakeStrapi();
    jobs = createJobsService({ strapi: fake.strapi });
  });

  it('enqueues a job and replaces older queued jobs of the same file', async () => {
    await jobs.enqueue({ fileId: 7, fileHash: 'a', version: 1 });
    const second = await jobs.enqueue({ fileId: 7, fileHash: 'b', version: 2 });
    const rows = fake.tables[JOB_UID];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: second.id, fileHash: 'b', status: 'queued', attempts: 0 });
  });

  it('computes the next version per file', async () => {
    expect(await jobs.nextVersion(7)).toBe(1);
    await jobs.enqueue({ fileId: 7, fileHash: 'a', version: 1 });
    await jobs.markReady((await jobs.claimNext())!.id, { outputDir: 'hls/a-v1', durationMs: 10 });
    expect(await jobs.nextVersion(7)).toBe(2);
  });

  it('claims the oldest queued job and marks it processing', async () => {
    const first = await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.enqueue({ fileId: 2, fileHash: 'b', version: 1 });
    const claimed = await jobs.claimNext();
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe('processing');
    expect(claimed?.startedAt).toBeTruthy();
    expect((await jobs.claimNext())?.fileId).toBe(2);
    expect(await jobs.claimNext()).toBeNull();
  });

  it('atomically claims a job, skipping one that lost the race to another process', async () => {
    await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.enqueue({ fileId: 2, fileHash: 'b', version: 1 });

    let intercepted = false;
    const originalQuery = fake.strapi.db.query;
    fake.strapi.db.query = function query<T>(uid: string): QueryApi<T> {
      const q = originalQuery<T>(uid);
      if (uid !== JOB_UID) return q;
      return {
        ...q,
        async findMany(params) {
          const rows = await q.findMany(params);
          if (!intercepted && rows.length) {
            intercepted = true;
            // Simulate another process claiming the first candidate between
            // this findMany() and claimNext()'s subsequent updateMany().
            const row = fake.tables[JOB_UID].find(
              (r) => r.id === (rows[0] as unknown as JobRow).id
            );
            if (row) row.status = 'processing';
          }
          return rows;
        },
      };
    };

    const claimed = await jobs.claimNext();
    expect(claimed?.fileId).toBe(2);
  });

  it('requeue puts a job back in the queue without touching attempts', async () => {
    const job = await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.claimNext();
    await jobs.requeue(job.id);
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      status: 'queued',
      startedAt: null,
      attempts: 0,
    });
  });

  it('skips jobs whose notBefore is in the future', async () => {
    const job = await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.claimNext();
    await jobs.markFailure(job.id, 'boom', {
      retryable: true,
      retries: 2,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(await jobs.claimNext(new Date('2026-01-01T00:00:30Z'))).toBeNull();
    expect((await jobs.claimNext(new Date('2026-01-01T00:01:01Z')))?.id).toBe(job.id);
  });

  it('retries with growing delay and fails after the retries are exhausted', async () => {
    const job = await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    const t0 = new Date('2026-01-01T00:00:00Z');
    let row = await jobs.markFailure(job.id, 'e1', { retryable: true, retries: 2, now: t0 });
    expect(row).toMatchObject({ status: 'queued', attempts: 1, error: 'e1' });
    expect(row.notBefore).toBe('2026-01-01T00:01:00.000Z');
    row = await jobs.markFailure(job.id, 'e2', { retryable: true, retries: 2, now: t0 });
    expect(row).toMatchObject({ status: 'queued', attempts: 2 });
    expect(row.notBefore).toBe('2026-01-01T00:02:00.000Z');
    row = await jobs.markFailure(job.id, 'e3', { retryable: true, retries: 2, now: t0 });
    expect(row).toMatchObject({ status: 'failed', attempts: 3, error: 'e3' });
    expect(row.finishedAt).toBeTruthy();
  });

  it('fails immediately when not retryable and truncates the error', async () => {
    const job = await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    const row = await jobs.markFailure(job.id, 'x'.repeat(3000), { retryable: false, retries: 2 });
    expect(row.status).toBe('failed');
    expect(row.error).toHaveLength(2000);
  });

  it('recovers stale processing jobs on boot', async () => {
    await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.claimNext();
    expect(await jobs.recoverStale()).toBe(1);
    expect(fake.tables[JOB_UID][0]).toMatchObject({ status: 'queued', startedAt: null });
  });

  it('lists newest first and deletes by file', async () => {
    await jobs.enqueue({ fileId: 1, fileHash: 'a', version: 1 });
    await jobs.enqueue({ fileId: 2, fileHash: 'b', version: 1 });
    expect((await jobs.list()).map((j) => j.fileId)).toEqual([2, 1]);
    await jobs.deleteForFile(1);
    expect(await jobs.findByFile(1)).toEqual([]);
    expect(await jobs.list()).toHaveLength(1);
  });
});
