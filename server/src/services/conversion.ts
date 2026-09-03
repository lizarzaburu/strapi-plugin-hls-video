import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginConfig } from '../lib/config';
import type { Converter } from '../lib/converter';
import { posterTime } from '../lib/ffmpeg-args';
import { planRenditions } from '../lib/ladder';
import { buildMasterPlaylist, type RenditionStats } from '../lib/master-playlist';
import { hlsUrl, outputDirName, tmpDirName } from '../lib/paths';
import { FILE_UID, type StrapiLike } from '../lib/strapi-types';
import type { HlsFormat, JobRow, UploadFile } from '../lib/types';
import type { JobsService } from './jobs';

export class ConversionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

export interface ConversionService {
  run(job: JobRow, signal?: AbortSignal): Promise<{ outputDir: string; durationMs: number }>;
  deleteOutputsForFile(fileId: number, keepDir?: string): Promise<void>;
  removeOutputDir(dir: string): Promise<void>;
}

interface Deps {
  strapi: StrapiLike;
  jobs: JobsService;
  config: PluginConfig;
  converter: Converter;
  now?: () => Date;
}

function localSourcePath(publicDir: string, file: UploadFile): string {
  let pathname = file.url;
  if (/^https?:\/\//.test(pathname)) pathname = new URL(pathname).pathname;
  if (!pathname.startsWith('/uploads/')) {
    throw new ConversionError(`hls-video: unexpected upload url "${file.url}"`, false);
  }
  const uploadsRoot = path.resolve(publicDir, 'uploads');
  const resolved = path.resolve(publicDir, `.${pathname}`);
  if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
    throw new ConversionError(`hls-video: unexpected upload url "${file.url}"`, false);
  }
  return resolved;
}

async function dirBytes(dir: string): Promise<number> {
  const entries = await readdir(dir);
  let total = 0;
  for (const entry of entries) total += (await stat(path.join(dir, entry))).size;
  return total;
}

export function createConversionService(deps: Deps): ConversionService {
  const { strapi, jobs, config, converter } = deps;
  const now = deps.now ?? (() => new Date());
  const uploadsRoot = () => path.join(strapi.dirs.static.public, 'uploads');
  const files = () => strapi.db.query<UploadFile>(FILE_UID);

  async function deleteOutputsForFile(fileId: number, keepDir?: string): Promise<void> {
    const rows = await jobs.findByFile(fileId);
    const dirs = new Set(rows.map((r) => r.outputDir).filter((d): d is string => Boolean(d)));
    for (const dir of dirs) {
      if (dir === keepDir) continue;
      await rm(path.join(uploadsRoot(), dir), { recursive: true, force: true });
    }
  }

  async function run(
    job: JobRow,
    externalSignal?: AbortSignal
  ): Promise<{ outputDir: string; durationMs: number }> {
    const started = Date.now();
    const file = await files().findOne({ where: { id: job.fileId } });
    if (!file) throw new ConversionError(`hls-video: file ${job.fileId} no longer exists`, false);
    if (file.provider !== 'local') {
      throw new ConversionError(
        `hls-video: only the local upload provider is supported (file uses "${file.provider}")`,
        false
      );
    }

    const input = localSourcePath(strapi.dirs.static.public, file);
    const finalDir = outputDirName(file.hash, job.version);
    const tmpDir = tmpDirName(file.hash, job.version);
    const tmpAbs = path.join(uploadsRoot(), tmpDir);
    const finalAbs = path.join(uploadsRoot(), finalDir);

    const controller = new AbortController();
    let interrupted = false;
    const timer = setTimeout(() => controller.abort(), config.maxEncodeMinutes * 60_000);
    const onExternalAbort = () => {
      interrupted = true;
      controller.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort);
    }

    try {
      await rm(tmpAbs, { recursive: true, force: true });
      await mkdir(tmpAbs, { recursive: true });

      const probe = await converter.probe(input, controller.signal);
      const plan = planRenditions(probe, config);
      const stats: RenditionStats[] = [];

      for (const rendition of plan.renditions) {
        if (controller.signal.aborted) throw new Error('hls-video: conversion aborted');
        const outDir = path.join(tmpAbs, rendition.dirName);
        await mkdir(outDir, { recursive: true });
        await converter.transcode(
          input,
          rendition,
          plan,
          {
            preset: config.preset,
            threads: config.threads,
            segmentSeconds: config.segmentSeconds,
            outDir,
          },
          controller.signal
        );
        stats.push({ rendition, bytes: await dirBytes(outDir) });
      }

      await converter.poster(
        input,
        path.join(tmpAbs, 'poster.jpg'),
        posterTime(probe.duration),
        controller.signal
      );
      await writeFile(
        path.join(tmpAbs, 'master.m3u8'),
        buildMasterPlaylist(stats, plan, probe.duration)
      );

      await rm(finalAbs, { recursive: true, force: true });
      await rename(tmpAbs, finalAbs);

      const hls: HlsFormat = {
        url: hlsUrl(finalDir, 'master.m3u8'),
        poster: hlsUrl(finalDir, 'poster.jpg'),
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        hasAudio: plan.hasAudio,
        renditions: plan.renditions.map((r) => r.height),
        version: job.version,
        generatedAt: now().toISOString(),
      };
      const formats = { ...(file.formats ?? {}), hls };
      const updated = await files().update({ where: { id: file.id }, data: { formats } });
      if (!updated) {
        await rm(finalAbs, { recursive: true, force: true });
        throw new ConversionError(
          `hls-video: file ${file.id} was deleted during conversion`,
          false
        );
      }

      await deleteOutputsForFile(file.id, finalDir);
      await strapi.eventHub.emit('media.update', { media: updated });

      return { outputDir: finalDir, durationMs: Date.now() - started };
    } catch (error) {
      await rm(tmpAbs, { recursive: true, force: true });
      if (error instanceof ConversionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) {
        if (interrupted) {
          throw new ConversionError('hls-video: conversion interrupted by shutdown', true);
        }
        throw new ConversionError(
          `hls-video: encode timed out after ${config.maxEncodeMinutes} min (${message})`,
          false
        );
      }
      throw new ConversionError(message, true);
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function removeOutputDir(dir: string): Promise<void> {
    await rm(path.join(uploadsRoot(), dir), { recursive: true, force: true });
  }

  return { run, deleteOutputsForFile, removeOutputDir };
}
