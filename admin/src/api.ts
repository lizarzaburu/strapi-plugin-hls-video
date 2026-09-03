import { useCallback, useMemo, useRef } from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import { PLUGIN_ID } from './pluginId';

export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface JobView {
  id: number;
  fileId: number;
  fileName: string | null;
  fileUrl: string | null;
  version: number;
  status: JobStatus;
  attempts: number;
  error: string | null;
  durationMs: number | null;
  updatedAt: string;
}

export interface WorkerState {
  running: boolean;
  busy: boolean;
  currentJobId: number | null;
  ffmpegAvailable: boolean;
  freeMemoryMb: number;
}

export interface HlsApi {
  listJobs: () => Promise<JobView[]>;
  status: () => Promise<WorkerState>;
  retry: (id: number) => Promise<JobView>;
}

export function useHlsApi(): HlsApi {
  // `useFetchClient()` returns a new `{ get, post, ... }` object on every
  // render, and `HomePage` calls `useHlsApi()` on every render too. Reading
  // `get`/`post` through a ref lets `listJobs`/`status`/`retry` keep a
  // stable identity (empty dep arrays) regardless of that, so the object
  // this hook returns is stable across renders — the polling `useEffect` in
  // `HomePage` depends on it and must only run once per mount.
  const client = useFetchClient();
  const clientRef = useRef(client);
  clientRef.current = client;

  const listJobs = useCallback(
    async () => (await clientRef.current.get<{ data: JobView[] }>(`/${PLUGIN_ID}/jobs`)).data.data,
    []
  );

  const status = useCallback(
    async () =>
      (await clientRef.current.get<{ data: WorkerState }>(`/${PLUGIN_ID}/status`)).data.data,
    []
  );

  const retry = useCallback(
    async (id: number) =>
      (await clientRef.current.post<{ data: JobView }>(`/${PLUGIN_ID}/jobs/${id}/retry`)).data.data,
    []
  );

  return useMemo(() => ({ listJobs, status, retry }), [listJobs, status, retry]);
}
