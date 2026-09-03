import type { PluginConfig } from './config';
import type { EncodePlan, ProbeResult, Rendition } from './types';

interface Preset {
  crf: number;
  maxrate: number;
  bufsize: number;
  level: string;
  audioBitrate: number;
}

const PRESETS: Record<number, Preset> = {
  1080: { crf: 23, maxrate: 5000, bufsize: 10000, level: '4.0', audioBitrate: 128 },
  720: { crf: 24, maxrate: 2800, bufsize: 5600, level: '3.1', audioBitrate: 128 },
  480: { crf: 26, maxrate: 1400, bufsize: 2800, level: '3.0', audioBitrate: 96 },
};

const FALLBACK_PRESET: Preset = PRESETS[480];

function evenWidth(sourceWidth: number, sourceHeight: number, targetHeight: number): number {
  const width = Math.round((sourceWidth * targetHeight) / sourceHeight);
  return width % 2 === 0 ? width : width + 1;
}

function makeRendition(
  probe: ProbeResult,
  height: number,
  preset: Preset,
  hasAudio: boolean
): Rendition {
  return {
    height,
    width: evenWidth(probe.width, probe.height, height),
    crf: preset.crf,
    maxrate: preset.maxrate,
    bufsize: preset.bufsize,
    level: preset.level,
    audioBitrate: hasAudio ? preset.audioBitrate : 0,
    dirName: `${height}p`,
  };
}

export function planRenditions(probe: ProbeResult, config: PluginConfig): EncodePlan {
  const hasAudio = probe.hasAudio;
  const heights = [...config.renditions].sort((a, b) => b - a).filter((h) => h <= probe.height);

  let renditions: Rendition[];
  if (heights.length > 0) {
    renditions = heights.map((h) => makeRendition(probe, h, PRESETS[h], hasAudio));
  } else {
    const height = probe.height % 2 === 0 ? probe.height : probe.height - 1;
    renditions = [makeRendition(probe, height, FALLBACK_PRESET, hasAudio)];
  }

  const fps = probe.fps > 0 && Number.isFinite(probe.fps) ? probe.fps : 25;
  return { renditions, hasAudio, gop: Math.round(fps * 2) };
}
