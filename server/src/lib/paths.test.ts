import { describe, expect, it } from 'vitest';
import { hlsUrl, outputDirName, tmpDirName, versionFromDirName } from './paths';

describe('paths', () => {
  it('builds directory names', () => {
    expect(outputDirName('abc_123', 2)).toBe('hls/abc_123-v2');
    expect(tmpDirName('abc_123', 2)).toBe('hls/.tmp-abc_123-v2');
  });

  it('builds public urls', () => {
    expect(hlsUrl('hls/abc-v1', 'master.m3u8')).toBe('/uploads/hls/abc-v1/master.m3u8');
  });

  it('parses the version back out of a dir name', () => {
    expect(versionFromDirName('abc_123-v7')).toBe(7);
    expect(versionFromDirName('abc_123')).toBeNull();
  });
});
