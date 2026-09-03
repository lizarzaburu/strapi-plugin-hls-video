import type { Core } from '@strapi/strapi';

type ServiceFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const services: Record<string, ServiceFactory> = {};

export default services;
