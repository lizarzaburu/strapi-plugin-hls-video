import { existsSync } from 'node:fs';
import ffmpegStaticPath from 'ffmpeg-static';
import { path as ffprobeStaticPath } from 'ffprobe-static';
import type { PluginConfig } from './config';

function resolve(configured: string | undefined, bundled: string | null): string | null {
  if (configured && existsSync(configured)) return configured;
  return bundled && existsSync(bundled) ? bundled : null;
}

export function resolveBinaries(config: PluginConfig): {
  ffmpeg: string | null;
  ffprobe: string | null;
} {
  return {
    ffmpeg: resolve(config.ffmpegPath, ffmpegStaticPath),
    ffprobe: resolve(config.ffprobePath, ffprobeStaticPath),
  };
}
