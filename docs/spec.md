# Technical specification — strapi-plugin-hls-video

Status: v1 design, 2026-09-03. Scope: what the plugin does, its data model, configuration, encoding, delivery and admin UI. Rationale for the decisions lives outside this repo (agency knowledge base).

## Goal

Editors upload MP4 files to the Strapi Media Library as usual. The plugin detects video uploads, converts them asynchronously to HLS (adaptive bitrate, fMP4 segments) with a bundled ffmpeg, writes the result back onto the file and serves it from Strapi's `public/uploads`. Frontends read one field, `formats.hls`, and fall back to the original MP4 while conversion is pending or failed.

Constraints: first-party only (no external video service), zero per-video work for developers, safe to run on shared hosting (throttled CPU, bounded RAM, nothing resident between jobs).

## Detection (lifecycles on `plugin::upload.file`)

Registered in `bootstrap` via `strapi.db.lifecycles.subscribe({ models: ['plugin::upload.file'] })`:

| Event                          | Condition                                                    | Action                                                                                    |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `afterCreate`                  | `mime` starts with `video/`                                  | enqueue job `{ fileId, hash, version: 1 }`                                                |
| `afterUpdate`                  | `mime` is video and the update payload contains a `hash` key | enqueue job with `version + 1`; previous output dir is deleted after the new one is ready |
| `beforeDelete` / `afterDelete` | any video                                                    | cancel pending job, delete every `hls/<hash>-v*` directory of that file                   |

The `afterUpdate` trigger keys on the _presence_ of `hash` in the payload, not its value:
Strapi's own upload service (`replace()`) deliberately keeps the original hash so the
file's URL doesn't change when it's replaced, but it always sends `hash` along with the
rest of the file's info in that same update — while a metadata-only edit
(`updateFileInfo()`: rename, alt text, caption, folder move, ...) never includes `hash` at
all, and the plugin's own post-conversion write only ever sends `formats`. So a `hash` key
in the payload reliably means "this is a replace", even though its value never actually
differs from before.

**Known coupling:** this detection relies on internal, undocumented behaviour of
`@strapi/upload`'s `replace()`/`updateFileInfo()` implementation (which fields each one
sends), not on a public Strapi API. Re-check it against the actual `@strapi/upload` source
on any Strapi upgrade.

Files uploaded before the plugin was installed are not converted retroactively in v1.

## Data model

### Job collection `plugin::hls-video.job`

Hidden from the Content Manager (`pluginOptions.content-manager.visible = false`), no draft/publish, no i18n.

| Field                     | Type                                           | Notes                                                 |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `fileId`                  | integer, indexed                               | id of `plugin::upload.file`                           |
| `fileHash`                | string                                         | hash at enqueue time; identifies the source version   |
| `version`                 | integer                                        | output directory suffix, increments per re-conversion |
| `status`                  | enum `queued \| processing \| ready \| failed` |                                                       |
| `attempts`                | integer                                        | automatic retries: 2 (3 runs total)                   |
| `error`                   | text                                           | last ffmpeg/plugin error, truncated to 2000 chars     |
| `outputDir`               | string                                         | relative to `public/uploads`, e.g. `hls/<hash>-v2`    |
| `startedAt`, `finishedAt` | datetime                                       |                                                       |
| `durationMs`              | integer                                        | encode wall time                                      |

### Result on the file (`formats.hls`)

Written with `strapi.db.query('plugin::upload.file').update` so no upload-plugin side effects run. Shape:

```json
{
  "hls": {
    "url": "/uploads/hls/<hash>-v1/master.m3u8",
    "poster": "/uploads/hls/<hash>-v1/poster.jpg",
    "duration": 118.4,
    "width": 1920,
    "height": 1080,
    "hasAudio": true,
    "renditions": [1080, 720, 480],
    "version": 1,
    "generatedAt": "2026-09-03T12:00:00.000Z"
  }
}
```

Other keys in `formats` are preserved (videos normally have none). URLs are relative like every other upload URL; consumers absolutize them the same way they do for images.

After a successful write the plugin emits `strapi.eventHub.emit('media.update', { media: file })` so configured webhooks (frontend revalidation) fire.

## Queue and worker

- Poll loop started in `bootstrap` (`setInterval`, default 10 s), stopped in `destroy`. Concurrency 1 per Strapi process.
- On boot every job in `processing` is reset to `queued` (the process may have been killed mid-encode by a deploy).
- Before starting a job: if `os.freemem()` < `minFreeMemoryMb` (default 1024), skip this tick and log at debug level. If the ffmpeg binary is missing, mark the job `failed` immediately with a clear message.
- A job runs `probe → transcode renditions sequentially → poster → write master playlist check → update file → emit event`. Output is written to a temp directory `hls/.tmp-<hash>-v<n>` and renamed to its final name only when complete, so the public directory never contains a half-finished set.
- Failure: increment `attempts`, keep `queued` until attempts are exhausted, then `failed`. Retry delay 60 s × attempts.
- Timeouts: a single ffmpeg run is killed after `maxEncodeMinutes` (default 30) and counts as a failure.
- Child processes are spawned with `os.setPriority(pid, 19)` (nice) — the coreutils `nice` binary is not available on all hosts.

## Converter interface

```ts
interface Converter {
  probe(
    input: string,
    signal: AbortSignal
  ): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }>;
  transcode(input: string, outDir: string, plan: EncodePlan, signal: AbortSignal): Promise<void>;
  poster(input: string, outFile: string, atSeconds: number, signal: AbortSignal): Promise<void>;
}
```

v1 ships `LocalFfmpegConverter` (ffmpeg-static + ffprobe-static). The interface exists so a remote worker can be added later without touching the queue.

Every step (probe, each rendition's transcode, poster) receives the same `AbortSignal`,
combining two abort sources: the per-job `maxEncodeMinutes` timeout and an external signal
the queue worker aborts on `stop()` (process shutdown). A timeout is not retried
(`ConversionError(..., false)`); a shutdown-triggered abort requeues the job unchanged
(`jobs.requeue`, no attempt penalty) so boot recovery re-runs it next start. Job source
paths are resolved and required to stay inside `public/uploads/`; anything else is a
non-retryable error.

## Encoding

Rendition ladder, filtered by source height (no upscaling; a 720p source gets 720 + 480):

| Rendition | Scale     | CRF | Max rate / buf | Audio                  |
| --------- | --------- | --- | -------------- | ---------------------- |
| 1080p     | `-2:1080` | 23  | 5000k / 10000k | AAC 128k if `hasAudio` |
| 720p      | `-2:720`  | 24  | 2800k / 5600k  | AAC 128k if `hasAudio` |
| 480p      | `-2:480`  | 26  | 1400k / 2800k  | AAC 96k if `hasAudio`  |

Common flags: `libx264 -preset fast -profile:v high -pix_fmt yuv420p -threads 2 -g 48 -keyint_min 48 -sc_threshold 0` (2 s GOP at 24 fps; GOP derived from probed fps × 2), `-movflags +faststart` not needed for HLS.

Renditions are encoded **one after another**, each as its own ffmpeg run producing `<name>/index.m3u8` + `<name>/seg_%03d.m4s` with `-f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments -hls_fmp4_init_filename init.mp4`. The plugin then writes `master.m3u8` itself (BANDWIDTH from the rendition's real average bitrate, RESOLUTION, CODECS `avc1.640028,mp4a.40.2` or video-only). Writing the master ourselves keeps the sequential encode simple and lets us order renditions highest-first (Safari picks the first entry on start).

Poster: `-ss 1 -frames:v 1 -q:v 4 poster.jpg`, at the video's midpoint if duration < 2 s.

Output layout:

```
public/uploads/hls/<hash>-v<n>/
  master.m3u8
  poster.jpg
  1080p/index.m3u8, init.mp4, seg_000.m4s …
  720p/…
  480p/…
```

## Delivery

Files are served by Strapi's static middleware from `public/uploads` like any upload (on the agency hosting `public/uploads` is a symlink into a shared directory that survives deploys). Requirements on the host project, both already part of the agency base setup:

- `strapi::cors` must allow the frontend origin (hls.js fetches playlists and segments with XHR/fetch).
- Long cache headers on uploads are safe because every conversion gets a new versioned directory.

MIME types come from the static middleware's mime database: `.m3u8` → `application/vnd.apple.mpegurl`, `.m4s` → `video/iso.segment`, `.mp4` → `video/mp4`.

## Configuration (`config/plugins.ts`)

```ts
'hls-video': {
  enabled: true,
  config: {
    renditions: [1080, 720, 480],   // subset allowed
    preset: 'fast',
    threads: 2,
    segmentSeconds: 4,
    pollIntervalMs: 10_000,
    minFreeMemoryMb: 1024,
    maxEncodeMinutes: 30,
    retries: 2,
    ffmpegPath: undefined,          // override ffmpeg-static
    ffprobePath: undefined,
  },
},
```

All keys optional; the validator rejects unknown renditions and non-positive numbers.

## Admin UI

Menu entry "HLS Video" (icon: play). One page: table of jobs, newest first — file name (link to Media Library entry), status badge, renditions, duration, encode time, error (expandable), created/finished. Row action "Convert again" (creates a new job with `version + 1`). Page header shows worker state (idle / processing `<file>`), ffmpeg availability and free memory. Polls every 5 s while the tab is open.

Permission `plugin::hls-video.read` (view page) and `plugin::hls-video.retry` (convert again), assignable per admin role.

Admin routes (`type: 'admin'`, policy `admin::isAuthenticatedAdmin` + permission checks): `GET /jobs`, `POST /jobs/:id/retry`, `GET /status`.

No content-api routes. Frontends read `formats.hls` from the media objects they already populate.

## Frontend contract

Type addition for media objects:

```ts
formats?: { hls?: { url: string; poster: string; duration: number; width: number; height: number; hasAudio: boolean; renditions: number[]; version: number } } | null
```

Playback rule: if `formats.hls?.url` exists, play HLS (hls.js preferred, native HLS on iOS Safari); otherwise play `media.url` (progressive MP4) with `poster` absent. Background mode: muted, loop, autoplay, respects `prefers-reduced-motion` and data saver. Inline mode: controls, sound.

## Testing

- Unit (Vitest): rendition ladder from probe data, ffmpeg argument builder, master playlist writer, job state machine (enqueue, retry, exhaustion, boot recovery), lifecycle filters (mime / hash change).
- Integration: convert a generated 3-second 1080p clip with the real binary, assert directory layout, playlist parsing and `formats.hls` shape. Skipped when `ffmpeg-static` is not installed.
- Manual on the host Strapi: upload, watch the admin page, replace, delete.

## Out of scope for v1

Subtitles/captions, thumbnail sprites, remote converter implementation, backfill of pre-existing videos, per-file profiles, DRM.
