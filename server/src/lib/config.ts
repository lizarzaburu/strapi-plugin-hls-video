export const RENDITION_HEIGHTS = [1080, 720, 480] as const;
export type RenditionHeight = (typeof RENDITION_HEIGHTS)[number];

export interface PluginConfig {
  renditions: RenditionHeight[];
  preset: string;
  threads: number;
  segmentSeconds: number;
  pollIntervalMs: number;
  minFreeMemoryMb: number;
  maxEncodeMinutes: number;
  retries: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export const DEFAULT_CONFIG: PluginConfig = {
  renditions: [1080, 720, 480],
  preset: 'fast',
  threads: 2,
  segmentSeconds: 4,
  pollIntervalMs: 10_000,
  minFreeMemoryMb: 1024,
  maxEncodeMinutes: 30,
  retries: 2,
};

const POSITIVE_KEYS = [
  'threads',
  'segmentSeconds',
  'pollIntervalMs',
  'minFreeMemoryMb',
  'maxEncodeMinutes',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeConfig(input: unknown): PluginConfig {
  const raw = isRecord(input) ? input : {};
  const cfg: PluginConfig = { ...DEFAULT_CONFIG, renditions: [...DEFAULT_CONFIG.renditions] };

  if (raw.renditions !== undefined) {
    if (!Array.isArray(raw.renditions) || raw.renditions.length === 0) {
      throw new Error('hls-video: renditions must be a non-empty array');
    }
    for (const r of raw.renditions) {
      if (!RENDITION_HEIGHTS.includes(r as RenditionHeight)) {
        throw new Error(`hls-video: renditions may only contain ${RENDITION_HEIGHTS.join(', ')}`);
      }
    }
    cfg.renditions = [...(raw.renditions as RenditionHeight[])].sort((a, b) => b - a);
  }

  for (const key of POSITIVE_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`hls-video: ${key} must be a positive number`);
    }
    cfg[key] = value;
  }

  if (raw.retries !== undefined) {
    if (typeof raw.retries !== 'number' || raw.retries < 0 || !Number.isInteger(raw.retries)) {
      throw new Error('hls-video: retries must be a non-negative integer');
    }
    cfg.retries = raw.retries;
  }

  if (raw.preset !== undefined) {
    if (typeof raw.preset !== 'string' || raw.preset.length === 0) {
      throw new Error('hls-video: preset must be a non-empty string');
    }
    cfg.preset = raw.preset;
  }

  for (const key of ['ffmpegPath', 'ffprobePath'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`hls-video: ${key} must be a string`);
    cfg[key] = value;
  }

  return cfg;
}
