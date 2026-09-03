import type { Core } from '@strapi/strapi';
import { asStrapi, PLUGIN_NAME } from './lib/strapi-types';
import { unregisterUploadLifecycles } from './services/lifecycles';
import type { Worker } from './services/worker';

const destroy = ({ strapi: raw }: { strapi: Core.Strapi }) => {
  const worker = asStrapi(raw).plugin(PLUGIN_NAME).service('worker') as Worker;
  unregisterUploadLifecycles();
  worker.stop();
};

export default destroy;
