import type { Core } from '@strapi/strapi';
import controller from './controller';

type ControllerFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const controllers: Record<string, ControllerFactory> = {
  controller,
};

export default controllers;
