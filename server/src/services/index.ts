import type { Core } from '@strapi/strapi';
import service from './service';

type ServiceFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const services: Record<string, ServiceFactory> = {
  service,
};

export default services;
