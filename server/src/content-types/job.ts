export const jobSchema = {
  kind: 'collectionType',
  collectionName: 'hls_video_jobs',
  info: {
    singularName: 'job',
    pluralName: 'jobs',
    displayName: 'HLS Video Job',
    description: 'Conversion jobs created by the HLS Video plugin',
  },
  options: { draftAndPublish: false },
  pluginOptions: {
    'content-manager': { visible: false },
    'content-type-builder': { visible: false },
  },
  attributes: {
    fileId: { type: 'integer', required: true },
    fileHash: { type: 'string', required: true },
    version: { type: 'integer', required: true, default: 1 },
    status: {
      type: 'enumeration',
      enum: ['queued', 'processing', 'ready', 'failed'],
      default: 'queued',
      required: true,
    },
    attempts: { type: 'integer', default: 0, required: true },
    error: { type: 'text' },
    outputDir: { type: 'string' },
    notBefore: { type: 'datetime' },
    startedAt: { type: 'datetime' },
    finishedAt: { type: 'datetime' },
    durationMs: { type: 'integer' },
  },
} as const;
