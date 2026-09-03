# Changelog

## Unreleased

- Convert uploaded videos to HLS (fMP4, 1080/720/480) in a throttled background worker.
- Write results to `formats.hls`, clean up on delete, re-convert on replace.
- Admin page "HLS Video" with job list, status and "Convert again"; permissions `read` and `retry`.
