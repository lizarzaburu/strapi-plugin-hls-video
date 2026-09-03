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

/**
 * True when an update's payload is a file *replace* rather than a metadata-only edit
 * (renaming, alt text, folder move, ...). Strapi's upload service intentionally keeps the
 * original `hash` value on replace, so the file's URL doesn't change — see
 * `@strapi/upload` `services/upload.js`, `replace()`: "keep a constant hash and extension
 * so the file url doesn't change when the file is replaced". `hash` is therefore only ever
 * present in the update payload for a create-time write or a replace; a plain metadata
 * update (`updateFileInfo`) never touches it. The plugin's own post-conversion write
 * (`conversion.ts`) only ever sets `formats`, never `hash`, so gating on this key cannot
 * loop back on itself.
 */
export function isReplace(data: Record<string, unknown> | undefined | null): boolean {
  return !!data && 'hash' in data;
}

function asFile(value: unknown): UploadFile | null {
  return value && typeof value === 'object' && 'id' in value ? (value as UploadFile) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Deps {
  strapi: StrapiLike;
  jobs: JobsService;
  /** removes HLS output directories of a file (conversion.deleteOutputsForFile) */
  cleanup: (fileId: number) => Promise<void>;
}

/**
 * Subscribes to `plugin::upload.file` lifecycles. No hook may throw into Strapi's upload
 * request/response cycle: every side effect is wrapped so a jobs/cleanup failure is logged
 * and swallowed rather than blocking the editor.
 */
export function subscribeUploadLifecycles({ strapi, jobs, cleanup }: Deps): () => void {
  const files = () => strapi.db.query<UploadFile>(FILE_UID);

  const loadTarget = async (event: LifecycleEvent): Promise<UploadFile | null> => {
    const where = event.params.where;
    if (!where) return null;
    return files().findOne({ where });
  };

  const enqueue = async (file: UploadFile) => {
    try {
      const version = await jobs.nextVersion(file.id);
      await jobs.enqueue({ fileId: file.id, fileHash: file.hash, version });
      strapi.log.info(`hls-video: queued "${file.name}" (file ${file.id}, v${version})`);
    } catch (error) {
      strapi.log.error(`hls-video: could not queue file ${file.id}: ${errorMessage(error)}`);
    }
  };

  return strapi.db.lifecycles.subscribe({
    models: [FILE_UID],

    async afterCreate(event) {
      const file = asFile(event.result);
      if (file && isVideoFile(file)) await enqueue(file);
    },

    async afterUpdate(event) {
      const next = asFile(event.result);
      if (!next || !isVideoFile(next)) return;
      if (!isReplace(event.params.data)) return;
      await enqueue(next);
    },

    async beforeDelete(event) {
      try {
        event.state.file = await loadTarget(event);
      } catch (error) {
        strapi.log.error(`hls-video: could not load file before delete: ${errorMessage(error)}`);
      }
    },

    async afterDelete(event) {
      const file = asFile(event.state.file);
      if (!file || !isVideoFile(file)) return;
      try {
        await cleanup(file.id);
      } catch (error) {
        strapi.log.error(`hls-video: cleanup failed for file ${file.id}: ${errorMessage(error)}`);
      }
      try {
        await jobs.deleteForFile(file.id);
        strapi.log.info(`hls-video: removed HLS output of deleted file ${file.id}`);
      } catch (error) {
        strapi.log.error(
          `hls-video: could not delete jobs of file ${file.id}: ${errorMessage(error)}`
        );
      }
    },
  });
}

let unregister: (() => void) | null = null;

/**
 * Registers the upload lifecycle subscriber, storing the unsubscribe function so
 * `unregisterUploadLifecycles` (called from `destroy.ts`) can release it. Calling this
 * twice without an intervening unregister replaces the previous subscription instead of
 * accumulating subscribers.
 */
export function registerUploadLifecycles(deps: Deps): void {
  if (unregister) unregister();
  unregister = subscribeUploadLifecycles(deps);
}

/** Releases the subscription registered by `registerUploadLifecycles`; no-op when none is active. */
export function unregisterUploadLifecycles(): void {
  if (unregister) {
    unregister();
    unregister = null;
  }
}
