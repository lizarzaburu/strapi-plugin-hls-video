import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config';

export default {
  default: DEFAULT_CONFIG,
  validator(config: unknown) {
    normalizeConfig(config);
  },
};
