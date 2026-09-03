import { existsSync } from 'node:fs';
import type { PluginConfig } from './config';

function fromPackage(name: 'ffmpeg-static' | 'ffprobe-static'): string | null {
  try {
    // ffmpeg-static exports the path as default; ffprobe-static exports { path }.
    const mod = require(name) as string | { path?: string };
    const candidate = typeof mod === 'string' ? mod : (mod.path ?? null);
    return candidate && existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function resolveBinaries(config: PluginConfig): {
  ffmpeg: string | null;
  ffprobe: string | null;
} {
  const ffmpeg =
    config.ffmpegPath && existsSync(config.ffmpegPath)
      ? config.ffmpegPath
      : fromPackage('ffmpeg-static');
  const ffprobe =
    config.ffprobePath && existsSync(config.ffprobePath)
      ? config.ffprobePath
      : fromPackage('ffprobe-static');
  return { ffmpeg, ffprobe };
}
