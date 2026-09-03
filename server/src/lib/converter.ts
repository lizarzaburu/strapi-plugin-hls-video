import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  parseProbe,
  posterArgs,
  probeArgs,
  transcodeArgs,
  type TranscodeOptions,
} from './ffmpeg-args';
import type { EncodePlan, ProbeResult, Rendition } from './types';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  niceness?: number;
}

export type RunFn = (bin: string, args: string[], opts: RunOptions) => Promise<RunResult>;

const STDERR_LIMIT = 4000;

export const runProcess: RunFn = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal });
    if (opts.niceness !== undefined && child.pid) {
      try {
        os.setPriority(child.pid, opts.niceness);
      } catch {
        // not permitted on this host; run at normal priority
      }
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

export interface Converter {
  probe(input: string): Promise<ProbeResult>;
  transcode(
    input: string,
    rendition: Rendition,
    plan: EncodePlan,
    opts: TranscodeOptions,
    signal: AbortSignal
  ): Promise<void>;
  poster(input: string, outFile: string, atSeconds: number): Promise<void>;
}

export interface Binaries {
  ffmpeg: string;
  ffprobe: string;
}

const NICENESS = 19;

export class LocalFfmpegConverter implements Converter {
  constructor(
    private readonly bins: Binaries,
    private readonly run: RunFn = runProcess
  ) {}

  async probe(input: string): Promise<ProbeResult> {
    const result = await this.run(this.bins.ffprobe, probeArgs(input), { niceness: NICENESS });
    if (result.code !== 0) {
      throw new Error(`hls-video: ffprobe exit code ${result.code}: ${result.stderr.trim()}`);
    }
    return parseProbe(result.stdout);
  }

  async transcode(
    input: string,
    rendition: Rendition,
    plan: EncodePlan,
    opts: TranscodeOptions,
    signal: AbortSignal
  ): Promise<void> {
    const result = await this.run(this.bins.ffmpeg, transcodeArgs(input, rendition, plan, opts), {
      signal,
      niceness: NICENESS,
    });
    if (result.code !== 0) {
      throw new Error(
        `hls-video: ffmpeg exit code ${result.code} (${rendition.dirName}): ${result.stderr.trim()}`
      );
    }
  }

  async poster(input: string, outFile: string, atSeconds: number): Promise<void> {
    const result = await this.run(this.bins.ffmpeg, posterArgs(input, outFile, atSeconds), {
      niceness: NICENESS,
    });
    if (result.code !== 0) {
      throw new Error(`hls-video: ffmpeg poster exit code ${result.code}: ${result.stderr.trim()}`);
    }
  }
}
