import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from './config';

describe('normalizeConfig', () => {
  it('returns defaults for undefined input', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial overrides', () => {
    const cfg = normalizeConfig({ threads: 4, renditions: [720] });
    expect(cfg.threads).toBe(4);
    expect(cfg.renditions).toEqual([720]);
    expect(cfg.preset).toBe('fast');
  });

  it('rejects unknown renditions', () => {
    expect(() => normalizeConfig({ renditions: [1080, 999] })).toThrow(/renditions/);
  });

  it('rejects non-positive numbers', () => {
    expect(() => normalizeConfig({ threads: 0 })).toThrow(/threads/);
    expect(() => normalizeConfig({ pollIntervalMs: -1 })).toThrow(/pollIntervalMs/);
  });

  it('rejects an empty renditions list', () => {
    expect(() => normalizeConfig({ renditions: [] })).toThrow(/renditions/);
  });
});
