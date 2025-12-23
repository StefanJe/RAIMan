# RAI-Man

RAI-Man is a Pac-Man style game with classic gameplay, a Vibe mode (seeded shifts), and an optional FPS view.
This repo contains the full source, build scripts, and a ready-to-upload release folder.

## Quick Start

```bash
npm install
npm run dev
```

Open the dev server URL shown by Vite.

## Build

```bash
npm run build
```

Vite outputs to `dist/`.

## Release (public_html)

The folder `release/public_html/` is the deployment payload.
It contains:
- `index.html`, `favicon.ico`, `assets/*` (from `dist/`)
- `api/highscore.php` (server endpoint)
- `data/` (README only; live JSON files are created on the server)

PowerShell helper:

```bash
scripts/release.ps1
```

Options:
- `scripts/release.ps1 -NoBuild` (sync only)
- `scripts/release.ps1 -Zip` (also create ZIP)

Server note: delete the remote `assets/` folder (or use mirror upload) to avoid stale `assets/index-*.js` files.

## Highscore Backend

`api/highscore.php` stores scores in `data/highscores.json` and rate limits in `data/ratelimit.json`.
Before deploy, set an env var:

```
HIGHSCORE_SALT=your-strong-random-value
```

## Project Structure (short)

- `src/main.ts`: Phaser setup and scene wiring
- `src/scenes/BootScene.ts`: start menu, assets, music
- `src/scenes/GameScene.ts`: main gameplay loop, HUD, Vibe shifts, FPS mode
- `src/scenes/SettingsScene.ts`: DOM settings UI (persists to localStorage)
- `src/game/*`: gameplay logic, RNG, levels, music controller
- `src/ui/*`: HUD, FPS renderer, UI assets

## Notes

- FPS view can be toggled in the main menu and in Settings (stored in user prefs).
- Vibe mode uses deterministic seeds; shareable seeds are shown in Settings.
