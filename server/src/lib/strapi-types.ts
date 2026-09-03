export interface FindParams {
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
  limit?: number;
  select?: string[];
}

export interface QueryApi<T> {
  findOne(params: FindParams): Promise<T | null>;
  findMany(params: FindParams): Promise<T[]>;
  create(params: { data: Partial<T> }): Promise<T>;
  update(params: { where: Record<string, unknown>; data: Partial<T> }): Promise<T | null>;
  updateMany(params: {
    where: Record<string, unknown>;
    data: Partial<T>;
  }): Promise<{ count: number }>;
  delete(params: { where: Record<string, unknown> }): Promise<T | null>;
  deleteMany(params: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface LifecycleEvent {
  action: string;
  model: { uid: string };
  params: { where?: Record<string, unknown>; data?: Record<string, unknown> };
  result?: unknown;
  state: Record<string, unknown>;
}

export interface LifecycleSubscriber {
  models: string[];
  afterCreate?(event: LifecycleEvent): Promise<void> | void;
  beforeUpdate?(event: LifecycleEvent): Promise<void> | void;
  afterUpdate?(event: LifecycleEvent): Promise<void> | void;
  beforeDelete?(event: LifecycleEvent): Promise<void> | void;
  afterDelete?(event: LifecycleEvent): Promise<void> | void;
}

export interface PermissionAction {
  section: 'plugins';
  displayName: string;
  uid: string;
  pluginName: string;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface StrapiLike {
  db: {
    query<T>(uid: string): QueryApi<T>;
    lifecycles: { subscribe(subscriber: LifecycleSubscriber): () => void };
  };
  config: { get(key: string): unknown };
  dirs: { static: { public: string } };
  log: Logger;
  eventHub: { emit(name: string, payload: unknown): Promise<void> | void };
  plugin(name: string): { service(name: string): unknown };
  admin: {
    services: {
      permission: { actionProvider: { registerMany(actions: PermissionAction[]): Promise<void> } };
    };
  };
}

export const JOB_UID = 'plugin::hls-video.job';
export const FILE_UID = 'plugin::upload.file';
export const PLUGIN_NAME = 'hls-video';

/** The real Strapi object is much wider; we only ever touch this surface. */
export function asStrapi(strapi: unknown): StrapiLike {
  return strapi as StrapiLike;
}
