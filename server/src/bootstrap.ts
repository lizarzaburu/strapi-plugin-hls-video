import type { Core } from '@strapi/strapi';
import { asStrapi, PLUGIN_NAME } from './lib/strapi-types';
import type { JobsService } from './services/jobs';
import { PERMISSIONS, registerUploadLifecycles } from './services/lifecycles';
import type { Worker } from './services/worker';

const bootstrap = async ({ strapi: raw }: { strapi: Core.Strapi }) => {
  const strapi = asStrapi(raw);
  await strapi.admin.services.permission.actionProvider.registerMany(PERMISSIONS);

  const plugin = strapi.plugin(PLUGIN_NAME);
  const jobs = plugin.service('jobs') as JobsService;
  const worker = plugin.service('worker') as Worker;

  registerUploadLifecycles({ strapi, jobs, cleanup: (fileId) => worker.cleanup(fileId) });
  await worker.start();
};

export default bootstrap;
