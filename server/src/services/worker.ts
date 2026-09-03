import os from 'node:os';
import { resolveBinaries } from '../lib/binaries';
import { normalizeConfig, type PluginConfig } from '../lib/config';
import { LocalFfmpegConverter } from '../lib/converter';
import { asStrapi, PLUGIN_NAME, type StrapiLike } from '../lib/strapi-types';
import { ConversionError, createConversionService, type ConversionService } from './conversion';
import { createJobsService, type JobsService } from './jobs';

export interface WorkerState {
  running: boolean;
  busy: boolean;
  currentJobId: number | null;
  ffmpegAvailable: boolean;
  freeMemoryMb: number;
}

export interface Worker {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<void>;
  state(): WorkerState;
  /** removes HLS output directories of a file; no-op without ffmpeg */
  cleanup(fileId: number): Promise<void>;
}

interface Deps {
  strapi: StrapiLike;
  jobs: JobsService;
  config: PluginConfig;
  conversion: ConversionService | null;
  freeMemoryMb?: () => number;
}

export function createWorker(deps: Deps): Worker {
  const { strapi, jobs, config, conversion } = deps;
  const freeMemoryMb = deps.freeMemoryMb ?? (() => Math.round(os.freemem() / 1024 / 1024));
  let interval: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let currentJobId: number | null = null;

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (!conversion) {
        const job = await jobs.claimNext();
        if (job) {
          await jobs.markFailure(job.id, 'hls-video: ffmpeg binary not available on this host', {
            retryable: false,
            retries: config.retries,
          });
          strapi.log.error(`hls-video: job ${job.id} failed, ffmpeg not available`);
        }
        return;
      }

      const free = freeMemoryMb();
      if (free < config.minFreeMemoryMb) {
        strapi.log.debug(
          `hls-video: skipping tick, free memory ${free} MB below ${config.minFreeMemoryMb} MB`
        );
        return;
      }

      const job = await jobs.claimNext();
      if (!job) return;
      currentJobId = job.id;
      strapi.log.info(`hls-video: converting file ${job.fileId} (job ${job.id}, v${job.version})`);
      try {
        const result = await conversion.run(job);
        await jobs.markReady(job.id, result);
        strapi.log.info(
          `hls-video: job ${job.id} ready in ${Math.round(result.durationMs / 1000)} s`
        );
      } catch (error) {
        const retryable = error instanceof ConversionError ? error.retryable : true;
        const message = error instanceof Error ? error.message : String(error);
        const row = await jobs.markFailure(job.id, message, { retryable, retries: config.retries });
        strapi.log.warn(
          `hls-video: job ${job.id} ${row.status} (attempt ${row.attempts}): ${message}`
        );
      }
    } finally {
      busy = false;
      currentJobId = null;
    }
  }

  return {
    async start() {
      const recovered = await jobs.recoverStale();
      if (recovered > 0) strapi.log.warn(`hls-video: requeued ${recovered} interrupted job(s)`);
      if (!conversion)
        strapi.log.error('hls-video: ffmpeg/ffprobe not found, conversions will fail');
      interval = setInterval(() => void tick(), config.pollIntervalMs);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
    tick,
    state: () => ({
      running: interval !== null,
      busy,
      currentJobId,
      ffmpegAvailable: conversion !== null,
      freeMemoryMb: freeMemoryMb(),
    }),
    cleanup: (fileId) => (conversion ? conversion.deleteOutputsForFile(fileId) : Promise.resolve()),
  };
}

/** Production wiring; the plugin's `worker` service. */
export function buildWorkerService({ strapi: raw }: { strapi: unknown }): Worker {
  const strapi = asStrapi(raw);
  const config = normalizeConfig(strapi.config.get(`plugin::${PLUGIN_NAME}`));
  const jobs = strapi.plugin(PLUGIN_NAME).service('jobs') as JobsService;
  const bins = resolveBinaries(config);
  const conversion =
    bins.ffmpeg && bins.ffprobe
      ? createConversionService({
          strapi,
          jobs,
          config,
          converter: new LocalFfmpegConverter({ ffmpeg: bins.ffmpeg, ffprobe: bins.ffprobe }),
        })
      : null;
  return createWorker({ strapi, jobs, config, conversion });
}
