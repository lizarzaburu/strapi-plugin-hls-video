import type { Core } from '@strapi/strapi';
import { asStrapi } from '../lib/strapi-types';
import { createJobsService } from './jobs';

type ServiceFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const services: Record<string, ServiceFactory> = {
  jobs: ({ strapi }) =>
    createJobsService({ strapi: asStrapi(strapi) }) as unknown as Record<string, unknown>,
};

export default services;
