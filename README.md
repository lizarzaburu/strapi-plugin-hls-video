# @lizarzaburu/strapi-plugin-hls-video

Strapi 5 plugin that converts uploaded videos to HLS (adaptive streaming) with ffmpeg. First-party (no external video service), asynchronous (queued → processing → ready | failed), built for Strapi projects with a Nuxt frontend.

**Status:** in development, not yet published.

## Development

```bash
pnpm install
pnpm build      # or: pnpm watch
pnpm verify     # before publishing
```

Test against a Strapi app by linking this folder into `src/plugins/hls-video` and registering it in `config/plugins.ts`:

```ts
'hls-video': { enabled: true, resolve: './src/plugins/hls-video' },
```

## License

MIT
