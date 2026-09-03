# Changelog

## 0.1.0 – 2026-09-03

- Convert uploaded videos to HLS (fMP4, 1080/720/480) in a throttled background worker.
- Write results to `formats.hls`, clean up on delete, re-convert on replace.
- Admin page "HLS Video" with job list, status and "Convert again"; permissions `read` and `retry`.
- Conversions are abortable: a per-job timeout is no longer retried, and stopping the
  worker (shutdown) requeues the in-flight job instead of failing it.
- The plugin cleans up cleanly if a file (or its job row) is deleted while a conversion
  is still running, instead of leaving orphaned output directories or writing to a
  vanished file.
- Job claiming is now atomic (`updateMany` on `status: queued`), so a second Strapi
  process can no longer double-claim the same job.
