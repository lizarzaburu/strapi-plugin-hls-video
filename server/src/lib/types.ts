export interface ProbeResult {
  width: number;
  height: number;
  /** seconds */
  duration: number;
  fps: number;
  hasAudio: boolean;
}

export interface Rendition {
  height: number;
  /** even width derived from the source aspect ratio */
  width: number;
  crf: number;
  /** kbit/s */
  maxrate: number;
  /** kbit/s */
  bufsize: number;
  /** H.264 level string for -level and the CODECS attribute */
  level: string;
  /** kbit/s, 0 when the plan has no audio */
  audioBitrate: number;
  /** directory inside the output dir, e.g. "1080p" */
  dirName: string;
}

export interface EncodePlan {
  renditions: Rendition[];
  hasAudio: boolean;
  /** keyframe interval in frames */
  gop: number;
}

export interface HlsFormat {
  url: string;
  poster: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  renditions: number[];
  version: number;
  generatedAt: string;
}

export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface JobRow {
  id: number;
  fileId: number;
  fileHash: string;
  version: number;
  status: JobStatus;
  attempts: number;
  error: string | null;
  outputDir: string | null;
  notBefore: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UploadFile {
  id: number;
  name: string;
  hash: string;
  ext: string | null;
  mime: string;
  url: string;
  provider: string;
  formats: Record<string, unknown> | null;
}
