import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Converter } from '../lib/converter';
import type { TranscodeOptions } from '../lib/ffmpeg-args';
import type { EncodePlan, ProbeResult, Rendition } from '../lib/types';

export interface FakeConverterOptions {
  probe?: ProbeResult;
  /** bytes written per rendition segment; keyed by dirName */
  bytes?: Record<string, number>;
  failOn?: string;
  /** resolve only when aborted (to test timeouts) */
  hang?: boolean;
}

export function createFakeConverter(
  opts: FakeConverterOptions = {}
): Converter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async probe() {
      calls.push('probe');
      return opts.probe ?? { width: 1920, height: 1080, duration: 10, fps: 25, hasAudio: true };
    },
    async transcode(
      _input: string,
      rendition: Rendition,
      _plan: EncodePlan,
      o: TranscodeOptions,
      signal: AbortSignal
    ) {
      calls.push(`transcode:${rendition.dirName}`);
      if (opts.hang) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      if (opts.failOn === rendition.dirName)
        throw new Error(`ffmpeg failed on ${rendition.dirName}`);
      await mkdir(o.outDir, { recursive: true });
      const size = opts.bytes?.[rendition.dirName] ?? 1000;
      await writeFile(
        path.join(o.outDir, 'index.m3u8'),
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-ENDLIST\n'
      );
      await writeFile(path.join(o.outDir, 'init.mp4'), Buffer.alloc(100));
      await writeFile(path.join(o.outDir, 'seg_000.m4s'), Buffer.alloc(size));
    },
    async poster(_input: string, outFile: string) {
      calls.push('poster');
      await writeFile(outFile, Buffer.alloc(10));
    },
  };
}
