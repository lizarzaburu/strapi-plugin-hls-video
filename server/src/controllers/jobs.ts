import { FILE_UID, PLUGIN_NAME, type StrapiLike } from '../lib/strapi-types';
import type { JobRow, UploadFile } from '../lib/types';
import type { JobsService } from '../services/jobs';
import type { Worker } from '../services/worker';

export interface KoaLikeContext {
  params: Record<string, string>;
  body?: unknown;
  notFound(message: string): void;
}

export interface JobView extends JobRow {
  fileName: string | null;
  fileUrl: string | null;
}

export function createJobsController({ strapi }: { strapi: StrapiLike }) {
  const jobs = () => strapi.plugin(PLUGIN_NAME).service('jobs') as JobsService;
  const worker = () => strapi.plugin(PLUGIN_NAME).service('worker') as Worker;

  return {
    async list(ctx: KoaLikeContext) {
      const rows = await jobs().list(100);
      const ids = [...new Set(rows.map((r) => r.fileId))];
      const files = ids.length
        ? await strapi.db
            .query<UploadFile>(FILE_UID)
            .findMany({ where: { id: { $in: ids } }, select: ['id', 'name', 'url'] })
        : [];
      const byId = new Map(files.map((f) => [f.id, f]));
      const data: JobView[] = rows.map((row) => ({
        ...row,
        fileName: byId.get(row.fileId)?.name ?? null,
        fileUrl: byId.get(row.fileId)?.url ?? null,
      }));
      ctx.body = { data };
    },

    async retry(ctx: KoaLikeContext) {
      const id = Number(ctx.params.id);
      const job = Number.isInteger(id) ? await jobs().findById(id) : null;
      if (!job) return ctx.notFound('job not found');
      const file = await strapi.db
        .query<UploadFile>(FILE_UID)
        .findOne({ where: { id: job.fileId } });
      if (!file) return ctx.notFound('file no longer exists');
      const version = await jobs().nextVersion(file.id);
      const created = await jobs().enqueue({ fileId: file.id, fileHash: file.hash, version });
      ctx.body = { data: created };
    },

    async status(ctx: KoaLikeContext) {
      ctx.body = { data: worker().state() };
    },
  };
}
