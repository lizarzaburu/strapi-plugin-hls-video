import { JOB_UID, type StrapiLike } from '../lib/strapi-types';
import type { JobRow } from '../lib/types';

const ERROR_LIMIT = 2000;
const RETRY_BASE_MS = 60_000;

export interface EnqueueInput {
  fileId: number;
  fileHash: string;
  version: number;
}

export interface JobsService {
  enqueue(input: EnqueueInput): Promise<JobRow>;
  nextVersion(fileId: number): Promise<number>;
  claimNext(now?: Date): Promise<JobRow | null>;
  markReady(id: number, result: { outputDir: string; durationMs: number }): Promise<JobRow>;
  markFailure(
    id: number,
    error: string,
    opts: { retryable: boolean; retries: number; now?: Date }
  ): Promise<JobRow>;
  /** Puts a job interrupted by worker.stop() back in the queue without counting an attempt. */
  requeue(id: number): Promise<void>;
  recoverStale(): Promise<number>;
  list(limit?: number): Promise<JobRow[]>;
  findById(id: number): Promise<JobRow | null>;
  findByFile(fileId: number): Promise<JobRow[]>;
  deleteForFile(fileId: number): Promise<void>;
}

export function createJobsService({ strapi }: { strapi: StrapiLike }): JobsService {
  const query = () => strapi.db.query<JobRow>(JOB_UID);

  return {
    async enqueue(input) {
      await query().deleteMany({ where: { fileId: input.fileId, status: 'queued' } });
      return query().create({
        data: {
          fileId: input.fileId,
          fileHash: input.fileHash,
          version: input.version,
          status: 'queued',
          attempts: 0,
          error: null,
          outputDir: null,
          notBefore: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
        },
      });
    },

    async nextVersion(fileId) {
      const rows = await query().findMany({
        where: { fileId },
        orderBy: { version: 'desc' },
        limit: 1,
      });
      return rows.length ? rows[0].version + 1 : 1;
    },

    async claimNext(now = new Date()) {
      const candidates = await query().findMany({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        limit: 20,
      });
      for (const candidate of candidates) {
        if (candidate.notBefore && new Date(candidate.notBefore).getTime() > now.getTime()) {
          continue;
        }
        const { count } = await query().updateMany({
          where: { id: candidate.id, status: 'queued' },
          data: { status: 'processing', startedAt: now.toISOString() },
        });
        if (count === 0) continue; // another process claimed it first, try the next candidate
        return query().findOne({ where: { id: candidate.id } });
      }
      return null;
    },

    async markReady(id, result) {
      const row = await query().update({
        where: { id },
        data: {
          status: 'ready',
          outputDir: result.outputDir,
          durationMs: result.durationMs,
          error: null,
          notBefore: null,
          finishedAt: new Date().toISOString(),
        },
      });
      if (!row) throw new Error(`hls-video: job ${id} not found`);
      return row;
    },

    async markFailure(id, error, opts) {
      const now = opts.now ?? new Date();
      const job = await query().findOne({ where: { id } });
      if (!job) throw new Error(`hls-video: job ${id} not found`);
      const attempts = job.attempts + 1;
      const message = error.slice(0, ERROR_LIMIT);
      const exhausted = !opts.retryable || attempts > opts.retries;
      if (exhausted) {
        const row = await query().update({
          where: { id },
          data: {
            status: 'failed',
            attempts,
            error: message,
            notBefore: null,
            finishedAt: now.toISOString(),
          },
        });
        if (!row) throw new Error(`hls-video: job ${id} not found`);
        return row;
      }
      const notBefore = new Date(now.getTime() + RETRY_BASE_MS * attempts).toISOString();
      const row = await query().update({
        where: { id },
        data: { status: 'queued', attempts, error: message, notBefore, startedAt: null },
      });
      if (!row) throw new Error(`hls-video: job ${id} not found`);
      return row;
    },

    async requeue(id) {
      await query().update({
        where: { id },
        data: { status: 'queued', startedAt: null },
      });
      // No-op if the row is already gone (e.g. its file was deleted mid-conversion).
    },

    async recoverStale() {
      const { count } = await query().updateMany({
        where: { status: 'processing' },
        data: { status: 'queued', startedAt: null },
      });
      return count;
    },

    list(limit = 100) {
      return query().findMany({ orderBy: { createdAt: 'desc' }, limit });
    },

    findById(id) {
      return query().findOne({ where: { id } });
    },

    findByFile(fileId) {
      return query().findMany({ where: { fileId }, orderBy: { version: 'desc' } });
    },

    async deleteForFile(fileId) {
      await query().deleteMany({ where: { fileId } });
    },
  };
}
