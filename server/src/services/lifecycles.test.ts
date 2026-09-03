import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_UID, JOB_UID, type LifecycleEvent } from '../lib/strapi-types';
import type { UploadFile } from '../lib/types';
import { createFakeStrapi, type FakeStrapi } from '../test/fake-strapi';
import { createJobsService, type JobsService } from './jobs';
import { hashChanged, isVideoFile, subscribeUploadLifecycles } from './lifecycles';

const video: UploadFile = {
  id: 1,
  name: 'a.mp4',
  hash: 'h1',
  ext: '.mp4',
  mime: 'video/mp4',
  url: '/uploads/h1.mp4',
  provider: 'local',
  formats: null,
};

function event(action: string, over: Partial<LifecycleEvent>): LifecycleEvent {
  return { action, model: { uid: FILE_UID }, params: {}, state: {}, ...over };
}

describe('filters', () => {
  it('detects videos by mime', () => {
    expect(isVideoFile(video)).toBe(true);
    expect(isVideoFile({ mime: 'image/png' })).toBe(false);
    expect(isVideoFile(null)).toBe(false);
  });

  it('detects hash changes', () => {
    expect(hashChanged({ hash: 'a' }, { hash: 'b' })).toBe(true);
    expect(hashChanged({ hash: 'a' }, { hash: 'a' })).toBe(false);
    expect(hashChanged(null, { hash: 'a' })).toBe(true);
  });
});

describe('subscribeUploadLifecycles', () => {
  let fake: FakeStrapi;
  let jobs: JobsService;
  const cleanup = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeStrapi();
    jobs = createJobsService({ strapi: fake.strapi });
    subscribeUploadLifecycles({ strapi: fake.strapi, jobs, cleanup });
  });

  const sub = () => fake.subscribers[0];

  it('subscribes to upload.file only', () => {
    expect(sub().models).toEqual([FILE_UID]);
  });

  it('enqueues on video create, ignores images', async () => {
    await sub().afterCreate?.(event('afterCreate', { result: video }));
    await sub().afterCreate?.(
      event('afterCreate', { result: { ...video, id: 2, mime: 'image/png' } })
    );
    expect(fake.tables[JOB_UID]).toHaveLength(1);
    expect(fake.tables[JOB_UID][0]).toMatchObject({
      fileId: 1,
      fileHash: 'h1',
      version: 1,
      status: 'queued',
    });
  });

  it('enqueues the next version when the hash changes on update, not otherwise', async () => {
    await fake.strapi.db.query<UploadFile>(FILE_UID).create({ data: video });
    const ready = await jobs.enqueue({ fileId: 1, fileHash: 'h1', version: 1 });
    await jobs.markReady(ready.id, { outputDir: 'hls/h1-v1', durationMs: 1 });

    const e1 = event('beforeUpdate', {
      params: { where: { id: 1 }, data: { formats: { hls: {} } } },
    });
    await sub().beforeUpdate?.(e1);
    await sub().afterUpdate?.({
      ...e1,
      action: 'afterUpdate',
      result: { ...video, formats: { hls: {} } },
    });
    expect(fake.tables[JOB_UID]).toHaveLength(1);

    const e2 = event('beforeUpdate', { params: { where: { id: 1 }, data: { hash: 'h2' } } });
    await sub().beforeUpdate?.(e2);
    await sub().afterUpdate?.({ ...e2, action: 'afterUpdate', result: { ...video, hash: 'h2' } });
    expect(fake.tables[JOB_UID]).toHaveLength(2);
    expect(fake.tables[JOB_UID][1]).toMatchObject({ fileId: 1, fileHash: 'h2', version: 2 });
  });

  it('cleans up outputs and jobs on delete', async () => {
    await fake.strapi.db.query<UploadFile>(FILE_UID).create({ data: video });
    await jobs.enqueue({ fileId: 1, fileHash: 'h1', version: 1 });
    const e = event('beforeDelete', { params: { where: { id: 1 } } });
    await sub().beforeDelete?.(e);
    await sub().afterDelete?.({ ...e, action: 'afterDelete' });
    expect(cleanup).toHaveBeenCalledWith(1);
    expect(fake.tables[JOB_UID]).toHaveLength(0);
  });

  it('ignores deletes of non-videos', async () => {
    await fake.strapi.db
      .query<UploadFile>(FILE_UID)
      .create({ data: { ...video, mime: 'image/png' } });
    const e = event('beforeDelete', { params: { where: { id: 1 } } });
    await sub().beforeDelete?.(e);
    await sub().afterDelete?.({ ...e, action: 'afterDelete' });
    expect(cleanup).not.toHaveBeenCalled();
  });
});
