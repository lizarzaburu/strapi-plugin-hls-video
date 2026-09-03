# @lizarzaburu/strapi-plugin-hls-video

Strapi 5 plugin that converts videos uploaded to the Media Library into HLS (adaptive streaming, fMP4 segments) with a bundled ffmpeg. First-party: nothing leaves your server. Asynchronous: a queue with one worker, throttled to two threads, nothing resident between jobs.

## How it works

1. An editor uploads an MP4 to the Media Library (or replaces one).
2. The plugin enqueues a job and converts it in the background: 1080p / 720p / 480p (never upscaled), H.264 `preset fast`, 4-second fMP4 segments, AAC audio if the source has audio, a poster frame.
3. The result is written to the file's `formats.hls` and served from `public/uploads/hls/<hash>-v<n>/`:

```json
"formats": {
  "hls": {
    "url": "/uploads/hls/<hash>-v1/master.m3u8",
    "poster": "/uploads/hls/<hash>-v1/poster.jpg",
    "duration": 118.4, "width": 1920, "height": 1080,
    "hasAudio": true, "renditions": [1080, 720, 480], "version": 1,
    "generatedAt": "2026-09-03T12:00:00.000Z"
  }
}
```

4. Your frontend plays `formats.hls.url` when present (hls.js, native HLS on Safari) and falls back to the original file otherwise.

Deleting the file removes its HLS output. Replacing it creates a new version directory, so long cache lifetimes are safe.

## Install

```bash
pnpm add @lizarzaburu/strapi-plugin-hls-video
```

`config/plugins.ts`:

```ts
'hls-video': {
  enabled: true,
  config: {
    // all optional, defaults shown
    renditions: [1080, 720, 480],
    preset: 'fast',
    threads: 2,
    segmentSeconds: 4,
    pollIntervalMs: 10_000,
    minFreeMemoryMb: 1024,
    maxEncodeMinutes: 30,
    retries: 2,
    // ffmpegPath: '/usr/bin/ffmpeg', ffprobePath: '/usr/bin/ffprobe',
  },
},
```

Requirements: Strapi 5.50+, Node 20–22, the `local` upload provider, and CORS allowing your frontend origin (hls.js fetches playlists and segments). The ffmpeg/ffprobe binaries come from `ffmpeg-static` / `ffprobe-static`; no system package needed.

On macOS, `os.freemem()` reports only truly free pages, so for local development set `minFreeMemoryMb` low, e.g. `128`, or the worker never starts. On Linux hosts the value reflects available memory and the default is fine.

## Admin

Menu entry **HLS Video** lists all conversion jobs with status, encode time and errors, and offers "Convert again". Permissions per role under Plugins → HLS Video: *View conversion jobs*, *Re-run conversions*.

## Frontend example (hls.js)

```ts
const src = media.formats?.hls?.url ?? media.url
if (src.endsWith('.m3u8') && Hls.isSupported()) {
  const hls = new Hls({ capLevelToPlayerSize: true })
  hls.loadSource(src)
  hls.attachMedia(video)
} else {
  video.src = src
}
```

## Development

```bash
pnpm install
pnpm test        # unit + integration (uses the bundled ffmpeg)
pnpm typecheck
pnpm build       # or pnpm watch
pnpm verify      # before publishing
```

Link the `plugin` folder into a Strapi app as `src/plugins/hls-video` and register it with `resolve: './src/plugins/hls-video'`. Design notes: `docs/spec.md`.

## License

MIT
