import type {
  FindParams,
  LifecycleSubscriber,
  PermissionAction,
  QueryApi,
  StrapiLike,
} from '../lib/strapi-types';

type Row = Record<string, unknown>;

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in (expected as Row)) {
      return ((expected as Row).$in as unknown[]).includes(row[key]);
    }
    return row[key] === expected;
  });
}

function sortRows(rows: Row[], orderBy: FindParams['orderBy']): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy)
    ? orderBy.flatMap((o) => Object.entries(o))
    : Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = a[key] as string | number;
      const bv = b[key] as string | number;
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function makeQuery(table: Row[], nextId: () => number, now: () => string): QueryApi<Row> {
  return {
    async findOne(params) {
      return (
        sortRows(
          table.filter((r) => matches(r, params.where)),
          params.orderBy
        )[0] ?? null
      );
    },
    async findMany(params) {
      const rows = sortRows(
        table.filter((r) => matches(r, params.where)),
        params.orderBy
      );
      return params.limit ? rows.slice(0, params.limit) : rows;
    },
    async create({ data }) {
      const row: Row = { id: nextId(), createdAt: now(), updatedAt: now(), ...data };
      table.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = table.find((r) => matches(r, where));
      if (!row) throw new Error('row not found');
      Object.assign(row, data, { updatedAt: now() });
      return row;
    },
    async updateMany({ where, data }) {
      const rows = table.filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data, { updatedAt: now() }));
      return { count: rows.length };
    },
    async delete({ where }) {
      const index = table.findIndex((r) => matches(r, where));
      if (index === -1) return null;
      return table.splice(index, 1)[0];
    },
    async deleteMany({ where }) {
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i -= 1)
        if (matches(table[i], where)) table.splice(i, 1);
      return { count: before - table.length };
    },
  };
}

export interface FakeStrapi {
  strapi: StrapiLike;
  tables: Record<string, Row[]>;
  events: Array<{ name: string; payload: unknown }>;
  logs: string[];
  subscribers: LifecycleSubscriber[];
  permissions: PermissionAction[];
  services: Record<string, unknown>;
}

export function createFakeStrapi(opts: { publicDir?: string; config?: unknown } = {}): FakeStrapi {
  const tables: Record<string, Row[]> = {};
  const events: FakeStrapi['events'] = [];
  const logs: string[] = [];
  const subscribers: LifecycleSubscriber[] = [];
  const permissions: PermissionAction[] = [];
  const services: Record<string, unknown> = {};
  let id = 0;
  const nextId = () => (id += 1);
  // Monotonic clock so sequential creates within the same millisecond still
  // sort deterministically by createdAt/updatedAt.
  let clock = 0;
  const now = () => new Date(Date.now() + (clock += 1)).toISOString();
  const log = (level: string) => (msg: string) => logs.push(`${level}: ${msg}`);

  const strapi: StrapiLike = {
    db: {
      query<T>(uid: string) {
        tables[uid] ??= [];
        return makeQuery(tables[uid], nextId, now) as unknown as QueryApi<T>;
      },
      lifecycles: {
        subscribe(subscriber) {
          subscribers.push(subscriber);
          return () => subscribers.splice(subscribers.indexOf(subscriber), 1);
        },
      },
    },
    config: { get: (key) => (key === 'plugin::hls-video' ? opts.config : undefined) },
    dirs: { static: { public: opts.publicDir ?? '/nonexistent' } },
    log: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
    eventHub: { emit: (name, payload) => void events.push({ name, payload }) },
    plugin: () => ({ service: (name: string) => services[name] }),
    admin: {
      services: {
        permission: {
          actionProvider: { registerMany: async (actions) => void permissions.push(...actions) },
        },
      },
    },
  };

  return { strapi, tables, events, logs, subscribers, permissions, services };
}
