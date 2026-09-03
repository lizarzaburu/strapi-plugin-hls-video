import { beforeEach, describe, expect, it } from 'vitest';
import { FILE_UID, JOB_UID } from '../lib/strapi-types';
import type { UploadFile } from '../lib/types';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import { createJobsService, type JobsService } from '../services/jobs';
import type { Worker } from '../services/worker';
import { createJobsController } from './jobs';

interface Ctx {
  params: Record<string, string>;
  body?: unknown;
  status?: number;
  notFound: (msg: string) => void;
}

const ctx = (params: Record<string, string> = {}): Ctx => ({
  params,
  notFound(msg) {
    this.status = 404;
    this.body = { error: msg };
  },
});

describe('jobs controller', () => {
  let fake: FakeStrapi;
  let jobs: JobsService;
  const worker: Worker = {
    start: async () => undefined,
    stop: () => undefined,
    tick: async () => undefined,
    cleanup: async () => undefined,
    state: () => ({
      running: true,
      busy: false,
      currentJobId: null,
      ffmpegAvailable: true,
      freeMemoryMb: 4096,
    }),
  };

  beforeEach(async () => {
    fake = createFakeStrapi();
    jobs = createJobsService({ strapi: fake.strapi });
    fake.services.jobs = jobs;
    fake.services.worker = worker;
    await fake.strapi.db.query<UploadFile>(FILE_UID).create({
      data: {
        name: 'a.mp4',
        hash: 'h1',
        ext: '.mp4',
        mime: 'video/mp4',
        url: '/uploads/h1.mp4',
        provider: 'local',
        formats: null,
      },
    });
    await jobs.enqueue({ fileId: 1, fileHash: 'h1', version: 1 });
  });

  it('lists jobs with file names', async () => {
    const c = ctx();
    await createJobsController({ strapi: fake.strapi }).list(c);
    expect(c.body).toEqual({
      data: [
        expect.objectContaining({
          fileId: 1,
          fileName: 'a.mp4',
          fileUrl: '/uploads/h1.mp4',
          status: 'queued',
        }),
      ],
    });
  });

  it('marks deleted files in the list', async () => {
    await jobs.enqueue({ fileId: 99, fileHash: 'gone', version: 1 });
    const c = ctx();
    await createJobsController({ strapi: fake.strapi }).list(c);
    const rows = (c.body as { data: Array<{ fileId: number; fileName: string | null }> }).data;
    expect(rows.find((r) => r.fileId === 99)?.fileName).toBeNull();
  });

  it('retries by creating the next version', async () => {
    const c = ctx({ id: '2' });
    await createJobsController({ strapi: fake.strapi }).retry(c);
    expect(c.body).toEqual({
      data: expect.objectContaining({ fileId: 1, fileHash: 'h1', version: 2, status: 'queued' }),
    });
    expect(fake.tables[JOB_UID]).toHaveLength(1);
  });

  it('returns 404 for unknown jobs or deleted files', async () => {
    const controller = createJobsController({ strapi: fake.strapi });
    const missing = ctx({ id: '42' });
    await controller.retry(missing);
    expect(missing.status).toBe(404);
    await jobs.enqueue({ fileId: 99, fileHash: 'gone', version: 1 });
    const orphan = ctx({ id: '3' });
    await controller.retry(orphan);
    expect(orphan.status).toBe(404);
  });

  it('reports worker status', async () => {
    const c = ctx();
    await createJobsController({ strapi: fake.strapi }).status(c);
    expect(c.body).toEqual({
      data: expect.objectContaining({ ffmpegAvailable: true, freeMemoryMb: 4096 }),
    });
  });
});
