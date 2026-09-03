import { describe, expect, it } from 'vitest';
import { parseProbe, posterArgs, posterTime, probeArgs, transcodeArgs } from './ffmpeg-args';
import { planRenditions } from './ladder';
import { DEFAULT_CONFIG } from './config';

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '30000/1001' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '118.400000' },
});

describe('probe', () => {
  it('builds ffprobe args', () => {
    expect(probeArgs('/in.mp4')).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      '/in.mp4',
    ]);
  });

  it('parses width, height, fps, duration and audio', () => {
    expect(parseProbe(PROBE_JSON)).toEqual({
      width: 1920,
      height: 1080,
      duration: 118.4,
      fps: 29.97,
      hasAudio: true,
    });
  });

  it('throws without a video stream', () => {
    expect(() => parseProbe(JSON.stringify({ streams: [], format: {} }))).toThrow(/video stream/);
  });
});

describe('transcodeArgs', () => {
  const probe = parseProbe(PROBE_JSON);
  const plan = planRenditions(probe, DEFAULT_CONFIG);
  const opts = { preset: 'fast', threads: 2, segmentSeconds: 4, outDir: '/out/1080p' };

  it('encodes one rendition as fMP4 HLS with audio', () => {
    const args = transcodeArgs('/in.mp4', plan.renditions[0], plan, opts);
    const joined = args.join(' ');
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'error', '-y']);
    expect(joined).toContain('-i /in.mp4');
    expect(joined).toContain('-vf scale=1920:1080');
    expect(joined).toContain(
      '-c:v libx264 -preset fast -profile:v high -level 4.0 -pix_fmt yuv420p'
    );
    expect(joined).toContain('-crf 23 -maxrate 5000k -bufsize 10000k -threads 2');
    expect(joined).toContain('-g 60 -keyint_min 60 -sc_threshold 0');
    expect(joined).toContain('-c:a aac -b:a 128k -ac 2');
    expect(joined).toContain('-f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4');
    expect(joined).toContain('-hls_flags independent_segments');
    expect(joined).toContain('-hls_fmp4_init_filename init.mp4');
    expect(joined).toContain('-hls_segment_filename /out/1080p/seg_%03d.m4s');
    expect(args[args.length - 1]).toBe('/out/1080p/index.m3u8');
  });

  it('drops audio when the plan has none', () => {
    const silent = planRenditions({ ...probe, hasAudio: false }, DEFAULT_CONFIG);
    const args = transcodeArgs('/in.mp4', silent.renditions[0], silent, opts);
    expect(args).toContain('-an');
    expect(args.join(' ')).not.toContain('-c:a');
  });
});

describe('poster', () => {
  it('takes the frame at 1s, or the midpoint of very short clips', () => {
    expect(posterTime(118.4)).toBe(1);
    expect(posterTime(1.5)).toBe(0.75);
  });

  it('builds poster args', () => {
    expect(posterArgs('/in.mp4', '/out/poster.jpg', 1)).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '1',
      '-i',
      '/in.mp4',
      '-frames:v',
      '1',
      '-q:v',
      '4',
      '/out/poster.jpg',
    ]);
  });
});
