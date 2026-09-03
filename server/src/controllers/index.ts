import type { Core } from '@strapi/strapi';

type ControllerFactory = ({ strapi }: { strapi: Core.Strapi }) => Record<string, unknown>;

const controllers: Record<string, ControllerFactory> = {};

export default controllers;
