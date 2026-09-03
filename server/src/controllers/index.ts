import type { Core } from '@strapi/strapi';
import { asStrapi } from '../lib/strapi-types';
import { createJobsController } from './jobs';

type ControllerFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const controllers: Record<string, ControllerFactory> = {
  jobs: ({ strapi }) =>
    createJobsController({ strapi: asStrapi(strapi) }) as unknown as Record<string, unknown>,
};

export default controllers;
