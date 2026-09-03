import {
  FILE_UID,
  PLUGIN_NAME,
  type LifecycleEvent,
  type PermissionAction,
  type StrapiLike,
} from '../lib/strapi-types';
import type { UploadFile } from '../lib/types';
import type { JobsService } from './jobs';

export const PERMISSIONS: PermissionAction[] = [
  { section: 'plugins', displayName: 'View conversion jobs', uid: 'read', pluginName: PLUGIN_NAME },
  { section: 'plugins', displayName: 'Re-run conversions', uid: 'retry', pluginName: PLUGIN_NAME },
];

export function isVideoFile(file: Pick<UploadFile, 'mime'> | null | undefined): boolean {
  return typeof file?.mime === 'string' && file.mime.startsWith('video/');
}

export function hashChanged(
  prev: Pick<UploadFile, 'hash'> | null,
  next: Pick<UploadFile, 'hash'>
): boolean {
  return !prev || prev.hash !== next.hash;
}

function asFile(value: unknown): UploadFile | null {
  return value && typeof value === 'object' && 'id' in value ? (value as UploadFile) : null;
}

interface Deps {
  strapi: StrapiLike;
  jobs: JobsService;
  /** removes HLS output directories of a file (conversion.deleteOutputsForFile) */
  cleanup: (fileId: number) => Promise<void>;
}

export function subscribeUploadLifecycles({ strapi, jobs, cleanup }: Deps): () => void {
  const files = () => strapi.db.query<UploadFile>(FILE_UID);

  const loadTarget = async (event: LifecycleEvent): Promise<UploadFile | null> => {
    const where = event.params.where;
    if (!where) return null;
    return files().findOne({ where });
  };

  const enqueue = async (file: UploadFile) => {
    const version = await jobs.nextVersion(file.id);
    await jobs.enqueue({ fileId: file.id, fileHash: file.hash, version });
    strapi.log.info(`hls-video: queued "${file.name}" (file ${file.id}, v${version})`);
  };

  return strapi.db.lifecycles.subscribe({
    models: [FILE_UID],

    async afterCreate(event) {
      const file = asFile(event.result);
      if (file && isVideoFile(file)) await enqueue(file);
    },

    async beforeUpdate(event) {
      if (event.params.data && 'hash' in event.params.data) {
        event.state.prev = await loadTarget(event);
      }
    },

    async afterUpdate(event) {
      const next = asFile(event.result);
      if (!next || !isVideoFile(next)) return;
      if (!(event.params.data && 'hash' in event.params.data)) return;
      const prev = asFile(event.state.prev);
      if (hashChanged(prev, next)) await enqueue(next);
    },

    async beforeDelete(event) {
      event.state.file = await loadTarget(event);
    },

    async afterDelete(event) {
      const file = asFile(event.state.file);
      if (!file || !isVideoFile(file)) return;
      await cleanup(file.id);
      await jobs.deleteForFile(file.id);
      strapi.log.info(`hls-video: removed HLS output of deleted file ${file.id}`);
    },
  });
}
