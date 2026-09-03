import type { EncodePlan, Rendition } from './types';

const LEVEL_TO_AVC1: Record<string, string> = {
  '3.0': 'avc1.64001E',
  '3.1': 'avc1.64001F',
  '4.0': 'avc1.640028',
  '4.1': 'avc1.640029',
};

export function codecString(level: string, hasAudio: boolean): string {
  const video = LEVEL_TO_AVC1[level] ?? 'avc1.640028';
  return hasAudio ? `${video},mp4a.40.2` : video;
}

export interface RenditionStats {
  rendition: Rendition;
  /** total bytes of init + segments */
  bytes: number;
}

export function buildMasterPlaylist(
  stats: RenditionStats[],
  plan: EncodePlan,
  duration: number
): string {
  const safeDuration = duration > 0 ? duration : 1;
  const ordered = [...stats].sort((a, b) => b.rendition.height - a.rendition.height);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];

  for (const { rendition, bytes } of ordered) {
    const average = Math.max(1, Math.round((bytes * 8) / safeDuration));
    const peak = Math.round(average * 1.1);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${average},RESOLUTION=${rendition.width}x${rendition.height},CODECS="${codecString(rendition.level, plan.hasAudio)}"`
    );
    lines.push(`${rendition.dirName}/index.m3u8`);
  }

  return `${lines.join('\n')}\n`;
}
