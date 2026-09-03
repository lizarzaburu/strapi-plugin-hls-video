# Frontend integration — Nuxt (agency base setup)

Status: design, 2026-09-03. How a Nuxt 4 frontend built on the agency `nuxt-strapi-site` base consumes `formats.hls`. Generic parts (player rules, fallbacks) apply to any frontend; template-specific parts name the files of the base setup.

## Contract from the plugin

Every populated media object of a converted video carries:

```ts
formats.hls: {
  url: string        // /uploads/hls/<hash>-v<n>/master.m3u8 (relative; the API layer absolutizes)
  poster: string     // /uploads/hls/<hash>-v<n>/poster.jpg
  duration: number   // seconds
  width: number; height: number
  hasAudio: boolean
  renditions: number[]  // e.g. [1080, 720, 480]
  version: number
  generatedAt: string
}
```

While a conversion is queued, processing or failed, `formats.hls` is absent and the original file (`media.url`, `video/mp4`) is the only source.

## Player rules (`UiVideo`)

- Source selection: `formats.hls.url` if present, else `media.url` (progressive MP4). Poster: explicit poster prop → `formats.hls.poster` → none.
- hls.js first, native HLS only as fallback (iOS Safari). Reason: current Chrome plays HLS natively but starts on the lowest rendition; hls.js with `capLevelToPlayerSize: true` and `startLevel` at the highest allowed level starts sharp. Dynamic import so pages without video never load hls.js.
- Mode `background`: `muted`, `loop`, `playsinline`, no native controls, `object-cover`; start after the LCP window (`requestIdleCallback`); pause when scrolled out of view, resume when back; do not load the stream at all under `prefers-reduced-motion: reduce`, data saver or viewports below 768 px (poster only). Always render a visible pause/play toggle (WCAG 2.2.2: moving content longer than five seconds needs a user control).
- Mode `inline`: poster, native controls, click to start, `preload="none"`, manifest attached only when the element enters the viewport; segments load on play.
- Decorative background videos are `aria-hidden`; inline videos carry the media `alternativeText` as `aria-label` when set.
- Cross-origin: hls.js loads playlists and segments via XHR (or fetch); the Strapi CORS middleware must allow the frontend origin (already the case in the base setup via `CORS_ORIGINS`).

## Template changes (nuxt-strapi-site)

API (`templates/api`):
- `package.json`: dependency `@lizarzaburu/strapi-plugin-hls-video`, `pnpm.onlyBuiltDependencies` includes `ffmpeg-static`, `ffprobe-static` (pnpm ≥ 10 blocks build scripts otherwise; the binary download runs on the host during `pnpm install`, so the deploy target needs outbound HTTPS to GitHub).
- `config/plugins.ts`: `'hls-video': { enabled: true }`; local dev on macOS may set `config.minFreeMemoryMb` low because `os.freemem()` reports only truly free pages there.
- `scripts/generate-types.mjs`: emit `StrapiMediaHls` and type `formats` as `Partial<Record<StrapiMediaFormatKey, StrapiMediaFormat>> & { hls?: StrapiMediaHls } | null`.
- `src/utils/resolve-refs.ts`: absolutize `poster` in format entries in addition to `url`.
- New block `blocks.video`: `header` (partial), `video` (media, `videos`, required), `poster` (media, `images`, optional), `caption` (string), `settings` (partial). Registered in the page dynamic zone, populate service, admin views and labels. No external providers in v1.

App (`templates/app`):
- Dependency `hls.js`.
- `components/ui/UiVideo.vue` as described above; `UiStrapiMedia.vue` delegates `video/*` to `UiVideo` in background mode so the existing hero plays HLS without schema changes.
- `components/block/BlockVideo.vue`: header partial, `UiVideo` inline in a 16:9 frame, `caption` as `<figcaption>`; mapped in `BlockRenderer.vue`.
- Types regenerated (`pnpm types:app`).

## Rollout to an existing project

1. Publish the plugin to npm (first release: configure npm trusted publishing, tag `v0.1.0`).
2. API: add the dependency and the `onlyBuiltDependencies` entry, register the plugin, copy the generator/resolve-refs changes, add `blocks.video` (schema, DZ, populate, admin views), `pnpm cs:export`, `pnpm types:app`.
3. App: add `hls.js`, `UiVideo`, `UiStrapiMedia` delegation, `BlockVideo`, renderer mapping; `pnpm typecheck`.
4. Deploy API before App (additive schema); existing videos are not converted retroactively in v1 — re-upload or replace them once.
