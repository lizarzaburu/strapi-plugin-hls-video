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

export function useHlsApi() {
  const { get, post } = useFetchClient();

  return {
    listJobs: async () => (await get<{ data: JobView[] }>(`/${PLUGIN_ID}/jobs`)).data.data,
    status: async () => (await get<{ data: WorkerState }>(`/${PLUGIN_ID}/status`)).data.data,
    retry: async (id: number) =>
      (await post<{ data: JobView }>(`/${PLUGIN_ID}/jobs/${id}/retry`)).data.data,
  };
}
