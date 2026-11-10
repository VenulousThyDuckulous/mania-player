# mania.player

A browser-based **osu!mania** beatmap player. Import `.osz` archives, pick a difficulty and play
with your keyboard or touchscreen. Everything runs locally: the archive is unzipped, parsed and
stored in IndexedDB in your own browser — no uploads, no server.

## Features

- **Import `.osz` / `.zip`** by drag and drop or the file picker (multiple files at once).
- **Stored in the browser** (IndexedDB) so your library survives reloads; covers are kept for the library view.
- **Native mania parsing** of `[General]`, `[Metadata]`, `[Difficulty]`, `[TimingPoints]`, `[Events]` and `[HitObjects]`, including long notes and per-column columns from `CircleSize`.
- **Real audio playback** decoded from the archive's own track, with pause, restart, scroll-speed, volume and hit-sound settings.
- **Canvas renderer** with scroll-velocity (SV) timing support, 320/300/200/100/50/MISS windows derived from OD, combo, accuracy and a `1,000,000`-point score scale.
- **Any key count** from 1K to 10K+, with sensible default key layouts (4K `D F J K`, 7K `S D F ␣ J K L`).
- **Autoplay** for previewing a chart, plus touch/pointer lane input.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # emits the static site into dist/
```

## Deployment

The build is a fully static site with relative asset paths (`base: './'`), so it can be served from
any subpath. `.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `main`.

One-time setup: repository **Settings → Pages → Build and deployment**, set **Source** to
*GitHub Actions*. After the workflow finishes the site is available at
`https://<user>.github.io/mania-player/`.

## Notes

- Beatmap archives are never transmitted anywhere; the audio is decoded with the Web Audio API.
- Browser storage can be cleared by the browser under storage pressure. The app asks for persistent
  storage after an import, but keeping your original `.osz` files is always a good idea.
- Beatmaps and their music belong to their respective creators.
