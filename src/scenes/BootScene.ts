import Phaser from "phaser";
import { CAMPAIGN_LEVELS } from "../game/levels";
import { getAppConfig, getEffectiveSeed, initAppConfigFromUrl, setGameMode, type GameMode } from "../game/appConfig";
import { getSettings, setDifficulty, type Difficulty, type GameSettings } from "../game/settings";
import { clearSavedGame, loadSavedGame, type SavedGameV1 } from "../game/saveGame";
import { getUserPrefs, updateUserPrefs } from "../game/userPrefs";
import { setBackgroundMusic } from "../game/backgroundMusic";
import { ROTATE_TRACK_ID } from "../game/musicTracks";

const isDev = import.meta.env.DEV;

/**
 * BootScene DESIGN helpers
 * - Add background images via `BOOT_BACKGROUND_IMAGES` (preloaded automatically).
 * - Adjust positions via `BOOT_LAYOUT` without digging through logic.
 */
type AnchorX = "left" | "center" | "right";
type AnchorY = "top" | "center" | "bottom";

type FitMode = "cover" | "contain" | "stretch";

interface BackgroundImageSpec {
  /** Unique texture key. */
  key: string;
  /** URL relative to this file (same style as existing assets). Example: "../ui/backgrounds/boot_bg.png" */
  url: string;
  fit?: FitMode;
  /** Additional scale multiplier (e.g. 0.85 to make it smaller). Default: 1. */
  scale?: number;
  /** Normalized position (0..1). Defaults to center. */
  x?: number;
  y?: number;
  offsetX?: number;
  offsetY?: number;
  originX?: number;
  originY?: number;
  alpha?: number;
  tint?: number;
}

interface BackgroundVideoSpec {
  /** Unique video cache key. */
  key: string;
  /** URL relative to this file. Example: "../ui/media/BackgroundStart.mp4" */
  url: string;
  fit?: FitMode;
  /** Additional scale multiplier (e.g. 0.85 to make it smaller). Default: 1. */
  scale?: number;
  /** Normalized position (0..1). Defaults to center. */
  x?: number;
  y?: number;
  offsetX?: number;
  offsetY?: number;
  originX?: number;
  originY?: number;
  alpha?: number;
}

// Add your BootScene background images here (optional).
// Ensure files live under `src/ui/...` so Vite can bundle them.
const BOOT_BACKGROUND_IMAGES: BackgroundImageSpec[] = [
  // { key: "boot-bg", url: "../ui/backgrounds/boot_bg.png", fit: "cover", x: 0.5, y: 0.5, alpha: 1 }
];

// Optional: background video (muted + looped for autoplay-friendliness).
const BOOT_BACKGROUND_VIDEO: BackgroundVideoSpec | null = {
  key: "boot-bg-video",
  url: "../ui/media/BackgroundStart.mp4",
  fit: "cover",
  scale: 0.5,
  x: 0.5,
  y: 0.5,
  alpha: 0.85
};

interface PosSpec {
  anchorX: AnchorX;
  anchorY: AnchorY;
  offsetX: number;
  offsetY: number;
}

const BOOT_LAYOUT = {
  title: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: -150 } satisfies PosSpec,
  difficulty: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: -95 } satisfies PosSpec,
  hint: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: 210 } satisfies PosSpec,
  campaign: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: -10 } satisfies PosSpec,
  quick: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: 70 } satisfies PosSpec,
  settings: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: 132 } satisfies PosSpec,
  info: { anchorX: "center", anchorY: "center", offsetX: 0, offsetY: 176 } satisfies PosSpec,

  leaderboard: { anchorX: "left", anchorY: "top", offsetX: 12, offsetY: 10 } satisfies PosSpec,
  modeToggle: { anchorX: "right", anchorY: "top", offsetX: -12, offsetY: 10 } satisfies PosSpec,
  modeTooltip: { anchorX: "right", anchorY: "top", offsetX: -12, offsetY: 44 } satisfies PosSpec,

  // View toggle.
  viewToggle: { anchorX: "right", anchorY: "top", offsetX: -12, offsetY: 78 } satisfies PosSpec,
  viewTooltip: { anchorX: "right", anchorY: "top", offsetX: -12, offsetY: 112 } satisfies PosSpec,

  buttons: {
    quick: { width: 260, height: 54 },
    campaign: { width: 260, height: 64 }
  }
} as const;

function resolvePos(width: number, height: number, pos: PosSpec): { x: number; y: number } {
  const ax = pos.anchorX === "left" ? 0 : pos.anchorX === "center" ? 0.5 : 1;
  const ay = pos.anchorY === "top" ? 0 : pos.anchorY === "center" ? 0.5 : 1;
  return { x: ax * width + pos.offsetX, y: ay * height + pos.offsetY };
}

export class BootScene extends Phaser.Scene {
  /**
   * Boot / Start Menu scene.
   *
   * Responsibilities:
   * - Preload shared assets (spritesheets, SFX, songs, videos).
   * - Build the start screen UI (buttons, background, title).
   * - Start background music according to `UserPrefs` while respecting browser audio unlock rules.
   *
   * UI styling is intentionally "manual" (Graphics + Text) so it can be tweaked without CSS frameworks.
   */
  private settings: GameSettings = getSettings();
  private debugEnabled = false;
  private debugCampaignLevel: number | null = null;

  private backgroundVideo?: Phaser.GameObjects.Video;
  private backgroundImages: Array<{ spec: BackgroundImageSpec; view: Phaser.GameObjects.Image }> = [];
  private buttonBg?: Phaser.GameObjects.Graphics;
  private titleText?: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private startText?: Phaser.GameObjects.Text;
  private startZone?: Phaser.GameObjects.Zone;
  private campaignText?: Phaser.GameObjects.Text;
  private campaignZone?: Phaser.GameObjects.Zone;
  private settingsText?: Phaser.GameObjects.Text;
  private settingsZone?: Phaser.GameObjects.Zone;
  private infoText?: Phaser.GameObjects.Text;
  private infoZone?: Phaser.GameObjects.Zone;
  private difficultyText?: Phaser.GameObjects.Text;
  private modeToggle?: Phaser.GameObjects.Text;
  private modeTooltip?: Phaser.GameObjects.Text;
  private leaderboardText?: Phaser.GameObjects.Text;

  private viewMode: "topdown" | "fps" = "topdown";
  private viewToggle?: Phaser.GameObjects.Text;
  private viewTooltip?: Phaser.GameObjects.Text;

  private resumeOverlay?: Phaser.GameObjects.Container;
  private resumeBlocker?: Phaser.GameObjects.Zone;
  private resumePanelBg?: Phaser.GameObjects.Graphics;
  private resumeTitle?: Phaser.GameObjects.Text;
  private resumeBody?: Phaser.GameObjects.Text;
  private resumeBtnPrimary?: Phaser.GameObjects.Text;
  private resumeBtnSecondary?: Phaser.GameObjects.Text;
  private resumeZonePrimary?: Phaser.GameObjects.Zone;
  private resumeZoneSecondary?: Phaser.GameObjects.Zone;
  private resumeSaved?: SavedGameV1;

  private keys?: {
    one: Phaser.Input.Keyboard.Key;
    two: Phaser.Input.Keyboard.Key;
    three: Phaser.Input.Keyboard.Key;
    f9: Phaser.Input.Keyboard.Key;
    f10: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "BootScene" });
  }

  private syncSettingsFromStorage(): void {
    this.settings = getSettings();
    this.refreshDifficultyText();
  }

  preload(): void {
    const assetUrl = (relativeToThisFile: string) => new URL(relativeToThisFile, import.meta.url).toString();

    if (BOOT_BACKGROUND_VIDEO) {
      const url = assetUrl(BOOT_BACKGROUND_VIDEO.url);
      if (!this.cache.video.exists(BOOT_BACKGROUND_VIDEO.key)) {
        // Phaser loader typings support (key, urls?, noAudio?) only.
        this.load.video(BOOT_BACKGROUND_VIDEO.key, url);
      }
    }

    // BootScene background images (optional, for manual design).
    for (const bg of BOOT_BACKGROUND_IMAGES) {
      if (this.textures.exists(bg.key)) continue;
      this.load.image(bg.key, assetUrl(bg.url));
    }

    // Pac-Man move frames (4 directions x 4 frames).
    const pmDirs = ["top", "right", "bottom", "left"] as const;
    for (const dir of pmDirs) {
      for (let i = 1; i <= 4; i++) {
        const key = `pacman-move-${dir}-${i}`;
        const url = assetUrl(`../ui/entities/pac-man/move/${dir}/pm_move_${dir}_${i}.png`);
        this.load.image(key, url);
      }
    }

    // Pac-Man death frames (12 frames).
    for (let i = 1; i <= 12; i++) {
      const key = `pacman-death-${i}`;
      const url = assetUrl(`../ui/entities/pac-man/death/pm_death_${i}.png`);
      this.load.image(key, url);
    }

    // Ghost frames (4 ghosts x 4 directions x 2 frames).
    const ghostNames = ["blinky", "pinky", "inky", "clyde"] as const;
    const ghostDirs = ["up", "right", "down", "left"] as const;
    for (const name of ghostNames) {
      for (const dir of ghostDirs) {
        for (let i = 1; i <= 2; i++) {
          const key = `ghost-${name}-${dir}-${i}`;
          const url = assetUrl(`../ui/entities/ghost/${name}/${name}_${dir}/${name}_${dir}_${i}.png`);
          this.load.image(key, url);
        }
      }
    }

    // Common ghost states.
    for (let i = 1; i <= 4; i++) {
      const key = `ghost-frightened-${i}`;
      const url = assetUrl(`../ui/entities/ghost/_common/exposed/ghost_exposed_${i}.png`);
      this.load.image(key, url);
    }
    for (const dir of ghostDirs) {
      const key = `ghost-dead-${dir}`;
      const url = assetUrl(`../ui/entities/ghost/_common/dead/dead_${dir}.png`);
      this.load.image(key, url);
    }

    this.load.image("ui-heart", assetUrl("../ui/entities/heart.png"));

    // Bombs
    this.load.image("obj-bomb", assetUrl("../ui/objects/bomb/bomb.png"));
    for (let i = 1; i <= 16; i++) {
      const key = `bomb-ignited-${i}`;
      const url = assetUrl(`../ui/objects/bomb/ignited/ignited_${i}.png`);
      this.load.image(key, url);
    }
    for (let i = 1; i <= 10; i++) {
      const key = `bomb-explosion-${i}`;
      const url = assetUrl(`../ui/objects/bomb/explosion/explosion_${i}.png`);
      this.load.image(key, url);
    }

    // Fruits
    this.load.image("fruit-apple", assetUrl("../ui/objects/fruits/apple.png"));
    this.load.image("fruit-cherry", assetUrl("../ui/objects/fruits/cherry.png"));
    this.load.image("fruit-melon", assetUrl("../ui/objects/fruits/melon.png"));
    this.load.image("fruit-orange", assetUrl("../ui/objects/fruits/orange.png"));
    this.load.image("fruit-strawberry", assetUrl("../ui/objects/fruits/strawberry.png"));

    // Boxes
    this.load.image("obj-box", assetUrl("../ui/objects/box/box.png"));

    // SFX
    this.load.audio("sfx-chomp", assetUrl("../ui/sounds/pacman_chomp.wav"));
    this.load.audio("sfx-death", assetUrl("../ui/sounds/pacman_death.wav"));
    this.load.audio("sfx-eatghost", assetUrl("../ui/sounds/pacman_eatghost.wav"));
    this.load.audio("sfx-explosion", assetUrl("../ui/sounds/explosion.wav"));
    this.load.audio("sfx-success", assetUrl("../ui/sounds/success.wav"));

    // Music
    this.load.audio("music-winner", assetUrl("../ui/sounds/last_game.wav"));

    // Celebration (winner screen)
    if (!this.cache.video.exists("celebration-video")) {
      const celebrateUrl = new URL("../ui/media/Celebrate.mp4", import.meta.url).toString();
      this.load.video("celebration-video", celebrateUrl, true);
    }
    if (!this.cache.audio.exists("music-celebration-winner")) {
      const winnerUrl = new URL("../ui/media/PacMan Christmas WINNER.mp3", import.meta.url).toString();
      this.load.audio("music-celebration-winner", winnerUrl);
    }
  }

  create(): void {
    if (isDev) console.log("[RAI-Man] BootScene create");
    this.cameras.main.setBackgroundColor(0x0b1020);

    // Always re-read persisted settings (so SettingsScene and BootScene stay in sync).
    this.settings = getSettings();

    const prefs = getUserPrefs();
    this.viewMode = prefs.viewMode === "fps" ? "fps" : "topdown";

    // Start background music on the start screen.
    // Note: Browsers often block WebAudio autoplay without a user gesture. Avoid trying to play while locked.
    const startMusicFromPrefs = () => {
      const p = getUserPrefs();
      setBackgroundMusic(this, p.musicEnabled ? p.musicTrackId || ROTATE_TRACK_ID : null);
    };
    if (!prefs.musicEnabled) {
      setBackgroundMusic(this, null);
    } else if (!this.sound.locked) {
      startMusicFromPrefs();
    } else {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, startMusicFromPrefs);
      this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
        try {
          this.sound.unlock();
        } catch {
          // ignore
        }
        startMusicFromPrefs();
      });
    }

    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    const hasModeParam = params.has("mode");

    this.debugEnabled = params.get("debug") === "1" || params.get("debug") === "true";
    this.debugCampaignLevel = (() => {
      const raw = params.get("campaign");
      if (!raw) return null;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) return null;
      if (n < 1 || n > CAMPAIGN_LEVELS.length) return null;
      return n;
    })();

    initAppConfigFromUrl();
    if (!hasModeParam) {
      // Default to user preference (Default: vibe).
      setGameMode(prefs.preferredMode === "vibe" ? "vibe" : "classic");
    }

    this.createEntityAnimations();
    this.createBackground();

    this.buttonBg = this.add.graphics().setDepth(0);

    this.titleText = this.add
      .text(0, 0, "RAI-Man", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "56px",
        color: "#e6f0ff"
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.difficultyText = this.add
      .text(0, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "18px",
        color: "#cfe0ff"
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.hintText = this.add
      .text(0, 0, "1/2/3: Schwierigkeit", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#9fb4d6"
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.startText = this.add
      .text(0, 0, "QUICK PLAY", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "22px",
        color: "#ffffff",
        fontStyle: "700"
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.startZone = this.add
      .zone(0, 0, 260, 64)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(3);

    this.campaignText = this.add
      .text(0, 0, "KAMPAGNE (1-9)", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "26px",
        color: "#ffffff",
        fontStyle: "700"
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.campaignZone = this.add
      .zone(0, 0, 260, 54)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(3);

    this.settingsText = this.add
      .text(0, 0, "EINSTELLUNGEN", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#e6f0ff",
        backgroundColor: "rgba(31, 58, 102, 0.55)",
        padding: { left: 12, right: 12, top: 8, bottom: 8 }
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });

    this.settingsZone = this.add
      .zone(0, 0, 240, 40)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(3);

    this.infoText?.destroy();
    this.infoText = this.add
      .text(0, 0, "INFO", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#e6f0ff",
        backgroundColor: "rgba(31, 58, 102, 0.55)",
        padding: { left: 12, right: 12, top: 8, bottom: 8 }
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });

    this.infoZone?.destroy();
    this.infoZone = this.add
      .zone(0, 0, 240, 40)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(3);

    this.leaderboardText?.destroy();
    this.leaderboardText = this.add
      .text(0, 0, "Leaderboard", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#e6f0ff",
        backgroundColor: "rgba(11, 16, 32, 0.65)",
        padding: { left: 8, right: 8, top: 6, bottom: 6 }
      })
      .setOrigin(0, 0)
      .setDepth(4000)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    this.modeToggle?.destroy();
    this.modeTooltip?.destroy();

    this.modeToggle = this.add
      .text(0, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "14px",
        color: "#e6f0ff",
        backgroundColor: "rgba(31, 58, 102, 0.75)",
        padding: { left: 10, right: 10, top: 6, bottom: 6 }
      })
      .setOrigin(1, 0)
      .setDepth(4000)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    this.modeTooltip = this.add
      .text(0, 0, "Wandel-Modus: Maze shiftet", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#061024",
        backgroundColor: "rgba(255, 211, 106, 0.95)",
        padding: { left: 8, right: 8, top: 6, bottom: 6 }
      })
      .setOrigin(1, 0)
      .setDepth(4001)
      .setScrollFactor(0)
      .setVisible(false);

    this.refreshModeToggle();

    this.modeToggle.on("pointerover", () => this.modeTooltip?.setVisible(true));
    this.modeToggle.on("pointerout", () => this.modeTooltip?.setVisible(false));
    this.modeToggle.on("pointerup", () => {
      const current = getAppConfig().mode;
      const next: GameMode = current === "vibe" ? "classic" : "vibe";
      setGameMode(next);
      this.refreshModeToggle();
    });

    this.viewToggle?.destroy();
    this.viewTooltip?.destroy();
    this.viewToggle = this.add
      .text(0, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "13px",
        color: "#e6f0ff",
        backgroundColor: "rgba(5, 10, 24, 0.75)",
        padding: { left: 10, right: 10, top: 6, bottom: 6 }
      })
      .setOrigin(1, 0)
      .setDepth(4000)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    this.viewTooltip = this.add
      .text(0, 0, "Kamera-Ansicht wechseln", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#061024",
        backgroundColor: "rgba(255, 211, 106, 0.95)",
        padding: { left: 8, right: 8, top: 6, bottom: 6 }
      })
      .setOrigin(1, 0)
      .setDepth(4001)
      .setScrollFactor(0)
      .setVisible(false);

    this.refreshViewToggle();
    this.viewToggle.on("pointerover", () => this.viewTooltip?.setVisible(true));
    this.viewToggle.on("pointerout", () => this.viewTooltip?.setVisible(false));
    this.viewToggle.on("pointerup", () => {
      this.viewMode = this.viewMode === "fps" ? "topdown" : "fps";
      this.refreshViewToggle();
      updateUserPrefs({ viewMode: this.viewMode });
    });

    const startQuick = () => {
      const cfg = getAppConfig();
      const settings = getSettings();
      const data: Record<string, unknown> = {
        settings,
        mode: cfg.mode,
        seed: cfg.seed,
        vibeSettings: cfg.vibe,
        viewMode: this.viewMode
      };
      this.scene.start("GameScene", data);
    };

    const startCampaign = () => {
      const cfg = getAppConfig();
      const data: Record<string, unknown> = {
        settings: getSettings(),
        mode: cfg.mode,
        seed: cfg.seed,
        vibeSettings: cfg.vibe,
        levelJson: CAMPAIGN_LEVELS[0],
        campaignIndex: 0,
        score: 0,
        lives: 5,
        viewMode: this.viewMode
      };
      this.scene.start("GameScene", data);
    };

    const openSettings = () => {
      this.scene.start("SettingsScene");
    };

    const openInfo = () => {
      this.scene.start("InfoScene", { from: "BootScene" });
    };

    const openLeaderboard = () => {
      const cfg = getAppConfig();
      const seed = cfg.mode === "vibe" ? getEffectiveSeed(cfg) : null;
      this.scene.start("LeaderboardScene", { mode: "all", scope: "all", seed });
    };

    this.startZone.on("pointerup", startQuick);
    this.campaignZone.on("pointerup", startCampaign);
    this.settingsZone?.on("pointerup", openSettings);
    this.settingsText?.on("pointerup", openSettings);
    this.infoZone?.on("pointerup", openInfo);
    this.infoText?.on("pointerup", openInfo);
    this.leaderboardText?.on("pointerup", openLeaderboard);

    this.setupKeys();
    this.refreshDifficultyText();
    this.refreshModeToggle();
    this.layout(this.scale.width, this.scale.height);

    // Debug: allow jumping into a specific campaign level via URL (?debug=1&campaign=9).
    if (this.debugEnabled && this.debugCampaignLevel !== null) {
      clearSavedGame();
      this.startCampaignAtIndex(this.debugCampaignLevel - 1);
      return;
    }

    this.maybeShowResumePrompt();

    // If this scene is kept alive (sleep/pause), keep difficulty UI synced with Settings.
    this.events.on(Phaser.Scenes.Events.WAKE, this.syncSettingsFromStorage, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.syncSettingsFromStorage, this);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.events.off(Phaser.Scenes.Events.WAKE, this.syncSettingsFromStorage, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.syncSettingsFromStorage, this);
      this.modeToggle?.destroy();
      this.modeTooltip?.destroy();
      this.viewToggle?.destroy();
      this.viewTooltip?.destroy();
      this.settingsText?.destroy();
      this.settingsZone?.destroy();
      this.infoText?.destroy();
      this.infoZone?.destroy();
      this.leaderboardText?.destroy();
      this.destroyResumeOverlay();
      this.backgroundVideo?.destroy();
      this.backgroundVideo = undefined;
      for (const bg of this.backgroundImages) bg.view.destroy();
      this.backgroundImages = [];
    });
  }

  private maybeShowResumePrompt(): void {
    const saved = loadSavedGame();
    if (!saved) return;
    this.showResumeOverlay(saved);
  }

  private showResumeOverlay(saved: SavedGameV1): void {
    this.destroyResumeOverlay();
    this.resumeSaved = saved;

    const depth = 9000;

    // Block all underlying input while the prompt is visible.
    this.resumeBlocker = this.add.zone(0, 0, 10, 10).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
    this.resumeBlocker.setInteractive({ useHandCursor: false });
    this.resumeBlocker.on("pointerdown", () => {
      // swallow
    });

    this.resumePanelBg = this.add.graphics().setDepth(depth + 1).setScrollFactor(0);

    this.resumeTitle = this.add
      .text(0, 0, "Letztes Spiel fortsetzen?", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "22px",
        color: "#e6f0ff",
        fontStyle: "800"
      })
      .setDepth(depth + 2)
      .setScrollFactor(0)
      .setOrigin(0.5, 0);

    const modeLabel = saved.mode === "vibe" ? "Vibe" : "Classic";
    const diffLabel = saved.difficulty === "easy" ? "easy" : saved.difficulty === "hard" ? "hard" : "normal";
    const livesLabel = `${saved.lives} Leben`;
    const scoreLabel = `Score ${saved.score}`;

    let levelLabel = "Level";
    if (saved.scope === "campaign" && typeof saved.campaignIndex === "number" && Number.isFinite(saved.campaignIndex)) {
      levelLabel = `Campaign Level ${saved.campaignIndex + 1}`;
    } else if (saved.levelJson.id) {
      levelLabel = saved.levelJson.id;
    }

    this.resumeBody = this.add
      .text(0, 0, `${levelLabel}\n${modeLabel} • Schwierigkeit: ${diffLabel}\n${scoreLabel} • ${livesLabel}`, {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "14px",
        color: "#9fb4d6",
        align: "center"
      })
      .setDepth(depth + 2)
      .setScrollFactor(0)
      .setOrigin(0.5, 0);

    this.resumeBtnPrimary = this.add
      .text(0, 0, "Fortsetzen", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#061024",
        backgroundColor: "rgba(124, 255, 178, 1)",
        padding: { left: 14, right: 14, top: 10, bottom: 10 }
      })
      .setDepth(depth + 2)
      .setScrollFactor(0)
      .setOrigin(0.5);

    this.resumeBtnSecondary = this.add
      .text(0, 0, "Neu starten", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#e6f0ff",
        backgroundColor: "rgba(31, 58, 102, 0.85)",
        padding: { left: 14, right: 14, top: 10, bottom: 10 }
      })
      .setDepth(depth + 2)
      .setScrollFactor(0)
      .setOrigin(0.5);

    this.resumeZonePrimary = this.add.zone(0, 0, 10, 10).setOrigin(0.5).setDepth(depth + 3).setScrollFactor(0);
    this.resumeZoneSecondary = this.add.zone(0, 0, 10, 10).setOrigin(0.5).setDepth(depth + 3).setScrollFactor(0);
    this.resumeZonePrimary.setInteractive({ useHandCursor: true });
    this.resumeZoneSecondary.setInteractive({ useHandCursor: true });

    this.resumeZonePrimary.on("pointerup", () => this.resumeFromSavedGame(saved));
    this.resumeBtnPrimary.on("pointerup", () => this.resumeFromSavedGame(saved));
    this.resumeZoneSecondary.on("pointerup", () => {
      clearSavedGame();
      this.destroyResumeOverlay();
    });
    this.resumeBtnSecondary.on("pointerup", () => {
      clearSavedGame();
      this.destroyResumeOverlay();
    });

    this.resumeOverlay = this.add.container(0, 0, [
      this.resumePanelBg,
      this.resumeTitle,
      this.resumeBody,
      this.resumeBtnPrimary,
      this.resumeBtnSecondary,
      this.resumeZonePrimary,
      this.resumeZoneSecondary
    ]);
    this.resumeOverlay.setDepth(depth + 1);
    this.resumeOverlay.setScrollFactor(0);

    this.layout(this.scale.width, this.scale.height);
  }

  private destroyResumeOverlay(): void {
    this.resumeOverlay?.destroy(true);
    this.resumeOverlay = undefined;
    this.resumeBlocker?.destroy();
    this.resumeBlocker = undefined;
    this.resumeSaved = undefined;
    this.resumePanelBg = undefined;
    this.resumeTitle = undefined;
    this.resumeBody = undefined;
    this.resumeBtnPrimary = undefined;
    this.resumeBtnSecondary = undefined;
    this.resumeZonePrimary = undefined;
    this.resumeZoneSecondary = undefined;
  }

  private resumeFromSavedGame(saved: SavedGameV1): void {
    const cfg = getAppConfig();

    // Apply saved difficulty + mode (kept in localStorage for consistency across UI).
    this.settings = setDifficulty(saved.difficulty);
    setGameMode(saved.mode);
    this.refreshDifficultyText();
    this.refreshModeToggle();

    let levelJson = saved.levelJson;
    let campaignIndex = saved.campaignIndex;
    if (saved.scope === "campaign" && typeof campaignIndex === "number" && Number.isFinite(campaignIndex)) {
      const lvl = CAMPAIGN_LEVELS[campaignIndex];
      if (lvl) levelJson = lvl;
      else campaignIndex = null;
    } else {
      campaignIndex = null;
    }

    const seed = saved.mode === "vibe" ? saved.seed : null;
    const data: Record<string, unknown> = {
      settings: this.settings,
      mode: saved.mode,
      seed,
      vibeSettings: cfg.vibe,
      levelJson,
      campaignIndex,
      score: saved.score,
      lives: saved.lives,
      runStartedAtMs: saved.runStartedAtMs,
      viewMode: this.viewMode
    };
    this.scene.start("GameScene", data);
  }

  update(): void {
    if (!this.keys) return;
    if (Phaser.Input.Keyboard.JustDown(this.keys.one)) this.setDifficulty("easy");
    if (Phaser.Input.Keyboard.JustDown(this.keys.two)) this.setDifficulty("normal");
    if (Phaser.Input.Keyboard.JustDown(this.keys.three)) this.setDifficulty("hard");

    // Debug shortcut: show winner / celebration screen.
    // Kept as a function key so it doesn't interfere with normal gameplay/typing.
    if (!this.resumeOverlay && Phaser.Input.Keyboard.JustDown(this.keys.f9)) {
      this.scene.start("CelebrationScene", { score: 12345 });
    }

    // Debug shortcut: jump into a specific campaign level.
    // Enabled only when `?debug=1` is present.
    if (this.debugEnabled && !this.resumeOverlay && Phaser.Input.Keyboard.JustDown(this.keys.f10)) {
      this.promptDebugCampaignLevel();
    }
  }

  private setupKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.keys = {
      one: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      f9: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F9),
      f10: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F10)
    };
  }

  private startCampaignAtIndex(campaignIndex: number): void {
    const idx = Math.max(0, Math.min(CAMPAIGN_LEVELS.length - 1, Math.floor(campaignIndex)));
    const levelJson = CAMPAIGN_LEVELS[idx];
    if (!levelJson) return;

    const cfg = getAppConfig();
    const data: Record<string, unknown> = {
      settings: getSettings(),
      mode: cfg.mode,
      seed: cfg.seed,
      vibeSettings: cfg.vibe,
      levelJson,
      campaignIndex: idx,
      score: 0,
      lives: 5,
      viewMode: this.viewMode
    };
    this.scene.start("GameScene", data);
  }

  private promptDebugCampaignLevel(): void {
    if (typeof window === "undefined") return;
    const total = CAMPAIGN_LEVELS.length;
    const defaultValue = String(this.debugCampaignLevel ?? 9);
    const raw = window.prompt(`Debug Campaign Level (1-${total}):`, defaultValue);
    if (!raw) return;
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > total) return;
    this.debugCampaignLevel = n;
    clearSavedGame();
    this.startCampaignAtIndex(n - 1);
  }

  private setDifficulty(difficulty: Difficulty): void {
    this.settings = setDifficulty(difficulty);
    this.refreshDifficultyText();
  }

  private refreshDifficultyText(): void {
    const label =
      this.settings.difficulty === "easy"
        ? "Easy (1)"
        : this.settings.difficulty === "hard"
          ? "Hard (3)"
          : "Normal (2)";
    this.difficultyText?.setText(`Pac Man Adaption for Changing Times\ngewählte Schwierigkeit: ${label}`);
  }

  private refreshModeToggle(): void {
    const mode = getAppConfig().mode;
    this.modeToggle?.setText(mode === "vibe" ? "Vibe Mode" : "Classic");
  }

  private refreshViewToggle(): void {
    if (!this.viewToggle) return;
    this.viewToggle.setText(this.viewMode === "fps" ? "View: FPS" : "View: Top-Down");
  }

  private createEntityAnimations(): void {
    const ensure = (key: string, create: () => void) => {
      if (this.anims.exists(key)) return;
      create();
    };

    const pmDirs = ["top", "right", "bottom", "left"] as const;
    for (const dir of pmDirs) {
      ensure(`pacman-move-${dir}`, () => {
        this.anims.create({
          key: `pacman-move-${dir}`,
          frames: Array.from({ length: 4 }, (_, i) => ({ key: `pacman-move-${dir}-${i + 1}` })),
          frameRate: 12,
          repeat: -1
        });
      });
    }

    ensure("pacman-death", () => {
      this.anims.create({
        key: "pacman-death",
        frames: Array.from({ length: 12 }, (_, i) => ({ key: `pacman-death-${i + 1}` })),
        frameRate: 12,
        repeat: 0
      });
    });

    const ghostNames = ["blinky", "pinky", "inky", "clyde"] as const;
    const ghostDirs = ["up", "right", "down", "left"] as const;
    for (const name of ghostNames) {
      for (const dir of ghostDirs) {
        ensure(`ghost-${name}-${dir}`, () => {
          this.anims.create({
            key: `ghost-${name}-${dir}`,
            frames: [{ key: `ghost-${name}-${dir}-1` }, { key: `ghost-${name}-${dir}-2` }],
            frameRate: 8,
            repeat: -1
          });
        });
      }
    }

    ensure("ghost-frightened", () => {
      this.anims.create({
        key: "ghost-frightened",
        frames: Array.from({ length: 4 }, (_, i) => ({ key: `ghost-frightened-${i + 1}` })),
        frameRate: 8,
        repeat: -1
      });
    });

    ensure("bomb-ignited", () => {
      this.anims.create({
        key: "bomb-ignited",
        frames: Array.from({ length: 16 }, (_, i) => ({ key: `bomb-ignited-${i + 1}` })),
        frameRate: 16,
        repeat: -1
      });
    });

    ensure("bomb-explosion", () => {
      this.anims.create({
        key: "bomb-explosion",
        frames: Array.from({ length: 10 }, (_, i) => ({ key: `bomb-explosion-${i + 1}` })),
        frameRate: 16,
        repeat: 0
      });
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layout(gameSize.width, gameSize.height);
  }

  private createBackground(): void {
    this.backgroundVideo?.destroy();
    this.backgroundVideo = undefined;

    if (BOOT_BACKGROUND_VIDEO && this.cache.video.exists(BOOT_BACKGROUND_VIDEO.key)) {
      const spec = BOOT_BACKGROUND_VIDEO;
      const video = this.add.video(0, 0, spec.key);
      video.setOrigin(spec.originX ?? 0.5, spec.originY ?? 0.5);
      video.setScrollFactor(0);
      video.setDepth(-20);
      video.setMute(true);
      if (typeof spec.alpha === "number") video.setAlpha(spec.alpha);
      // Try autoplay (muted), fallback to starting playback on first user input.
      try {
        video.play(true);
      } catch {
        // ignore autoplay failures
      }
      this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
        try {
          video.play(true);
        } catch {
          // ignore
        }
      });
      this.backgroundVideo = video;
    }

    for (const bg of this.backgroundImages) bg.view.destroy();
    this.backgroundImages = [];
    for (const spec of BOOT_BACKGROUND_IMAGES) {
      if (!this.textures.exists(spec.key)) continue;
      const img = this.add.image(0, 0, spec.key);
      img.setOrigin(spec.originX ?? 0.5, spec.originY ?? 0.5);
      img.setScrollFactor(0);
      img.setDepth(-10);
      if (typeof spec.alpha === "number") img.setAlpha(spec.alpha);
      if (typeof spec.tint === "number") img.setTint(spec.tint);
      this.backgroundImages.push({ spec, view: img });
    }
  }

  private layoutBackground(width: number, height: number): void {
    if (BOOT_BACKGROUND_VIDEO && this.backgroundVideo) {
      const spec = BOOT_BACKGROUND_VIDEO;
      const fit: FitMode = spec.fit ?? "cover";
      const scaleMultRaw = typeof spec.scale === "number" && Number.isFinite(spec.scale) ? spec.scale : 1;
      const scaleMult = Math.max(0.05, Math.min(3, scaleMultRaw));
      const x = (spec.x ?? 0.5) * width + (spec.offsetX ?? 0);
      const y = (spec.y ?? 0.5) * height + (spec.offsetY ?? 0);
      this.backgroundVideo.setPosition(x, y);

      const el = this.backgroundVideo.video ?? undefined;
      const vw = (el?.videoWidth || this.backgroundVideo.width) || 1;
      const vh = (el?.videoHeight || this.backgroundVideo.height) || 1;
      if (fit === "stretch") {
        this.backgroundVideo.setDisplaySize(width * scaleMult, height * scaleMult);
      } else {
        const sx = width / vw;
        const sy = height / vh;
        const s = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
        this.backgroundVideo.setScale(s * scaleMult);
      }
    }

    for (const { spec, view } of this.backgroundImages) {
      const fit: FitMode = spec.fit ?? "cover";
      const scaleMultRaw = typeof spec.scale === "number" && Number.isFinite(spec.scale) ? spec.scale : 1;
      const scaleMult = Math.max(0.05, Math.min(3, scaleMultRaw));
      const x = (spec.x ?? 0.5) * width + (spec.offsetX ?? 0);
      const y = (spec.y ?? 0.5) * height + (spec.offsetY ?? 0);
      view.setPosition(x, y);

      const tex = view.texture;
      const src = tex.getSourceImage() as { width?: number; height?: number } | undefined;
      const iw = (src?.width ?? view.width) || 1;
      const ih = (src?.height ?? view.height) || 1;

      if (fit === "stretch") {
        view.setDisplaySize(width * scaleMult, height * scaleMult);
      } else {
        const sx = width / iw;
        const sy = height / ih;
        const s = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
        view.setScale(s * scaleMult);
      }
    }
  }

  private layout(width: number, height: number): void {
    this.layoutBackground(width, height);

    const titlePos = resolvePos(width, height, BOOT_LAYOUT.title);
    const difficultyPos = resolvePos(width, height, BOOT_LAYOUT.difficulty);
    const hintPos = resolvePos(width, height, BOOT_LAYOUT.hint);
    const quickPos = resolvePos(width, height, BOOT_LAYOUT.quick);
    const campaignPos = resolvePos(width, height, BOOT_LAYOUT.campaign);
    const settingsPos = resolvePos(width, height, BOOT_LAYOUT.settings);
    const infoPos = resolvePos(width, height, BOOT_LAYOUT.info);
    const leaderboardPos = resolvePos(width, height, BOOT_LAYOUT.leaderboard);
    const modeTogglePos = resolvePos(width, height, BOOT_LAYOUT.modeToggle);
    const modeTooltipPos = resolvePos(width, height, BOOT_LAYOUT.modeTooltip);
    const viewTogglePos = resolvePos(width, height, BOOT_LAYOUT.viewToggle);
    const viewTooltipPos = resolvePos(width, height, BOOT_LAYOUT.viewTooltip);

    this.titleText?.setPosition(titlePos.x, titlePos.y);
    this.difficultyText?.setPosition(difficultyPos.x, difficultyPos.y);
    this.hintText?.setPosition(hintPos.x, hintPos.y);
    this.startText?.setPosition(quickPos.x, quickPos.y);
    this.startZone?.setPosition(quickPos.x, quickPos.y);
    this.campaignText?.setPosition(campaignPos.x, campaignPos.y);
    this.campaignZone?.setPosition(campaignPos.x, campaignPos.y);
    this.settingsText?.setPosition(settingsPos.x, settingsPos.y);
    this.settingsZone?.setPosition(settingsPos.x, settingsPos.y);
    this.infoText?.setPosition(infoPos.x, infoPos.y);
    this.infoZone?.setPosition(infoPos.x, infoPos.y);
    this.leaderboardText?.setPosition(leaderboardPos.x, leaderboardPos.y);
    this.modeToggle?.setPosition(modeTogglePos.x, modeTogglePos.y);
    this.modeTooltip?.setPosition(modeTooltipPos.x, modeTooltipPos.y);
    this.viewToggle?.setPosition(viewTogglePos.x, viewTogglePos.y);
    this.viewTooltip?.setPosition(viewTooltipPos.x, viewTooltipPos.y);

    if (this.buttonBg) {
      const buttonWidth = BOOT_LAYOUT.buttons.quick.width;
      const buttonHeight = BOOT_LAYOUT.buttons.quick.height;
      const x = quickPos.x - buttonWidth / 2;
      const y1 = quickPos.y - buttonHeight / 2;
      const y2 = campaignPos.y - BOOT_LAYOUT.buttons.campaign.height / 2;

      this.buttonBg.clear();

      // Quick play button.
      this.buttonBg.fillStyle(0xcc392f, 1);
      this.buttonBg.fillRoundedRect(x, y1, buttonWidth, buttonHeight, 14);
      this.buttonBg.lineStyle(2, 0x000000, 0.9);
      this.buttonBg.strokeRoundedRect(x, y1, buttonWidth, buttonHeight, 14);

      // Campaign button.
      this.buttonBg.fillStyle(0xcc392f, 1);
      this.buttonBg.fillRoundedRect(x, y2, BOOT_LAYOUT.buttons.campaign.width, BOOT_LAYOUT.buttons.campaign.height, 14);
      this.buttonBg.lineStyle(2, 0x000000, 0.9);
      this.buttonBg.strokeRoundedRect(x, y2, BOOT_LAYOUT.buttons.campaign.width, BOOT_LAYOUT.buttons.campaign.height, 14);
    }

    if (this.resumeSaved && this.resumePanelBg && this.resumeTitle && this.resumeBody && this.resumeBtnPrimary && this.resumeBtnSecondary && this.resumeZonePrimary && this.resumeZoneSecondary && this.resumeBlocker) {
      this.resumeBlocker.setPosition(0, 0);
      this.resumeBlocker.setSize(width, height);

      const panelW = Math.max(260, Math.min(560, Math.floor(width - 32)));
      const panelH = 210;
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);

      // Dim background + panel.
      this.resumePanelBg.clear();
      this.resumePanelBg.fillStyle(0x000000, 0.45);
      this.resumePanelBg.fillRect(0, 0, width, height);
      this.resumePanelBg.fillStyle(0x050a18, 0.85);
      this.resumePanelBg.lineStyle(2, 0x1f3a66, 0.9);
      this.resumePanelBg.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 16);
      this.resumePanelBg.strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 16);

      this.resumeTitle.setPosition(cx, cy - panelH / 2 + 18);
      this.resumeBody.setPosition(cx, cy - panelH / 2 + 56);

      const btnY = cy + panelH / 2 - 34;
      const gap = 12;
      const btnW = Math.floor((panelW - 32 - gap) / 2);
      const btnH = 44;
      const leftX = cx - gap / 2 - btnW / 2;
      const rightX = cx + gap / 2 + btnW / 2;

      this.resumeBtnPrimary.setPosition(leftX, btnY);
      this.resumeBtnSecondary.setPosition(rightX, btnY);
      this.resumeZonePrimary.setPosition(leftX, btnY);
      this.resumeZoneSecondary.setPosition(rightX, btnY);
      this.resumeZonePrimary.setSize(btnW, btnH);
      this.resumeZoneSecondary.setSize(btnW, btnH);
    }
  }
}
