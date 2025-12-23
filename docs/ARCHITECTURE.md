# RAI-Man Code Guide (Quick Architecture)

Ziel dieses Dokuments: Die wichtigsten Stellen im Code schnell auffindbar machen, damit du UI/Design, Gameplay-Features und Server-Integration ohne "Suchen im Nebel" anpassen kannst.

## Einstiegspunkte

- `index.html`: Container `#app` für Phaser Canvas und globale Styles.
- `src/main.ts`: Phaser GameConfig (Scale/Canvas-Sizing, Scenes-Reihenfolge).
- `src/scenes/BootScene.ts`: Startmenü, Background (Bild/Video), Buttons/Design, Animation-Preloads, Start der Musik.
- `src/scenes/GameScene.ts`: Haupt-Gameplay Loop (Player, Ghosts, Bomben/Boxes/Fruits, HUD, Campaign, Highscore Hooks, Vibe-Shift).

## Szenen (UI/Flow)

- `BootScene` (`src/scenes/BootScene.ts`)
  - Startmenü (Start/Settings/Leaderboard/Info).
  - Lädt Assets (Sprites, Sounds, Video), erstellt Animationen.
  - Startet Background-Music gemäß Settings und Browser Audio-Unlock Regeln.

- `SettingsScene` (`src/scenes/SettingsScene.ts`)
  - DOM-basierte Settings UI (scrollbar).
  - Persistiert Preferences (LocalStorage).
  - AI-Level Generierung + Liste gespeicherter generierter Levels.

- `LeaderboardScene` (`src/scenes/LeaderboardScene.ts`)
  - UI zum Anzeigen/Submitten von Highscores (Server + Offline Fallback).

- `InfoScene` (`src/scenes/InfoScene.ts`)
  - Statische, pflegbare Info Inhalte aus `src/ui/infoContent.ts`.

- `GameScene` (`src/scenes/GameScene.ts`)
  - Rendert Maze + Entities.
  - Enthält Gameplay-Objekte und Systems (Bomben, Früchte, Boxes, Vibe-Reorg, Highscore Flow).

- `CelebrationScene` (`src/scenes/CelebrationScene.ts`)
  - Winner Screen (Video + Winner-Song).

## Game/State Modules

- `src/game/userPrefs.ts`
  - Persistent Preferences im Browser (LocalStorage).
  - Settings: Mode (normal/vibe), Sound/Music, Username, AI-Mode, generierte Levels, Mobile Layout.

- `src/game/settings.ts`
  - Difficulty/Speed-Settings für Player/Ghosts.

- `src/game/appConfig.ts`
  - Game-Mode (`classic|vibe`), Seed, Vibe-Settings, URL-Sync (Query Params).

- `src/game/rng.ts`
  - Deterministischer RNG (für Vibe: Shifts/Events reproduzierbar per Seed).

- `src/game/backgroundMusic.ts`
  - Globaler Music-Controller (ein Track gleichzeitig).
  - Unterstützt Rotation ("rotieren") + Autoplay-Unlock Handling.

- `src/game/saveGame.ts`
  - Lokaler Save/Resume-Checkpoint (Campaign/Level).

## Level/Map

- `src/game/levels.ts`
  - Built-in Levels (Campaign + Original levels + Demo).
- `src/game/levelParser.ts`, `src/game/levelValidation.ts`
  - Parse/Validate der Level-Grids und Regeln (z.B. Wrap/Tunnel Konsistenz).
- `src/game/renderLevel.ts`
  - Wand/Pellet Rendering.

## Vibe Mode (Reorg Shifts)

- `src/game/vibeReorgShift.ts`
  - Mutationen am Tile-Grid + Fairness Checks (Connectivity/No-Softlock/Schutzbereiche).
- `src/game/vibePatchNotes.ts`
  - Deterministische Patch-Notes Texte (DE) für Overlay beim Shift.

## Highscore (Server + Fallback)

- Frontend: `src/game/highscoreApi.ts`, `src/scenes/LeaderboardScene.ts`, `src/scenes/GameScene.ts`
- Backend: `api/highscore.php`
  - Dateibasierte Persistenz in `data/highscores.json`
  - Rate-Limit in `data/ratelimit.json`
  - Siehe `data/README.md` für Deploy-Hinweise.

## Mobile Layout

Wichtig: Desktop-Optimierung darf unverändert bleiben, Mobile Layout greift nur über Settings.

- Setting: `UserPrefs.mobileLayout` in `src/game/userPrefs.ts` (`off|auto|on`).
- Canvas Sizing: `src/main.ts`
  - Bei Mobile Layout (auto/on) wird Phaser `Scale.RESIZE` verwendet (Viewport-Canvas).
  - Sonst Desktop-Default: `Scale.FIT` (800x600).
- Gameplay-Layout: `src/scenes/GameScene.ts`
  - Reserviert HUD-Bereich oben.
  - Touch-Controls werden (Portrait) unter/teilweise überlappend zum Grid platziert.
  - Landscape: Controls seitlich (mehr Spielfläche).

## Wo ändere ich das Design?

- Startmenü/Buttons: `src/scenes/BootScene.ts` (`createBackground`, Button Styles).
- Settings/Info/Leaderboard: DOM-Styles inline in den Scenes (einfach anpassbar).
- Gameplay HUD: `src/scenes/GameScene.ts` (`setupHud`).
