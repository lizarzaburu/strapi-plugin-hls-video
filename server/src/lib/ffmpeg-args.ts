import type { EncodePlan, ProbeResult, Rendition } from './types';

const COMMON = ['-hide_banner', '-loglevel', 'error', '-y'];

export function probeArgs(input: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input];
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 100) / 100;
}

export function parseProbe(json: string): ProbeResult {
  const data = JSON.parse(json) as ProbeOutput;
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video || !video.width || !video.height) {
    throw new Error('hls-video: no video stream found in source');
  }
  const duration = Number(data.format?.duration ?? 0);
  return {
    width: video.width,
    height: video.height,
    duration: Number.isFinite(duration) ? duration : 0,
    fps: parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

export interface TranscodeOptions {
  preset: string;
  threads: number;
  segmentSeconds: number;
  /** absolute directory for this rendition; must exist */
  outDir: string;
}

export function transcodeArgs(
  input: string,
  rendition: Rendition,
  plan: EncodePlan,
  opts: TranscodeOptions
): string[] {
  const audio = plan.hasAudio
    ? ['-c:a', 'aac', '-b:a', `${rendition.audioBitrate}k`, '-ac', '2']
    : ['-an'];

  return [
    ...COMMON,
    '-i',
    input,
    '-vf',
    `scale=${rendition.width}:${rendition.height}`,
    '-c:v',
    'libx264',
    '-preset',
    opts.preset,
    '-profile:v',
    'high',
    '-level',
    rendition.level,
    '-pix_fmt',
    'yuv420p',
    '-crf',
    String(rendition.crf),
    '-maxrate',
    `${rendition.maxrate}k`,
    '-bufsize',
    `${rendition.bufsize}k`,
    '-threads',
    String(opts.threads),
    '-g',
    String(plan.gop),
    '-keyint_min',
    String(plan.gop),
    '-sc_threshold',
    '0',
    ...audio,
    '-f',
    'hls',
    '-hls_time',
    String(opts.segmentSeconds),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    '-hls_flags',
    'independent_segments',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    `${opts.outDir}/seg_%03d.m4s`,
    `${opts.outDir}/index.m3u8`,
  ];
}

export function posterTime(duration: number): number {
  return duration >= 2 ? 1 : Math.max(0, duration / 2);
}

export function posterArgs(input: string, outFile: string, atSeconds: number): string[] {
  return [...COMMON, '-ss', String(atSeconds), '-i', input, '-frames:v', '1', '-q:v', '4', outFile];
}
