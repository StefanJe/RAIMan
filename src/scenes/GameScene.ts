import Phaser from "phaser";
import { Direction } from "../game/directions";
import { Ghost } from "../game/ghost";
import { tileCenter, worldToTile } from "../game/gridMath";
import { CAMPAIGN_LEVELS, DEFAULT_LEVEL, DEMO_LEVEL, ORIGINAL_LEVELS } from "../game/levels";
import { parseLevel } from "../game/levelParser";
import { PelletSystem } from "../game/pelletSystem";
import { Player } from "../game/player";
import { drawWalls, renderWalls } from "../game/renderLevel";
import { DEFAULT_SETTINGS, playerSpeedPxPerSec, type GameSettings } from "../game/settings";
import type { LevelJson, ParsedLevel } from "../game/levelTypes";
import { validateLevel } from "../game/levelValidation";
import { buildShareUrl, decodeLevelFromHash, getLevelFromLocationHash } from "../game/levelShare";
import { Overlay } from "../ui/overlay";
import { GhostState, isFrightened, startFrightened, FRIGHTENED_DURATION_MS } from "../game/ghostState";
import { SwipeControls } from "../ui/swipeControls";
import { DPad } from "../ui/dpad";
import { generatePacRogueLevel } from "../game/pacRogue";
import { isWalkable } from "../game/levelTypes";
import { getAppConfig, getEffectiveSeed, type GameMode, type VibeSettings } from "../game/appConfig";
import { createRng, stringToSeed32, type Rng } from "../game/rng";
import { applyReorgShift } from "../game/vibeReorgShift";
import { PATCH_NOTES_DE } from "../game/vibePatchNotes";
import { getUserPrefs, type MobileLayoutMode } from "../game/userPrefs";
import type { HighscoreMode } from "../game/highscoreApi";
import { clearSavedGame, saveCheckpoint } from "../game/saveGame";
import { setBackgroundMusic } from "../game/backgroundMusic";
import { ROTATE_TRACK_ID } from "../game/musicTracks";
import { FpsRenderer, type FpsRendererFrame } from "../ui/fpsRenderer";
import { HudNavigator } from "../ui/hudNavigator";
import { HudMiniMap } from "../ui/hudMiniMap";

interface ActiveBomb {
  tileX: number;
  tileY: number;
  view: Phaser.GameObjects.Sprite;
  countdownText?: Phaser.GameObjects.Text;
  explodeEvent?: Phaser.Time.TimerEvent;
  countdownEvent?: Phaser.Time.TimerEvent;
}

interface ActiveFruit {
  tileX: number;
  tileY: number;
  view: Phaser.GameObjects.Sprite;
  score: number;
  despawnEvent?: Phaser.Time.TimerEvent;
}

export class GameScene extends Phaser.Scene {
  /**
   * Main gameplay scene.
   *
   * High-level systems in here:
   * - Level rendering (maze walls + pellets) via `renderLevel()` and `PelletSystem`.
   * - Player + (optional) co-op player (Level 6 uses 2 synchronized starts).
   * - Ghost spawning + AI/pathing (see `src/game/ghostAI.ts`, `src/game/ghost.ts`).
   * - Bombs/Boxes/Fruits (pickups, placement, explosions).
   * - Campaign progression (Original levels) + victory/celebration transition.
   * - Vibe Mode (deterministic seed + reorg shifts + patch notes overlay).
   * - Mobile Layout (optional): scaling + touch controls layout (DPad + bomb button).
   *
   * Note: classic gameplay must stay unchanged unless explicitly gated (e.g. Vibe systems or Mobile Layout).
   */
  private static readonly MOBILE_CONTROLS_OVERLAP_PX = 150;

  private levelLayer?: Phaser.GameObjects.Container;
  private errorText?: Phaser.GameObjects.Text;
  private wallsGraphics?: Phaser.GameObjects.Graphics;

  private debugText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  private campaignInfoText?: Phaser.GameObjects.Text;
  private livesContainer?: Phaser.GameObjects.Container;
  private livesIcons: Phaser.GameObjects.Image[] = [];
  private bombContainer?: Phaser.GameObjects.Container;
  private bombCountText?: Phaser.GameObjects.Text;
  private backToMenuText?: Phaser.GameObjects.Text;
  private navigatingToMenu = false;
  private shuttingDown = false;

  private parsedLevel?: ParsedLevel;
  private levelJson: LevelJson = DEFAULT_LEVEL;
  private tileSize = 32;
  private player?: Player;
  private coopPlayer?: Player;
  private pellets?: PelletSystem;
  private ghosts: Ghost[] = [];

  private score = 0;
  private lives = 5;
  private readonly maxLives = 5;
  private campaignIndex: number | null = null;
  private levelStartScore = 0;
  private restartPenaltyScoreDelta = 0;
  private gameMode: GameMode = "classic";
  private seed: string | null = null;
  private vibeSettings: VibeSettings | null = null;
  private vibeRng: Rng | null = null;
  private victory?: Overlay;
  private victoryActive = false;
  private caught?: Overlay;
  private caughtActive = false;
  private invulnerableUntilMs = 0;
  private deathActive = false;
  private toastUntilMs = 0;
  private toastMessage = "";
  private secretBuffer = "";
  private secretLastKeyAtMs = 0;

  private bombsAvailable = 0;
  private bombPickups = new Map<string, Phaser.GameObjects.Sprite>();
  private activeBombs = new Map<string, ActiveBomb>();
  private activeExplosions: Phaser.GameObjects.Sprite[] = [];
  private boxes = new Map<string, Phaser.GameObjects.Sprite>();

  private activeFruit?: ActiveFruit;
  private fruitPickups = new Map<string, ActiveFruit>();
  private fruitSpawnEvent?: Phaser.Time.TimerEvent;

  private settings: GameSettings = DEFAULT_SETTINGS;
  private frightenedUntilMs = 0;
  private touchDirection: Direction = Direction.None;
  private swipe?: SwipeControls;
  private dpad?: DPad;
  private bombTouch?: Phaser.GameObjects.Container;
  private bombTouchBg?: Phaser.GameObjects.Graphics;
  private bombTouchZone?: Phaser.GameObjects.Zone;
  private bombTouchIcon?: Phaser.GameObjects.Image;
  private bombTouchLabel?: Phaser.GameObjects.Text;
  private mobileLayoutPref: MobileLayoutMode = "auto";
  private mobileLayoutActive = false;
  private mobileGridBottomY: number | null = null;
  private mobileControlsCenterY: number | null = null;
  private turnBufferDirection: Direction = Direction.None;
  private turnBufferUntilMs = 0;
  private movementKeydownHandler?: (ev: KeyboardEvent) => void;
  private vibeShiftEvent?: Phaser.Time.TimerEvent;
  private vibeShiftCount = 0;
  private vibeBonusNextAtShift = 0;
  private lastVibeMutatedTiles: Array<{ x: number; y: number }> = [];
  private vibeDebugOverlay?: Phaser.GameObjects.Graphics;
  private vibeDebugClearEvent?: Phaser.Time.TimerEvent;
  private vibeChangeOverlay?: Phaser.GameObjects.Graphics;
  private vibeChangeClearEvent?: Phaser.Time.TimerEvent;
  private patchNotesOverlay?: Phaser.GameObjects.Container;
  private patchNotesHideEvent?: Phaser.Time.TimerEvent;
  private runStartedAtMs = 0;

  private viewMode: "topdown" | "fps" = "topdown";
  private fpsRenderer?: FpsRenderer;
  private fpsHud?: HudNavigator;
  private fpsMiniMap?: HudMiniMap;
  private fpsLookYawRad = 0;
  private fpsLookYawTargetRad = 0;
  private fpsLookYawFromRad = 0;
  private fpsLookYawTweenUntilMs = 0;
  private fpsMoveRefDir: Direction = Direction.Right;
  private fpsTurningActive = false;
  private fpsMoveInputActive = false;

  private restartKey?: Phaser.Input.Keyboard.Key;
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private gKey?: Phaser.Input.Keyboard.Key;
  private sfx?: {
    chomp: Phaser.Sound.BaseSound;
    death: Phaser.Sound.BaseSound;
    eatghost: Phaser.Sound.BaseSound;
    explosion: Phaser.Sound.BaseSound;
    success: Phaser.Sound.BaseSound;
  };
  private sfxEnabled = true;
  private keys?: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: unknown): void {
    const maybe =
      data as
        | {
            settings?: Partial<GameSettings>;
            levelJson?: LevelJson;
            campaignIndex?: number;
            score?: number;
            lives?: number;
            mode?: GameMode;
            seed?: string | null;
            vibeSettings?: VibeSettings;
            restartPenaltyScoreDelta?: number;
            viewMode?: unknown;
            runStartedAtMs?: number;
          }
        | undefined;
    const cfg = getAppConfig();
    const difficulty = maybe?.settings?.difficulty;
    const speed = maybe?.settings?.playerSpeedTilesPerSec;
    if ((difficulty === "easy" || difficulty === "normal" || difficulty === "hard") && typeof speed === "number") {
      this.settings = { difficulty, playerSpeedTilesPerSec: speed };
    } else {
      this.settings = DEFAULT_SETTINGS;
    }
    this.levelJson = maybe?.levelJson ?? DEFAULT_LEVEL;
    this.campaignIndex = typeof maybe?.campaignIndex === "number" ? maybe.campaignIndex : null;
    this.score = typeof maybe?.score === "number" && Number.isFinite(maybe.score) ? maybe.score : 0;
    this.lives =
      typeof maybe?.lives === "number" && Number.isFinite(maybe.lives)
        ? Math.max(0, Math.min(this.maxLives, Math.floor(maybe.lives)))
        : this.maxLives;

    this.restartPenaltyScoreDelta =
      typeof maybe?.restartPenaltyScoreDelta === "number" && Number.isFinite(maybe.restartPenaltyScoreDelta)
        ? Math.max(0, Math.floor(maybe.restartPenaltyScoreDelta))
        : 0;

    this.runStartedAtMs =
      typeof maybe?.runStartedAtMs === "number" && Number.isFinite(maybe.runStartedAtMs) && maybe.runStartedAtMs > 0
        ? Math.floor(maybe.runStartedAtMs)
        : 0;

    this.gameMode = maybe?.mode ?? cfg.mode;
    this.seed = typeof maybe?.seed === "string" ? maybe.seed : cfg.seed;
    this.vibeSettings = maybe?.vibeSettings ?? cfg.vibe;

    this.viewMode = maybe?.viewMode === "fps" ? "fps" : "topdown";

    if (this.gameMode === "vibe") {
      const seedStr = typeof this.seed === "string" && this.seed.trim() ? this.seed : getEffectiveSeed(cfg);
      this.seed = seedStr;
      this.vibeRng = createRng(seedStr);
    } else {
      this.vibeRng = null;
    }
  }

  create(): void {
    this.navigatingToMenu = false;
    this.shuttingDown = false;
    this.cameras.main.setBackgroundColor(0x0b1020);
    const prefs = getUserPrefs();
    this.mobileLayoutPref = prefs.mobileLayout ?? "auto";
    this.mobileLayoutActive = this.computeMobileLayoutActive(this.mobileLayoutPref, this.cameras.main.width, this.cameras.main.height);
    this.sfxEnabled = prefs.soundEnabled;
    setBackgroundMusic(this, prefs.musicEnabled ? prefs.musicTrackId || ROTATE_TRACK_ID : null);

    this.invulnerableUntilMs = 0;
    this.deathActive = false;
    this.toastUntilMs = 0;
    this.toastMessage = "";
    this.secretBuffer = "";
    this.secretLastKeyAtMs = 0;
    this.turnBufferDirection = Direction.None;
    this.turnBufferUntilMs = 0;
    this.victoryActive = false;
    this.caughtActive = false;
    this.victory?.destroy();
    this.caught?.destroy();
    this.victory = undefined;
    this.caught = undefined;
    this.ghosts = [];
    this.player = undefined;
    this.coopPlayer = undefined;
    this.frightenedUntilMs = 0;
    this.cleanupDynamicObjects();
    this.fpsRenderer?.destroy();
    this.fpsRenderer = undefined;
    this.fpsHud?.destroy();
    this.fpsHud = undefined;
    this.fpsMiniMap?.destroy();
    this.fpsMiniMap = undefined;

    const fromHash = getLevelFromLocationHash();
    if (fromHash && !fromHash.ok) {
      this.showErrors(fromHash.errors);
      return;
    }
    if (this.levelJson === DEFAULT_LEVEL && fromHash?.ok) this.levelJson = fromHash.level;

    let parsed: ParsedLevel;
    try {
      parsed = parseLevel(this.levelJson);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.showErrors([message]);
      return;
    }

    const validation = validateLevel(this.levelJson);
    if (!validation.ok) {
      this.showErrors(validation.errors);
      return;
    }

    this.parsedLevel = parsed;
    this.levelStartScore = this.score;
    this.renderLevel(parsed);
    this.setupPlayer(parsed);
    this.setupGhosts(parsed);
    this.setupInput();
    this.setupHud();
    this.setupViewMode(parsed);
    this.setupMobileControls();
    this.setupSecretLevelInput();
    this.setupSfx();
    this.setupBombPickups(parsed);
    this.setupBoxes(parsed);
    this.setupFruitSpawning(parsed);
    this.setupVibeReorgShift(parsed);
    if (!this.runStartedAtMs) this.runStartedAtMs = Date.now();

    // Checkpoint save (Approach A): resume restarts the current level with the same campaign progress / score / lives.
    this.saveCheckpointAtLevelStart();

    if (this.restartPenaltyScoreDelta > 0) {
      this.toast(`Level reset: -${this.restartPenaltyScoreDelta} Punkte`, 2400);
      this.restartPenaltyScoreDelta = 0;
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.shuttingDown = true;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.cleanupDynamicObjects();
      this.fpsRenderer?.destroy();
      this.fpsRenderer = undefined;
      this.fpsHud?.destroy();
      this.fpsHud = undefined;
      this.fpsMiniMap?.destroy();
      this.fpsMiniMap = undefined;
      this.sfx?.chomp.destroy();
      this.sfx?.death.destroy();
      this.sfx?.eatghost.destroy();
      this.sfx?.explosion.destroy();
      this.sfx?.success.destroy();
      this.sfx = undefined;
      this.vibeShiftEvent?.destroy();
      this.vibeShiftEvent = undefined;
      this.vibeDebugClearEvent?.destroy();
      this.vibeDebugClearEvent = undefined;
      this.vibeDebugOverlay?.destroy();
      this.vibeDebugOverlay = undefined;
      this.vibeChangeClearEvent?.destroy();
      this.vibeChangeClearEvent = undefined;
      this.vibeChangeOverlay?.destroy();
      this.vibeChangeOverlay = undefined;
      this.patchNotesHideEvent?.destroy();
      this.patchNotesHideEvent = undefined;
      this.patchNotesOverlay?.destroy(true);
      this.patchNotesOverlay = undefined;
      this.campaignInfoText?.destroy();
      this.campaignInfoText = undefined;
      this.backToMenuText?.destroy();
      this.backToMenuText = undefined;
    });
  }

  private saveCheckpointAtLevelStart(): void {
    const mode: GameMode = this.gameMode;
    const seed = mode === "vibe" ? (this.seed ?? getEffectiveSeed(getAppConfig())) : null;
    saveCheckpoint({
      scope: this.campaignIndex !== null ? "campaign" : "level",
      mode,
      seed,
      difficulty: this.settings.difficulty,
      score: this.score,
      lives: this.lives,
      campaignIndex: this.campaignIndex,
      levelJson: this.levelJson,
      runStartedAtMs: this.runStartedAtMs || undefined
    });
  }

  private setupVibeReorgShift(level: ParsedLevel): void {
    this.vibeShiftEvent?.destroy();
    this.vibeShiftEvent = undefined;
    this.vibeShiftCount = 0;
    this.lastVibeMutatedTiles = [];
    this.vibeBonusNextAtShift = 0;

    if (this.gameMode !== "vibe") return;
    if (!this.vibeRng) return;

    const seed = this.seed ?? getEffectiveSeed(getAppConfig());
    const bonusInit = createRng(`${seed}|bonus-init`);
    this.vibeBonusNextAtShift = bonusInit.nextInt(1, 3); // 1..2 (spawn bonus earlier/more often)

    const interval = Math.max(2_000, Math.floor(this.vibeSettings?.shiftIntervalMs ?? 12_000));
    this.vibeShiftEvent = this.time.addEvent({
      delay: interval,
      loop: true,
      callback: () => {
        if (this.victoryActive || this.caughtActive || this.deathActive) return;
        this.tryVibeReorgShift(level, "timer");
      }
    });
  }

  private setupSfx(): void {
    if (!this.sound) return;
    if (this.sfx) return;
    this.sfx = {
      chomp: this.sound.add("sfx-chomp", { volume: 0.35 }),
      death: this.sound.add("sfx-death", { volume: 0.6 }),
      eatghost: this.sound.add("sfx-eatghost", { volume: 0.6 }),
      explosion: this.sound.add("sfx-explosion", { volume: 0.65 }),
      success: this.sound.add("sfx-success", { volume: 0.7 })
    };
  }

  private playSfx(key: keyof NonNullable<GameScene["sfx"]>): void {
    if (!this.sfxEnabled) return;
    const s = this.sfx?.[key];
    if (!s) return;
    if (s.isPlaying) return;
    s.play();
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.updateMobileLayoutActive(gameSize.width, gameSize.height);
    this.layoutLevelLayer(gameSize.width, gameSize.height);
    if (this.victory) this.victory.layout(gameSize.width, gameSize.height);
    if (this.caught) this.caught.layout(gameSize.width, gameSize.height);
    this.dpad?.layout(gameSize.width, gameSize.height, this.getDpadLayoutOptions(gameSize.width, gameSize.height));
    this.layoutBombTouchButton(gameSize.width, gameSize.height);
    this.layoutBackToMenuButton(gameSize.width, gameSize.height);
    this.positionPatchNotesOverlay(gameSize.width, gameSize.height);

    if (this.viewMode === "fps") {
      this.fpsRenderer?.resize(gameSize.width, gameSize.height);
      this.fpsHud?.layout(gameSize.width, gameSize.height);
      this.fpsMiniMap?.layout(gameSize.width, gameSize.height);
    }
  }

  private updateMobileLayoutActive(viewWidth: number, viewHeight: number): void {
    this.mobileLayoutActive = this.computeMobileLayoutActive(this.mobileLayoutPref, viewWidth, viewHeight);
  }

  private getDisplaySizeForLayout(): { width: number; height: number } {
    // Phaser is configured with Scale.FIT (800x600). The camera/game size may stay landscape even on a portrait phone.
    // For "mobile layout" decisions (portrait vs landscape, auto thresholds), use the *display/parent* size.
    const parent = this.scale.parentSize;
    if (parent && Number.isFinite(parent.width) && Number.isFinite(parent.height) && parent.width > 0 && parent.height > 0) {
      return { width: parent.width, height: parent.height };
    }

    const bounds = this.scale.canvasBounds;
    if (bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0) {
      return { width: bounds.width, height: bounds.height };
    }

    return { width: this.cameras.main.width, height: this.cameras.main.height };
  }

  private computeMobileLayoutActive(pref: MobileLayoutMode, viewWidth: number, viewHeight: number): boolean {
    if (pref === "off") return false;
    if (pref === "on") return true;

    // "auto" should not affect desktop: require coarse pointer/touch + small-ish screen.
    const display = this.getDisplaySizeForLayout();
    const minDim = Math.min(display.width, display.height);
    if (minDim > 760) return false;

    const touch =
      this.sys.game.device.input.touch ||
      (typeof window !== "undefined" && "ontouchstart" in window);
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    return Boolean(touch || coarse);
  }

  private shouldShowTouchControls(viewWidth: number): boolean {
    const likelyTouch =
      this.sys.game.device.input.touch ||
      (typeof window !== "undefined" && "ontouchstart" in window);

    return Boolean(likelyTouch) || viewWidth < 900;
  }

  private getMobileUiMetrics(viewWidth: number, viewHeight: number): {
    showTouchControls: boolean;
    isPortrait: boolean;
    dpad: { buttonSize: number; gap: number; margin: number; anchor: "bottom-left" | "mid-left" };
    bomb: { size: number; margin: number; anchor: "bottom-right" | "mid-right" };
  } {
    const showTouchControls = this.shouldShowTouchControls(viewWidth);
    const display = this.getDisplaySizeForLayout();
    const isPortrait = display.height >= display.width;

    if (!this.mobileLayoutActive) {
      return {
        showTouchControls,
        isPortrait,
        dpad: { buttonSize: 56, gap: 10, margin: 24, anchor: "bottom-left" },
        bomb: { size: 64, margin: 24, anchor: "bottom-right" }
      };
    }

    const dpadButton = isPortrait ? 64 : 56;
    const dpadGap = isPortrait ? 10 : 8;
    const dpadMargin = isPortrait ? 18 : 12;

    const bombSize = isPortrait ? 66 : 58;
    const bombMargin = isPortrait ? 18 : 12;

    return {
      showTouchControls,
      isPortrait,
      dpad: { buttonSize: dpadButton, gap: dpadGap, margin: dpadMargin, anchor: isPortrait ? "bottom-left" : "mid-left" },
      bomb: { size: bombSize, margin: bombMargin, anchor: isPortrait ? "bottom-right" : "mid-right" }
    };
  }

  private getDpadLayoutOptions(viewWidth: number, viewHeight: number): Parameters<DPad["layout"]>[2] {
    const m = this.getMobileUiMetrics(viewWidth, viewHeight);
    return {
      anchor: m.dpad.anchor,
      buttonSize: m.dpad.buttonSize,
      gap: m.dpad.gap,
      margin: m.dpad.margin,
      centerY: this.mobileLayoutActive && m.isPortrait && m.showTouchControls ? this.mobileControlsCenterY ?? undefined : undefined
    };
  }

  private getPlayAreaInsets(viewWidth: number, viewHeight: number): { top: number; bottom: number; left: number; right: number } {
    if (!this.mobileLayoutActive) return { top: 0, bottom: 0, left: 0, right: 0 };

    const m = this.getMobileUiMetrics(viewWidth, viewHeight);
    const isCampaign = this.campaignIndex !== null;
    const top = isCampaign ? 124 : 108;
    if (!m.showTouchControls) return { top, bottom: 0, left: 0, right: 0 };

    const crossSize = (m.dpad.buttonSize * 3) + (m.dpad.gap * 2);
    const safePad = Math.max(10, m.dpad.margin);

    if (m.isPortrait) {
      // Reserve a dedicated controls area below the grid.
      const controlsHeight = crossSize + (m.dpad.margin * 2);
      const overlap = GameScene.MOBILE_CONTROLS_OVERLAP_PX;
      const bottom = Math.max(0, (controlsHeight + 8) - overlap);
      return { top, bottom, left: 0, right: 0 };
    }

    // Landscape: put controls on the sides, reserve left/right.
    const minSide = crossSize + safePad;
    const left = Math.min(minSide + safePad, Math.floor(viewWidth * 0.38));
    const right = Math.min(m.bomb.size + m.bomb.margin * 2, Math.floor(viewWidth * 0.22));
    return { top, bottom: 6, left, right };
  }

  private layoutLevelLayer(viewWidth: number, viewHeight: number): void {
    if (!this.levelLayer || !this.parsedLevel) return;

    this.mobileGridBottomY = null;
    this.mobileControlsCenterY = null;

    const insets = this.getPlayAreaInsets(viewWidth, viewHeight);
    const areaWidth = Math.max(1, viewWidth - insets.left - insets.right);
    const areaHeight = Math.max(1, viewHeight - insets.top - insets.bottom);

    const renderWidth = this.tileSize * this.parsedLevel.width;
    const renderHeight = this.tileSize * this.parsedLevel.height;

    const metrics = this.getMobileUiMetrics(viewWidth, viewHeight);

    let scale = this.mobileLayoutActive ? Math.min(areaWidth / renderWidth, areaHeight / renderHeight) : 1;
    let scaledWidth = renderWidth * scale;
    let scaledHeight = renderHeight * scale;

    let offsetX = insets.left + Math.floor((areaWidth - scaledWidth) / 2);
    let offsetY = insets.top + Math.floor((areaHeight - scaledHeight) / 2);

    // Mobile portrait: give the grid (nearly) full width and place touch controls
    // in the reserved area below the grid.
    if (this.mobileLayoutActive && metrics.isPortrait && metrics.showTouchControls) {
      const crossSize = (metrics.dpad.buttonSize * 3) + (metrics.dpad.gap * 2);
      const controlsHeight = crossSize + (metrics.dpad.margin * 2) + 8;
      const overlap = GameScene.MOBILE_CONTROLS_OVERLAP_PX;
      const effectiveControlsH = Math.max(0, controlsHeight - overlap);
      const availableH = Math.max(1, viewHeight - insets.top - effectiveControlsH);

      const scaleW = Math.max(0.01, viewWidth / renderWidth);
      const scaleH = Math.max(0.01, availableH / renderHeight);
      scale = Math.min(scaleW, scaleH);
      scaledWidth = renderWidth * scale;
      scaledHeight = renderHeight * scale;

      offsetX = Math.floor((viewWidth - scaledWidth) / 2);
      offsetY = insets.top;

      const gridBottom = offsetY + scaledHeight;
      const crossRadius = (metrics.dpad.buttonSize + metrics.dpad.gap) + (metrics.dpad.buttonSize / 2);
      const minCenterY = gridBottom + metrics.dpad.margin + crossRadius;
      const maxCenterY = Math.max(minCenterY, viewHeight - metrics.dpad.margin - crossRadius);
      this.mobileGridBottomY = gridBottom;

      const shiftedUp = minCenterY - overlap;
      const minAllowed = insets.top + crossRadius + metrics.dpad.margin;
      this.mobileControlsCenterY = Math.min(maxCenterY, Math.max(minAllowed, shiftedUp));
    }

    this.levelLayer.setPosition(offsetX, offsetY);
    this.levelLayer.setScale(scale);
  }

  private layoutBackToMenuButton(viewWidth: number, _viewHeight: number): void {
    if (!this.backToMenuText) return;
    this.backToMenuText.setPosition(Math.max(12, viewWidth - 12), 10);
  }

  private positionPatchNotesOverlay(viewWidth?: number, viewHeight?: number): void {
    if (!this.patchNotesOverlay) return;
    const w = viewWidth ?? this.cameras.main.width;
    const h = viewHeight ?? this.cameras.main.height;

    const m = this.getMobileUiMetrics(w, h);
    if (this.mobileLayoutActive && m.isPortrait && m.showTouchControls && this.mobileControlsCenterY !== null) {
      const crossRadius = (m.dpad.buttonSize + m.dpad.gap) + (m.dpad.buttonSize / 2);
      // Keep patch notes above the touch controls.
      this.patchNotesOverlay.setPosition(Math.floor(w / 2), Math.max(18, Math.floor(this.mobileControlsCenterY - crossRadius - 16)));
      return;
    }

    this.patchNotesOverlay.setPosition(Math.floor(w / 2), Math.max(18, Math.floor(h - 28)));
  }

  private showPatchNotesOverlay(line: string, durationMs = 2400): void {
    this.patchNotesHideEvent?.destroy();
    this.patchNotesHideEvent = undefined;
    this.patchNotesOverlay?.destroy(true);
    this.patchNotesOverlay = undefined;

    const label = `Inspiration: ${line}`;
    const text = this.add
      .text(0, 0, label, {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "13px",
        color: "#e6f0ff",
        align: "center"
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const bounds = text.getBounds();
    const paddingX = 12;
    const paddingY = 8;
    const bg = this.add.graphics().setAlpha(0);
    bg.fillStyle(0x0b1020, 0.7);
    bg.lineStyle(1, 0x1f3a66, 0.85);
    const w = Math.ceil(bounds.width + paddingX * 2);
    const h = Math.ceil(bounds.height + paddingY * 2);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);

    bg.setDepth(3500);
    text.setDepth(3501);
    bg.setScrollFactor(0);
    text.setScrollFactor(0);

    this.patchNotesOverlay = this.add.container(0, 0, [bg, text]);
    this.patchNotesOverlay.setDepth(3500);
    this.positionPatchNotesOverlay();

    this.tweens.add({
      targets: [bg, text],
      alpha: 1,
      duration: 140,
      ease: "Quad.easeOut"
    });

    this.patchNotesHideEvent = this.time.delayedCall(Math.max(1800, durationMs), () => {
      this.tweens.add({
        targets: [bg, text],
        alpha: 0,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          this.patchNotesOverlay?.destroy(true);
          this.patchNotesOverlay = undefined;
        }
      });
    });
  }

  private renderLevel(level: ParsedLevel): void {
    const viewWidth = this.cameras.main.width;
    const viewHeight = this.cameras.main.height;

    const insets = this.getPlayAreaInsets(viewWidth, viewHeight);
    const areaWidth = Math.max(1, viewWidth - insets.left - insets.right);
    const areaHeight = Math.max(1, viewHeight - insets.top - insets.bottom);

    this.tileSize = Math.max(8, Math.floor(Math.min(areaWidth / level.width, areaHeight / level.height)));

    this.levelLayer?.destroy(true);
    this.errorText?.destroy();

    this.levelLayer = this.add.container(0, 0);
    this.levelLayer.setDepth(0);

    this.wallsGraphics?.destroy();
    this.wallsGraphics = renderWalls(this, level, this.tileSize);
    this.wallsGraphics.setPosition(0, 0);

    this.pellets?.graphics.destroy();
    this.pellets = new PelletSystem(this, level, this.tileSize);
    this.pellets.graphics.setPosition(0, 0);

    this.levelLayer.add([this.wallsGraphics, this.pellets.graphics]);
    this.layoutLevelLayer(viewWidth, viewHeight);
  }

  private setupPlayer(level: ParsedLevel): void {
    if (!this.levelLayer) return;
    if (!level.startPos && level.playerStarts.length === 0) return;

    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    const primary = starts[0];
    if (!primary) return;

    this.player = new Player(this, level, primary.x, primary.y, {
      tileSize: this.tileSize,
      speedPxPerSec: playerSpeedPxPerSec(this.tileSize, this.settings)
    });
    this.levelLayer.add(this.player.view);

    const secondary = starts[1];
    this.coopPlayer = undefined;
    if (secondary) {
      this.coopPlayer = new Player(this, level, secondary.x, secondary.y, {
        tileSize: this.tileSize,
        speedPxPerSec: playerSpeedPxPerSec(this.tileSize, this.settings)
      });
      this.coopPlayer.view.setAlpha(0.9);
      this.levelLayer.add(this.coopPlayer.view);
    }
  }

  private setupGhosts(level: ParsedLevel): void {
    if (!this.levelLayer) return;
    this.ghosts.forEach((g) => g.view.destroy());
    this.ghosts = [];

    const skins = ["blinky", "pinky", "inky", "clyde"] as const;
    const ghostCount = Math.min(4, level.ghostStarts.length);
    const speed = playerSpeedPxPerSec(this.tileSize, this.settings) * 0.9;
    const snapWhenStopped = this.settings.difficulty === "easy";

    for (let i = 0; i < ghostCount; i++) {
      const pos = level.ghostStarts[i]!;
      const ghost = new Ghost(this, level, pos.x, pos.y, {
        tileSize: this.tileSize,
        speedPxPerSec: speed,
        skin: skins[i % skins.length],
        snapWhenStopped
      });
      this.ghosts.push(ghost);
      this.levelLayer.add(ghost.view);
    }
  }

  private setupHud(): void {
    this.debugText?.destroy();
    this.debugText = this.add
      .text(12, 10, "", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: "14px",
        color: "#7CFFB2"
      })
      .setDepth(1000);

    this.scoreText?.destroy();
    this.scoreText = this.add
      .text(12, 30, "Score: 0", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#e6f0ff"
      })
      .setDepth(1000);

    this.backToMenuText?.destroy();
    this.backToMenuText = this.add
      .text(0, 0, "Zurück", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#e6f0ff",
        backgroundColor: "rgba(11, 16, 32, 0.65)",
        padding: { left: 10, right: 10, top: 8, bottom: 8 }
      })
      .setOrigin(1, 0)
      .setDepth(2000)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.backToMenuText.on("pointerup", () => {
      if (this.navigatingToMenu) return;
      this.navigatingToMenu = true;
      try {
        this.backToMenuText?.disableInteractive();
      } catch {
        // ignore
      }
      // Go back to main menu. Treat this as "abandon run" so we don't offer resume.
      clearSavedGame();
      this.scene.start("BootScene");
    });
    this.layoutBackToMenuButton(this.cameras.main.width, this.cameras.main.height);

    this.campaignInfoText?.destroy();
    this.campaignInfoText = undefined;

    const isCampaign = this.campaignIndex !== null;
    const livesY = isCampaign ? 74 : 58;
    const bombY = isCampaign ? 98 : 82;

    if (isCampaign) {
      const id = this.levelJson.id ?? "";
      const m = /Original_Level_(\d+)/i.exec(id);
      const currentN = m?.[1] ?? String((this.campaignIndex ?? 0) + 1);
      const totalN = CAMPAIGN_LEVELS.length;
      const diffLabel =
        this.settings.difficulty === "easy" ? "Leicht" : this.settings.difficulty === "hard" ? "Schwer" : "Normal";

      this.campaignInfoText = this.add
        .text(12, 50, `Level: ${currentN}/${totalN}  Schwierigkeit: ${diffLabel}`, {
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: "13px",
          color: "#9fb4d6"
        })
        .setDepth(1000)
        .setScrollFactor(0);
    }

    this.livesContainer?.destroy(true);
    this.livesContainer = this.add.container(12, livesY).setDepth(1000).setScrollFactor(0);
    this.livesIcons = [];

    const heartSize = 18;
    const gap = 6;
    for (let i = 0; i < this.maxLives; i++) {
      const heart = this.add.image(i * (heartSize + gap), 0, "ui-heart").setOrigin(0, 0.5).setScrollFactor(0);
      heart.setDisplaySize(heartSize, heartSize);
      this.livesIcons.push(heart);
      this.livesContainer.add(heart);
    }
    this.refreshLivesDisplay();

    this.bombContainer?.destroy(true);
    this.bombContainer = this.add.container(12, bombY).setDepth(1000).setScrollFactor(0);
    const bombIcon = this.add.image(0, 0, "obj-bomb").setOrigin(0, 0.5).setScrollFactor(0);
    bombIcon.setDisplaySize(18, 18);
    this.bombCountText?.destroy();
    this.bombCountText = this.add
      .text(24, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#e6f0ff"
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.bombContainer.add([bombIcon, this.bombCountText]);
    this.refreshBombDisplay();
  }

  private refreshLivesDisplay(): void {
    for (let i = 0; i < this.livesIcons.length; i++) {
      this.livesIcons[i]!.setVisible(i < this.lives);
    }
  }

  private refreshBombDisplay(): void {
    if (this.shuttingDown) return;
    const t = this.bombCountText;
    if (!t || !t.active || !t.scene) return;
    try {
      t.setText(`x${this.bombsAvailable}`);
    } catch {
      // ignore (e.g. if the Text internal canvas was already released)
    }
  }

  private setupSecretLevelInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    keyboard.on("keydown", this.handleSecretKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off("keydown", this.handleSecretKeyDown, this);
    });
  }

  private handleSecretKeyDown(event: KeyboardEvent): void {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.secretLastKeyAtMs > 1500) this.secretBuffer = "";
    this.secretLastKeyAtMs = now;

    if (event.key === "Enter") {
      const cmd = this.secretBuffer.toLowerCase().trim();
      this.secretBuffer = "";
      void this.tryRunSecretCommand(cmd);
      return;
    }

    if (event.key === "Backspace") {
      this.secretBuffer = this.secretBuffer.slice(0, -1);
      return;
    }

    if (event.key.length !== 1) return;
    if (!/[a-z0-9:_-]/i.test(event.key)) return;

    this.secretBuffer = (this.secretBuffer + event.key).slice(-64);
  }

  private async tryRunSecretCommand(cmd: string): Promise<void> {
    // Type `level` + Enter to open a prompt, or `lvl<N>` + Enter for quick numeric selection.
    if (!cmd) return;

    const om = /^orig(\d+)$/i.exec(cmd);
    if (om) {
      this.loadOriginalLevel(Number(om[1]));
      return;
    }

    const m = /lvl(\d+)$/.exec(cmd);
    if (m) {
      this.loadLevelFromInput(m[1]!);
      return;
    }

    if (cmd.endsWith("level") || cmd.endsWith("lvl")) {
      const input =
        typeof window !== "undefined"
          ? window.prompt("Level: number (0=demo), orig<N>, seed text, or a #lvl=... URL/hash", "")
          : null;
      if (input === null) return;
      this.loadLevelFromInput(input);
    }
  }

  private loadLevelFromInput(raw: string): void {
    const input = raw.trim();
    if (!input) return;

    const om = /^orig(\d+)$/i.exec(input);
    if (om) {
      this.loadOriginalLevel(Number(om[1]));
      return;
    }

    if (/^\d+$/.test(input)) {
      const n = Number(input);
      if (!Number.isFinite(n)) return;
      if (n === 0) {
        this.toast("Loading demo level");
        this.scene.restart({ settings: this.settings, levelJson: DEMO_LEVEL, viewMode: this.viewMode });
        return;
      }
      if (n === 1) {
        this.toast("Loading level 1");
        this.scene.restart({ settings: this.settings, levelJson: DEFAULT_LEVEL, viewMode: this.viewMode });
        return;
      }
      const seed = `lvl-${n}`;
      this.toast(`Loading AI-Rogue level ${n} (${this.settings.difficulty})`);
      const level = generatePacRogueLevel({ seed, difficulty: this.settings.difficulty });
      this.scene.restart({ settings: this.settings, levelJson: level, viewMode: this.viewMode });
      return;
    }

    // Allow pasting share URLs/hashes.
    const hash = input.includes("#") ? input.slice(input.indexOf("#")) : input;
    if (hash.includes("lvl=")) {
      const decoded = decodeLevelFromHash(hash);
      if (decoded.ok) {
        this.toast(`Loading shared level${decoded.level.id ? `: ${decoded.level.id}` : ""}`);
        this.scene.restart({ settings: this.settings, levelJson: decoded.level, viewMode: this.viewMode });
        return;
      }
      this.showErrors(["Invalid shared level:", "", ...decoded.errors]);
      return;
    }

    // Treat as seed text for deterministic Pac-Man-ish generation.
    this.toast(`Loading AI-Rogue level (${this.settings.difficulty})`);
    const level = generatePacRogueLevel({ seed: input, difficulty: this.settings.difficulty });
    this.scene.restart({ settings: this.settings, levelJson: level, viewMode: this.viewMode });
  }

  private loadOriginalLevel(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    const level = ORIGINAL_LEVELS[n - 1];
    if (!level) {
      this.toast(`Unknown original level ${n}`, 1400);
      return;
    }
    this.toast(`Loading original level ${n}`);
    this.scene.restart({ settings: this.settings, levelJson: level, viewMode: this.viewMode });
  }

  private toast(message: string, durationMs = 1600): void {
    this.toastMessage = message;
    this.toastUntilMs = this.time.now + durationMs;
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.keys = {
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S)
    };
    this.restartKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.spaceKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.gKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);

    // Capture very short taps reliably (esp. at low speeds) by buffering turns on keydown.
    this.movementKeydownHandler = (ev: KeyboardEvent) => {
      const code = ev.code;
      const dir =
        code === "ArrowLeft" || code === "KeyA"
          ? Direction.Left
          : code === "ArrowRight" || code === "KeyD"
            ? Direction.Right
            : code === "ArrowUp" || code === "KeyW"
              ? Direction.Up
              : code === "ArrowDown" || code === "KeyS"
                ? Direction.Down
                : Direction.None;
      if (dir === Direction.None) return;
      this.bumpTurnBuffer(dir);
    };
    keyboard.on("keydown", this.movementKeydownHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.movementKeydownHandler) return;
      keyboard.off("keydown", this.movementKeydownHandler);
      this.movementKeydownHandler = undefined;
    });
  }

  private bumpTurnBuffer(direction: Direction): void {
    // Allow slightly longer buffering for slow speeds so controls still feel responsive.
    const bufferMs = this.settings.playerSpeedTilesPerSec <= 6 ? 520 : 260;
    this.turnBufferDirection = direction;
    this.turnBufferUntilMs = this.time.now + bufferMs;
  }

  private markProtected(mask: boolean[][], level: ParsedLevel, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return;
    mask[y]![x] = true;
  }

  private buildProtectedMaskForShift(level: ParsedLevel): boolean[][] {
    const mask: boolean[][] = Array.from({ length: level.height }, () => Array.from({ length: level.width }, () => false));

    // Outer border must never be modified (keeps tunnels/wrap stable).
    for (let x = 0; x < level.width; x++) {
      mask[0]![x] = true;
      mask[level.height - 1]![x] = true;
    }
    for (let y = 0; y < level.height; y++) {
      mask[y]![0] = true;
      mask[y]![level.width - 1] = true;
    }

    // Start markers.
    for (const p of level.playerStarts) this.markProtected(mask, level, p.x, p.y);
    if (level.startPos) this.markProtected(mask, level, level.startPos.x, level.startPos.y);
    for (const g of level.ghostStarts) this.markProtected(mask, level, g.x, g.y);

    // Dynamic objects should not be walled over.
    for (const key of this.bombPickups.keys()) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (Number.isFinite(x) && Number.isFinite(y)) this.markProtected(mask, level, x, y);
    }
    for (const key of this.activeBombs.keys()) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (Number.isFinite(x) && Number.isFinite(y)) this.markProtected(mask, level, x, y);
    }
    for (const key of this.boxes.keys()) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (Number.isFinite(x) && Number.isFinite(y)) this.markProtected(mask, level, x, y);
    }
    for (const key of this.fruitPickups.keys()) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (Number.isFinite(x) && Number.isFinite(y)) this.markProtected(mask, level, x, y);
    }
    if (this.activeFruit) this.markProtected(mask, level, this.activeFruit.tileX, this.activeFruit.tileY);

    // Protect entity current tiles (prevents "wall appears under you").
    if (this.player) {
      const t = worldToTile(this.player.view.x, this.player.view.y, this.tileSize);
      this.markProtected(mask, level, t.x, t.y);
    }
    if (this.coopPlayer) {
      const t = worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize);
      this.markProtected(mask, level, t.x, t.y);
    }
    for (const ghost of this.ghosts) {
      const t = ghost.getTile();
      this.markProtected(mask, level, t.x, t.y);
    }

    // Heuristic ghost house protection: if ghost spawns are tightly clustered, protect the surrounding block.
    if (level.ghostStarts.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const g of level.ghostStarts) {
        minX = Math.min(minX, g.x);
        minY = Math.min(minY, g.y);
        maxX = Math.max(maxX, g.x);
        maxY = Math.max(maxY, g.y);
      }
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      if (spanX <= 6 && spanY <= 6) {
        const pad = 2;
        for (let y = minY - pad; y <= maxY + pad; y++) {
          for (let x = minX - pad; x <= maxX + pad; x++) {
            this.markProtected(mask, level, x, y);
          }
        }
      }
    }

    return mask;
  }

  private tryVibeReorgShift(level: ParsedLevel, reason: "timer" | "power"): void {
    if (this.gameMode !== "vibe") return;
    if (!this.vibeRng) return;
    if (!this.player || !this.pellets || !this.levelLayer) return;
    if (!this.wallsGraphics) return;

    const starts: Array<{ x: number; y: number }> = [];
    const p1 = worldToTile(this.player.view.x, this.player.view.y, this.tileSize);
    starts.push({ x: p1.x, y: p1.y });
    if (this.coopPlayer) {
      const p2 = worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize);
      if (p2.x !== p1.x || p2.y !== p1.y) starts.push({ x: p2.x, y: p2.y });
    }

    const critical: Array<{ x: number; y: number }> = [];
    for (const g of level.ghostStarts) critical.push({ x: g.x, y: g.y });
    for (const ghost of this.ghosts) {
      const t = ghost.getTile();
      critical.push({ x: t.x, y: t.y });
    }

    const protectedMask = this.buildProtectedMaskForShift(level);
    const mutations = this.vibeRng.nextInt(2, 6); // 2..5

    const res = applyReorgShift(
      level,
      this.vibeRng,
      { mutations, maxTriesPerMutation: 50, softlockMaxSteps: 20 },
      protectedMask,
      starts,
      critical
    );
    if (!res.ok) return;

    this.vibeShiftCount += 1;
    this.lastVibeMutatedTiles = res.mutatedTiles;

    drawWalls(this.wallsGraphics, level, this.tileSize);
    this.pellets.redraw();
    this.showVibeShiftChangeOverlay(level, res.mutatedTiles, 4000);

    // Subtle feedback.
    this.cameras.main.shake(120, 0.002);
    this.cameras.main.flash(120, 40, 80, 120, true);

    const seed = this.seed ?? getEffectiveSeed(getAppConfig());
    const idx = stringToSeed32(`${seed}|patchnote|${this.vibeShiftCount}`) % PATCH_NOTES_DE.length;
    this.showPatchNotesOverlay(PATCH_NOTES_DE[idx]!, reason === "power" ? 6000 : 5400);

    this.maybeSpawnVibeBonusObjects(level);
  }

  private maybeSpawnVibeBonusObjects(level: ParsedLevel): void {
    if (this.gameMode !== "vibe") return;

    // Hard guarantee: at least every 3rd shift spawns *something* (box or bomb),
    // otherwise the vibe bonus system can feel inactive depending on map state.
    if (this.vibeShiftCount > 0 && this.vibeShiftCount % 3 === 0) {
      this.spawnVibeGuaranteedBonus(level);
    }

    if (this.vibeBonusNextAtShift <= 0) return;
    if (this.vibeShiftCount < this.vibeBonusNextAtShift) return;

    const seed = this.seed ?? getEffectiveSeed(getAppConfig());
    const bonusRng = createRng(`${seed}|bonus|${this.vibeShiftCount}`);

    // Schedule next bonus spawn: +1 or +2 shifts (boxes felt too rare otherwise).
    const nextDelta = createRng(`${seed}|bonus-next|${this.vibeShiftCount}`).nextInt(1, 3);
    this.vibeBonusNextAtShift = this.vibeShiftCount + nextDelta;

    // Boxes are intentionally more frequent than bombs, but capped for fairness.
    const boxDesired = this.boxes.size < 10 ? 2 : 1;
    for (let i = 0; i < boxDesired; i++) this.spawnVibeBonusBox(level, bonusRng);
    this.spawnVibeBonusBombs(level, bonusRng);
  }

  private spawnVibeGuaranteedBonus(level: ParsedLevel): void {
    if (this.gameMode !== "vibe") return;
    if (!this.vibeRng) return;

    const seed = this.seed ?? getEffectiveSeed(getAppConfig());
    const rng = createRng(`${seed}|bonus-guaranteed|${this.vibeShiftCount}`);

    const beforeBoxes = this.boxes.size;
    const beforeBombs = this.bombPickups.size;

    // Prefer placing a box (more noticeable + interacts with bombs), fallback to bombs.
    if (this.boxes.size < 24) {
      for (let i = 0; i < 3; i++) {
        this.spawnVibeBonusBox(level, rng);
        if (this.boxes.size > beforeBoxes) return;
      }
    }

    if (this.bombPickups.size < 10) {
      this.spawnVibeBonusBombs(level, rng);
      if (this.bombPickups.size > beforeBombs) return;
    }
  }

  private spawnVibeBonusBox(level: ParsedLevel, rng: Rng): void {
    if (!this.levelLayer) return;
    if (!this.player) return;
    if (this.boxes.size >= 24) return;

    const protectedMask = this.buildProtectedMaskForShift(level);
    const avoid = this.buildAvoidForVibeBonus(level, protectedMask, 2);

    // Early game has very few "empty" tiles (most paths have pellets). Prefer empty when possible,
    // otherwise swap a nearby wall with a walkable tile to place a box without changing pellet counts.
    for (let attempts = 0; attempts < 160; attempts++) {
      const tile = this.pickRandomWalkableTileFiltered(level, rng, avoid, protectedMask, { preferEmpty: true });
      if (!tile) return;

      const placedEmpty = this.tryPlaceBoxAt(level, tile.x, tile.y, avoid, { requireCorridor: false, requireSolvable: true });
      if (placedEmpty) return;

      if (this.tryPlaceVibeSwapBoxAt(level, tile.x, tile.y, rng, protectedMask, avoid)) return;

      // Prevent tight loops on a bad candidate.
      avoid.add(this.tileKey(tile.x, tile.y));
    }
  }

  private tryPlaceVibeSwapBoxAt(
    level: ParsedLevel,
    tileX: number,
    tileY: number,
    rng: Rng,
    protectedMask: boolean[][],
    avoid: Set<string>
  ): boolean {
    if (!this.levelLayer) return false;
    if (!this.wallsGraphics) return false;
    if (!this.pellets) return false;

    if (tileX < 1 || tileY < 1 || tileX >= level.width - 1 || tileY >= level.height - 1) return false;
    if (protectedMask[tileY]![tileX]) return false;

    const key = this.tileKey(tileX, tileY);
    if (avoid.has(key)) return false;

    const t = level.tileMatrix[tileY]?.[tileX];
    if (!t || !isWalkable(t)) return false;

    const wallNeighbors: Array<{ x: number; y: number }> = [];
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ] as const) {
      const nx = tileX + d.x;
      const ny = tileY + d.y;
      if (protectedMask[ny]![nx]) continue;
      const nk = this.tileKey(nx, ny);
      if (avoid.has(nk)) continue;
      if (level.tileMatrix[ny]?.[nx] === "wall") wallNeighbors.push({ x: nx, y: ny });
    }
    if (wallNeighbors.length === 0) return false;

    const pick = wallNeighbors[Math.floor(rng.nextFloat() * wallNeighbors.length)]!;
    const prevWalk = level.tileMatrix[tileY]![tileX]!;
    const prevWall = level.tileMatrix[pick.y]![pick.x]!;
    if (prevWall !== "wall") return false;

    // Swap wall <-> walkable so pellet counts stay stable (PelletSystem counters assume no net change).
    level.tileMatrix[tileY]![tileX] = "wall";
    level.tileMatrix[pick.y]![pick.x] = prevWalk;

    if (!this.allConsumablesReachable(level)) {
      level.tileMatrix[tileY]![tileX] = prevWalk;
      level.tileMatrix[pick.y]![pick.x] = prevWall;
      return false;
    }

    const playerTiles = [worldToTile(this.player!.view.x, this.player!.view.y, this.tileSize)];
    if (this.coopPlayer) playerTiles.push(worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize));
    const reachable = this.buildReachableFromStart(level);
    const ok = playerTiles.every((pt) => pt.x >= 0 && pt.y >= 0 && pt.x < level.width && pt.y < level.height && reachable[pt.y]![pt.x]);
    if (!ok) {
      level.tileMatrix[tileY]![tileX] = prevWalk;
      level.tileMatrix[pick.y]![pick.x] = prevWall;
      return false;
    }

    const pos = tileCenter(tileX, tileY, this.tileSize);
    const sprite = this.add.sprite(pos.x, pos.y, "obj-box");
    sprite.setDisplaySize(Math.floor(this.tileSize * 0.9), Math.floor(this.tileSize * 0.9));
    this.addToLevelOverlay(sprite);
    this.boxes.set(key, sprite);

    // We moved a wall, so both wall and pellet graphics must be refreshed.
    drawWalls(this.wallsGraphics, level, this.tileSize);
    this.pellets.redraw();

    return true;
  }

  private spawnVibeBonusBombs(level: ParsedLevel, rng: Rng): void {
    if (!this.levelLayer) return;
    if (this.bombPickups.size >= 10) return;

    const protectedMask = this.buildProtectedMaskForShift(level);
    const avoid = this.buildAvoidForVibeBonus(level, protectedMask, 1);

    const desired = this.bombPickups.size <= 2 ? 2 : 1;
    for (let placed = 0, attempts = 0; placed < desired && attempts < 80; attempts++) {
      const tile = this.pickRandomWalkableTileFiltered(level, rng, avoid, protectedMask, { preferEmpty: true });
      if (!tile) break;
      if (this.spawnBombPickupAt(level, tile.x, tile.y, avoid)) placed += 1;
    }
  }

  private buildAvoidForVibeBonus(level: ParsedLevel, protectedMask: boolean[][], radius: number): Set<string> {
    const avoid = new Set<string>();

    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    for (const s of starts) this.addAvoidRadius(avoid, level, s.x, s.y, radius);
    for (const g of level.ghostStarts) this.addAvoidRadius(avoid, level, g.x, g.y, radius);

    if (this.player) {
      const t = worldToTile(this.player.view.x, this.player.view.y, this.tileSize);
      this.addAvoidRadius(avoid, level, t.x, t.y, Math.max(radius, 2));
    }
    if (this.coopPlayer) {
      const t = worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize);
      this.addAvoidRadius(avoid, level, t.x, t.y, Math.max(radius, 2));
    }
    for (const ghost of this.ghosts) {
      const t = ghost.getTile();
      this.addAvoidRadius(avoid, level, t.x, t.y, radius);
    }

    for (const k of this.bombPickups.keys()) avoid.add(k);
    for (const k of this.activeBombs.keys()) avoid.add(k);
    for (const k of this.boxes.keys()) avoid.add(k);
    for (const k of this.fruitPickups.keys()) avoid.add(k);
    if (this.activeFruit) avoid.add(this.tileKey(this.activeFruit.tileX, this.activeFruit.tileY));

    // Never spawn on protected tiles.
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        if (!protectedMask[y]![x]) continue;
        avoid.add(this.tileKey(x, y));
      }
    }

    return avoid;
  }

  private addAvoidRadius(avoid: Set<string>, level: ParsedLevel, cx: number, cy: number, radius: number): void {
    if (radius <= 0) {
      avoid.add(this.tileKey(cx, cy));
      return;
    }
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= level.width || y >= level.height) continue;
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        avoid.add(this.tileKey(x, y));
      }
    }
  }

  private buildReachableFromStart(level: ParsedLevel): boolean[][] {
    const visited: boolean[][] = Array.from({ length: level.height }, () => Array.from({ length: level.width }, () => false));
    if (!level.startPos) return visited;

    const queue: Array<{ x: number; y: number }> = [{ x: level.startPos.x, y: level.startPos.y }];
    visited[level.startPos.y]![level.startPos.x] = true;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ] as const;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of dirs) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
        if (visited[ny]![nx]) continue;
        if (!isWalkable(level.tileMatrix[ny]![nx]!)) continue;
        visited[ny]![nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    return visited;
  }

  private pickRandomWalkableTileFiltered(
    level: ParsedLevel,
    rng: Rng,
    avoid: Set<string>,
    protectedMask: boolean[][],
    options: { preferEmpty: boolean }
  ): { x: number; y: number } | null {
    const empty: Array<{ x: number; y: number }> = [];
    const other: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        if (protectedMask[y]![x]) continue;
        const t = level.tileMatrix[y]![x]!;
        if (!isWalkable(t)) continue;
        const key = this.tileKey(x, y);
        if (avoid.has(key)) continue;
        (t === "empty" ? empty : other).push({ x, y });
      }
    }
    const pool = options.preferEmpty && empty.length > 0 ? empty : empty.length > 0 ? empty.concat(other) : other;
    if (pool.length === 0) return null;
    return pool[Math.floor(rng.nextFloat() * pool.length)] ?? null;
  }

  private showVibeShiftChangeOverlay(level: ParsedLevel, tiles: Array<{ x: number; y: number }>, durationMs: number): void {
    if (this.gameMode !== "vibe") return;
    if (!this.levelLayer) return;
    if (tiles.length === 0) return;

    this.vibeChangeClearEvent?.destroy();
    this.vibeChangeClearEvent = undefined;
    this.vibeChangeOverlay?.destroy();
    this.vibeChangeOverlay = undefined;

    const g = this.add.graphics();
    g.setDepth(9000);
    this.addToLevelOverlay(g);

    for (const t of tiles) {
      if (t.x < 0 || t.y < 0 || t.x >= level.width || t.y >= level.height) continue;
      const tile = level.tileMatrix[t.y]?.[t.x];
      if (!tile) continue;

      const isWallNow = tile === "wall";
      const fill = isWallNow ? 0xff6b6b : 0x7cffb2;
      const stroke = isWallNow ? 0xff9a9a : 0xb8ffd7;

      const px = t.x * this.tileSize;
      const py = t.y * this.tileSize;
      g.fillStyle(fill, isWallNow ? 0.22 : 0.16);
      g.fillRect(px, py, this.tileSize, this.tileSize);
      g.lineStyle(2, stroke, 0.7);
      g.strokeRect(px + 1, py + 1, this.tileSize - 2, this.tileSize - 2);
    }

    // Gentle fade-out.
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: Math.max(300, Math.floor(durationMs * 0.35)),
      delay: Math.max(200, durationMs - Math.floor(durationMs * 0.35)),
      ease: "Quad.easeIn"
    });

    this.vibeChangeOverlay = g;
    this.vibeChangeClearEvent = this.time.delayedCall(Math.max(600, durationMs), () => {
      this.vibeChangeOverlay?.destroy();
      this.vibeChangeOverlay = undefined;
    });
  }

  private showVibeShiftDebugOverlay(): void {
    if (this.gameMode !== "vibe") return;
    if (!this.levelLayer) return;
    if (this.lastVibeMutatedTiles.length === 0) return;

    this.vibeDebugOverlay?.destroy();
    this.vibeDebugOverlay = this.add.graphics();
    this.vibeDebugOverlay.setDepth(9999);
    this.levelLayer.add(this.vibeDebugOverlay);

    this.vibeDebugOverlay.fillStyle(0x7cffb2, 0.18);
    this.vibeDebugOverlay.lineStyle(2, 0x7cffb2, 0.55);
    for (const t of this.lastVibeMutatedTiles) {
      const px = t.x * this.tileSize;
      const py = t.y * this.tileSize;
      this.vibeDebugOverlay.fillRect(px, py, this.tileSize, this.tileSize);
      this.vibeDebugOverlay.strokeRect(px, py, this.tileSize, this.tileSize);
    }

    this.vibeDebugClearEvent?.destroy();
    this.vibeDebugClearEvent = this.time.delayedCall(1000, () => {
      this.vibeDebugOverlay?.destroy();
      this.vibeDebugOverlay = undefined;
    });
  }

  private setupBombPickups(level: ParsedLevel): void {
    if (!this.levelLayer) return;
    if (!level.startPos && level.playerStarts.length === 0) return;

    // Clear existing pickups/bombs (scene restart safety).
    for (const p of this.bombPickups.values()) p.destroy();
    this.bombPickups.clear();
    for (const b of this.activeBombs.values()) this.destroyActiveBomb(b);
    this.activeBombs.clear();
    this.bombsAvailable = 0;
    this.refreshBombDisplay();
    for (const e of this.activeExplosions) e.destroy();
    this.activeExplosions = [];

    const avoid = new Set<string>();
    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    for (const s of starts) avoid.add(this.tileKey(s.x, s.y));
    for (const g of level.ghostStarts) avoid.add(this.tileKey(g.x, g.y));

    if (level.bombPickupPositions.length > 0) {
      for (const p of level.bombPickupPositions) {
        this.spawnBombPickupAt(level, p.x, p.y, avoid);
      }
      return;
    }

    const targetCount = this.settings.difficulty === "easy" ? 4 : this.settings.difficulty === "hard" ? 2 : 3;
    const rng = this.buildRng("bomb-pickups");

    for (let placed = 0, attempts = 0; placed < targetCount && attempts < targetCount * 60; attempts++) {
      const tile = this.pickRandomWalkableTile(level, rng, avoid);
      if (!tile) break;
      if (this.spawnBombPickupAt(level, tile.x, tile.y, avoid)) placed += 1;
    }
  }

  private spawnBombPickupAt(level: ParsedLevel, tileX: number, tileY: number, avoid: Set<string>): boolean {
    if (!this.levelLayer) return false;
    if (tileX < 0 || tileY < 0 || tileX >= level.width || tileY >= level.height) return false;
    if (!isWalkable(level.tileMatrix[tileY]![tileX]!)) return false;

    const key = this.tileKey(tileX, tileY);
    if (avoid.has(key)) return false;
    if (this.bombPickups.has(key)) return false;

    avoid.add(key);

    const pos = tileCenter(tileX, tileY, this.tileSize);
    const sprite = this.add.sprite(pos.x, pos.y, "obj-bomb");
    sprite.setDisplaySize(Math.floor(this.tileSize * 0.7), Math.floor(this.tileSize * 0.7));
    this.addToLevelOverlay(sprite);
    this.bombPickups.set(key, sprite);
    return true;
  }

  private setupBoxes(level: ParsedLevel): void {
    if (!this.levelLayer) return;
    if (!level.startPos && level.playerStarts.length === 0) return;

    for (const box of this.boxes.values()) box.destroy();
    this.boxes.clear();

    const avoid = new Set<string>();
    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    for (const s of starts) avoid.add(this.tileKey(s.x, s.y));
    for (const g of level.ghostStarts) avoid.add(this.tileKey(g.x, g.y));
    for (const k of this.bombPickups.keys()) avoid.add(k);

    if (level.boxPositions.length > 0) {
      for (const p of level.boxPositions) {
        this.tryPlaceBoxAt(level, p.x, p.y, avoid, { requireCorridor: false, requireSolvable: false });
      }
    }
  }

  private tryPlaceBoxAt(
    level: ParsedLevel,
    tileX: number,
    tileY: number,
    avoid: Set<string>,
    options: { requireCorridor: boolean; requireSolvable: boolean }
  ): boolean {
    if (!this.levelLayer) return false;
    if (tileX < 0 || tileY < 0 || tileX >= level.width || tileY >= level.height) return false;
    if (level.tileMatrix[tileY]![tileX]! !== "empty") return false;
    if (options.requireCorridor && !this.isCorridorTile(level, tileX, tileY)) return false;

    const key = this.tileKey(tileX, tileY);
    if (avoid.has(key)) return false;

    // Tentatively block the tile and ensure the level remains solvable without needing bombs.
    level.tileMatrix[tileY]![tileX] = "wall";
    if (options.requireSolvable && !this.allConsumablesReachable(level)) {
      level.tileMatrix[tileY]![tileX] = "empty";
      return false;
    }

    const pos = tileCenter(tileX, tileY, this.tileSize);
    const sprite = this.add.sprite(pos.x, pos.y, "obj-box");
    sprite.setDisplaySize(Math.floor(this.tileSize * 0.9), Math.floor(this.tileSize * 0.9));
    this.addToLevelOverlay(sprite);

    this.boxes.set(key, sprite);
    avoid.add(key);
    return true;
  }

  private setupFruitSpawning(level: ParsedLevel): void {
    if (!this.levelLayer) return;

    this.activeFruit?.despawnEvent?.destroy();
    this.activeFruit?.view.destroy();
    this.activeFruit = undefined;

    for (const fruit of this.fruitPickups.values()) fruit.view.destroy();
    this.fruitPickups.clear();

    this.fruitSpawnEvent?.destroy();
    this.fruitSpawnEvent = undefined;

    if (level.fruitSpawnPositions.length > 0) {
      this.setupPreplacedFruits(level);
      return;
    }

    const delayMs = this.settings.difficulty === "easy" ? 12000 : this.settings.difficulty === "hard" ? 18000 : 15000;
    this.fruitSpawnEvent = this.time.addEvent({
      delay: delayMs,
      loop: true,
      callback: () => {
        if (this.victoryActive || this.caughtActive || this.deathActive) return;
        this.spawnFruit(level);
      }
    });
  }

  private spawnFruit(level: ParsedLevel): void {
    if (!this.levelLayer) return;
    if (this.activeFruit) return;

    const rng = this.buildRng(`fruit-${Math.floor(this.time.now)}`);
    const avoid = new Set<string>();
    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    for (const s of starts) avoid.add(this.tileKey(s.x, s.y));
    for (const g of level.ghostStarts) avoid.add(this.tileKey(g.x, g.y));
    for (const k of this.bombPickups.keys()) avoid.add(k);
    for (const k of this.activeBombs.keys()) avoid.add(k);
    for (const k of this.boxes.keys()) avoid.add(k);
    for (const k of this.fruitPickups.keys()) avoid.add(k);

    let tile = null as { x: number; y: number } | null;
    if (!tile) tile = this.pickRandomWalkableTile(level, rng, avoid);
    if (!tile) return;

    const fruits = [
      { key: "fruit-cherry", score: 100 },
      { key: "fruit-strawberry", score: 300 },
      { key: "fruit-orange", score: 500 },
      { key: "fruit-apple", score: 700 },
      { key: "fruit-melon", score: 1000 }
    ] as const;
    const pick = fruits[Math.floor(rng.frac() * fruits.length)]!;

    const pos = tileCenter(tile.x, tile.y, this.tileSize);
    const sprite = this.add.sprite(pos.x, pos.y, pick.key);
    sprite.setDisplaySize(Math.floor(this.tileSize * 0.8), Math.floor(this.tileSize * 0.8));
    this.addToLevelOverlay(sprite);

    const fruit: ActiveFruit = { tileX: tile.x, tileY: tile.y, view: sprite, score: pick.score };
    fruit.despawnEvent = this.time.delayedCall(8000, () => {
      if (this.activeFruit === fruit) {
        fruit.view.destroy();
        this.activeFruit = undefined;
      }
    });
    this.activeFruit = fruit;
  }

  private tryCollectFruit(tileX: number, tileY: number): void {
    const key = this.tileKey(tileX, tileY);
    const pickup = this.fruitPickups.get(key);
    if (pickup) {
      pickup.view.destroy();
      this.fruitPickups.delete(key);

      this.score += pickup.score;
      this.scoreText?.setText(`Score: ${this.score}`);
      this.playSfx("chomp");
      this.toast(`Fruit +${pickup.score}`, 900);
      return;
    }

    if (!this.activeFruit) return;
    if (this.activeFruit.tileX !== tileX || this.activeFruit.tileY !== tileY) return;

    const scoreDelta = this.activeFruit.score;
    this.activeFruit.despawnEvent?.destroy();
    this.activeFruit.view.destroy();
    this.activeFruit = undefined;

    this.score += scoreDelta;
    this.scoreText?.setText(`Score: ${this.score}`);
    this.playSfx("chomp");
    this.toast(`Fruit +${scoreDelta}`, 900);
  }

  private setupPreplacedFruits(level: ParsedLevel): void {
    if (!this.levelLayer) return;

    const rng = this.buildRng("preplaced-fruits");
    const avoid = new Set<string>();
    const starts = level.playerStarts.length > 0 ? level.playerStarts : level.startPos ? [level.startPos] : [];
    for (const s of starts) avoid.add(this.tileKey(s.x, s.y));
    for (const g of level.ghostStarts) avoid.add(this.tileKey(g.x, g.y));
    for (const k of this.boxes.keys()) avoid.add(k);
    for (const k of this.bombPickups.keys()) avoid.add(k);

    const fruits = [
      { key: "fruit-cherry", score: 100 },
      { key: "fruit-strawberry", score: 300 },
      { key: "fruit-orange", score: 500 },
      { key: "fruit-apple", score: 700 },
      { key: "fruit-melon", score: 1000 }
    ] as const;

    for (const pos of level.fruitSpawnPositions) {
      if (pos.x < 0 || pos.y < 0 || pos.x >= level.width || pos.y >= level.height) continue;
      if (!isWalkable(level.tileMatrix[pos.y]![pos.x]!)) continue;

      const key = this.tileKey(pos.x, pos.y);
      if (avoid.has(key) || this.fruitPickups.has(key)) continue;
      avoid.add(key);

      const pick = fruits[Math.floor(rng.frac() * fruits.length)]!;
      const p = tileCenter(pos.x, pos.y, this.tileSize);
      const sprite = this.add.sprite(p.x, p.y, pick.key);
      sprite.setDisplaySize(Math.floor(this.tileSize * 0.8), Math.floor(this.tileSize * 0.8));
      this.addToLevelOverlay(sprite);

      this.fruitPickups.set(key, { tileX: pos.x, tileY: pos.y, view: sprite, score: pick.score });
    }
  }

  private tryCollectBombPickup(tileX: number, tileY: number): void {
    const key = this.tileKey(tileX, tileY);
    const pickup = this.bombPickups.get(key);
    if (!pickup) return;

    pickup.destroy();
    this.bombPickups.delete(key);

    this.bombsAvailable += 1;
    this.refreshBombDisplay();
    this.toast("Bomb +1", 900);
  }

  private tryPlaceBomb(tileX: number, tileY: number): void {
    if (!this.levelLayer) return;
    if (this.bombsAvailable <= 0) {
      this.toast("No bombs", 700);
      return;
    }

    const key = this.tileKey(tileX, tileY);
    if (this.activeBombs.has(key)) return;

    this.bombsAvailable -= 1;
    this.refreshBombDisplay();

    const pos = tileCenter(tileX, tileY, this.tileSize);
    const sprite = this.add.sprite(pos.x, pos.y, "bomb-ignited-1");
    sprite.setDisplaySize(Math.floor(this.tileSize * 0.75), Math.floor(this.tileSize * 0.75));
    if (this.anims.exists("bomb-ignited")) sprite.play("bomb-ignited");
    this.addToLevelOverlay(sprite);

    const countdown = this.add
      .text(pos.x, pos.y - Math.floor(this.tileSize * 0.65), "3", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: `${Math.max(12, Math.floor(this.tileSize * 0.45))}px`,
        color: "#e6f0ff",
        stroke: "#0b1020",
        strokeThickness: 3
      })
      .setOrigin(0.5, 0.5);
    this.levelLayer.add(countdown);

    const bomb: ActiveBomb = { tileX, tileY, view: sprite, countdownText: countdown };
    this.activeBombs.set(key, bomb);

    const fuseMs = 2400;
    let remaining = 3;
    bomb.countdownEvent = this.time.addEvent({
      delay: fuseMs / 3,
      repeat: 2,
      callback: () => {
        remaining -= 1;
        if (remaining > 0) bomb.countdownText?.setText(String(remaining));
      }
    });
    bomb.explodeEvent = this.time.delayedCall(fuseMs, () => this.explodeBomb(tileX, tileY));
  }

  private explodeBomb(tileX: number, tileY: number): void {
    if (!this.levelLayer) return;
    const key = this.tileKey(tileX, tileY);
    const bomb = this.activeBombs.get(key);
    if (!bomb) return;

    this.destroyActiveBomb(bomb);
    this.activeBombs.delete(key);
    this.playSfx("explosion");

    const pos = tileCenter(tileX, tileY, this.tileSize);
    const explosion = this.add.sprite(pos.x, pos.y, "bomb-explosion-1");
    explosion.setDisplaySize(Math.floor(this.tileSize * 1.5), Math.floor(this.tileSize * 1.5));
    this.levelLayer.add(explosion);
    this.activeExplosions.push(explosion);
    explosion.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.activeExplosions = this.activeExplosions.filter((e) => e !== explosion);
    });

    if (this.anims.exists("bomb-explosion")) {
      explosion.play("bomb-explosion");
      explosion.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + "bomb-explosion", () => explosion.destroy());
    } else {
      this.time.delayedCall(450, () => explosion.destroy());
    }

    const radius = 1;
    let eaten = 0;
    for (const ghost of this.ghosts) {
      if (ghost.state === GhostState.Eaten) continue;
      const gt = ghost.getTile();
      const dx = Math.abs(gt.x - tileX);
      const dy = Math.abs(gt.y - tileY);
      if (dx + dy > radius) continue;
      ghost.eat();
      eaten += 1;
    }

    if (eaten > 0) {
      this.playSfx("eatghost");
      this.score += 200 * eaten;
      this.scoreText?.setText(`Score: ${this.score}`);
      this.toast(`Boom! +${200 * eaten}`, 900);
    }

    const destroyedBoxes = this.destroyBoxesInRadius(tileX, tileY, radius);
    if (destroyedBoxes > 0) {
      if (this.parsedLevel && this.wallsGraphics) drawWalls(this.wallsGraphics, this.parsedLevel, this.tileSize);
      this.score += 25 * destroyedBoxes;
      this.scoreText?.setText(`Score: ${this.score}`);
      this.toast(`Boxes -${destroyedBoxes} (+${25 * destroyedBoxes})`, 900);
    }
  }

  private destroyActiveBomb(bomb: ActiveBomb): void {
    bomb.explodeEvent?.destroy();
    bomb.countdownEvent?.destroy();
    bomb.countdownText?.destroy();
    bomb.view.destroy();
  }

  private cleanupDynamicObjects(): void {
    for (const p of this.bombPickups.values()) p.destroy();
    this.bombPickups.clear();
    for (const b of this.activeBombs.values()) this.destroyActiveBomb(b);
    this.activeBombs.clear();
    this.bombsAvailable = 0;
    this.refreshBombDisplay();

    if (this.parsedLevel) {
      for (const [key, box] of this.boxes) {
        box.destroy();
        const [xStr, yStr] = key.split(",");
        const x = Number(xStr);
        const y = Number(yStr);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          if (this.parsedLevel.tileMatrix[y]?.[x] === "wall") this.parsedLevel.tileMatrix[y]![x] = "empty";
        }
      }
    } else {
      for (const box of this.boxes.values()) box.destroy();
    }
    this.boxes.clear();

    this.activeFruit?.despawnEvent?.destroy();
    this.activeFruit?.view.destroy();
    this.activeFruit = undefined;
    for (const fruit of this.fruitPickups.values()) fruit.view.destroy();
    this.fruitPickups.clear();
    this.fruitSpawnEvent?.destroy();
    this.fruitSpawnEvent = undefined;
  }

  private tileKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private addToLevelOverlay(obj: Phaser.GameObjects.GameObject): void {
    if (!this.levelLayer) return;
    const insertIndex = Math.min(2, this.levelLayer.list.length);
    this.levelLayer.addAt(obj, insertIndex);
  }

  private buildRng(tag: string): Phaser.Math.RandomDataGenerator {
    const seedBase = this.levelJson.id ?? this.levelJson.grid.join("\n");
    const seed = `${seedBase}|${this.settings.difficulty}|${tag}`;
    return new Phaser.Math.RandomDataGenerator([seed]);
  }

  private pickRandomWalkableTile(
    level: ParsedLevel,
    rng: Phaser.Math.RandomDataGenerator,
    avoid: Set<string>
  ): { x: number; y: number } | null {
    const candidates: { x: number; y: number }[] = [];
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        if (level.tileMatrix[y]![x]! === "wall") continue;
        const key = this.tileKey(x, y);
        if (avoid.has(key)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng.frac() * candidates.length)] ?? null;
  }

  private isCorridorTile(level: ParsedLevel, x: number, y: number): boolean {
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ] as const;

    let open = 0;
    for (const d of dirs) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
      if (isWalkable(level.tileMatrix[ny]![nx]!)) open += 1;
    }
    return open >= 2;
  }

  private allConsumablesReachable(level: ParsedLevel): boolean {
    if (!level.startPos) return false;

    const height = level.height;
    const width = level.width;
    const visited: boolean[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
    const queue: { x: number; y: number }[] = [{ x: level.startPos.x, y: level.startPos.y }];
    visited[level.startPos.y]![level.startPos.x] = true;

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ] as const;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of dirs) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (visited[ny]![nx]) continue;
        if (!isWalkable(level.tileMatrix[ny]![nx]!)) continue;
        visited[ny]![nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = level.tileMatrix[y]![x]!;
        if (t === "pellet" || t === "power") {
          if (!visited[y]![x]) return false;
        }
      }
    }

    return true;
  }

  private destroyBoxesInRadius(tileX: number, tileY: number, radius: number): number {
    if (!this.parsedLevel) return 0;

    let destroyed = 0;
    const toDelete: string[] = [];
    for (const [key, box] of this.boxes) {
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dx = Math.abs(x - tileX);
      const dy = Math.abs(y - tileY);
      if (dx + dy > radius) continue;

      box.destroy();
      toDelete.push(key);
      if (this.parsedLevel.tileMatrix[y]?.[x] === "wall") {
        if (this.gameMode === "vibe" && this.pellets?.spawnPowerPelletAt(x, y)) {
          // Power pellet dropped from destroyed box.
        } else {
          this.parsedLevel.tileMatrix[y]![x] = "empty";
          this.pellets?.redraw();
        }
      }
      destroyed += 1;
    }

    for (const key of toDelete) this.boxes.delete(key);

    return destroyed;
  }

  private setupMobileControls(): void {
    this.touchDirection = Direction.None;
    this.swipe?.destroy();
    this.swipe = new SwipeControls(this, (dir) => {
      this.touchDirection = dir;
    }, { thresholdPx: Math.max(24, Math.floor(this.tileSize * 0.6)) });

    this.dpad?.destroy();
    this.dpad = new DPad(this, {
      onDirection: (dir) => {
        this.touchDirection = dir;
      }
    });

    const likelyTouch =
      this.sys.game.device.input.touch ||
      (typeof window !== "undefined" && "ontouchstart" in window);

    const showControls = Boolean(likelyTouch) || this.scale.width < 900;
    this.dpad.setVisible(showControls);
    this.dpad.layout(this.cameras.main.width, this.cameras.main.height, this.getDpadLayoutOptions(this.cameras.main.width, this.cameras.main.height));
    this.setupBombTouchButton(showControls);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.swipe?.destroy();
      this.dpad?.destroy();
      this.destroyBombTouchButton();
    });
  }

  private setupBombTouchButton(visible: boolean): void {
    this.destroyBombTouchButton();
    if (!visible) return;

    const container = this.add.container(0, 0).setDepth(2000).setScrollFactor(0);
    const bg = this.add.graphics().setScrollFactor(0);
    const zone = this.add.zone(0, 0, 1, 1).setOrigin(0.5).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    const icon = this.add.image(0, 0, "obj-bomb").setOrigin(0.5).setScrollFactor(0);
    const label = this.add
      .text(0, 0, "BOMB", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#e6f0ff"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0.85);

    zone.on("pointerdown", () => {
      if (this.victoryActive || this.caughtActive || this.deathActive) return;
      this.triggerBombPlacement();
      // subtle press feedback
      this.tweens.add({ targets: container, scale: 0.96, duration: 60, yoyo: true });
    });

    container.add([bg, zone, icon, label]);

    this.bombTouch = container;
    this.bombTouchBg = bg;
    this.bombTouchZone = zone;
    this.bombTouchIcon = icon;
    this.bombTouchLabel = label;

    this.layoutBombTouchButton(this.cameras.main.width, this.cameras.main.height);
  }

  private destroyBombTouchButton(): void {
    this.bombTouch?.destroy(true);
    this.bombTouch = undefined;
    this.bombTouchBg = undefined;
    this.bombTouchZone = undefined;
    this.bombTouchIcon = undefined;
    this.bombTouchLabel = undefined;
  }

  private layoutBombTouchButton(viewWidth: number, viewHeight: number): void {
    if (!this.bombTouch || !this.bombTouchBg || !this.bombTouchZone || !this.bombTouchIcon || !this.bombTouchLabel) return;

    const m = this.getMobileUiMetrics(viewWidth, viewHeight);
    const size = m.bomb.size;
    const margin = m.bomb.margin;

    const minY = margin + size / 2;
    const maxY = Math.max(minY, viewHeight - margin - size / 2);
    const y =
      this.mobileLayoutActive && m.isPortrait && m.showTouchControls && this.mobileControlsCenterY !== null
        ? Math.min(maxY, Math.max(minY, this.mobileControlsCenterY))
        : m.bomb.anchor === "mid-right"
          ? Math.min(maxY, Math.max(minY, Math.floor(viewHeight * 0.62)))
          : maxY;
    const x = viewWidth - (margin + size / 2);

    this.bombTouch.setPosition(x, y);

    this.bombTouchBg.clear();
    this.bombTouchBg.fillStyle(0xffffff, 0.06);
    this.bombTouchBg.fillCircle(0, 0, size / 2);
    this.bombTouchBg.lineStyle(2, 0x9fb4d6, 0.25);
    this.bombTouchBg.strokeCircle(0, 0, size / 2);

    this.bombTouchZone.setSize(size, size);
    this.bombTouchIcon.setDisplaySize(30, 30);
    this.bombTouchIcon.setPosition(0, -6);
    this.bombTouchLabel.setPosition(0, 22);
  }

  private triggerBombPlacement(): void {
    if (!this.player) return;
    const playerTile = worldToTile(this.player.view.x, this.player.view.y, this.tileSize);
    const coopTile = this.coopPlayer ? worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize) : null;
    this.tryPlaceBomb(playerTile.x, playerTile.y);
    if (coopTile && (coopTile.x !== playerTile.x || coopTile.y !== playerTile.y)) {
      this.tryPlaceBomb(coopTile.x, coopTile.y);
    }
  }

  update(_time: number, delta: number): void {
    if (this.victoryActive || this.caughtActive) {
      if (this.restartKey && Phaser.Input.Keyboard.JustDown(this.restartKey)) this.restart();
      return;
    }
    if (this.deathActive) return;
    if (!this.player || !this.parsedLevel || !this.pellets || !this.levelLayer) return;

    const desired = this.viewMode === "fps" ? this.readDesiredDirectionFps(delta) : this.readDesiredDirection();
    if (this.viewMode === "fps") {
      if (desired !== Direction.None) {
        this.player.setDesiredDirection(desired);
        this.coopPlayer?.setDesiredDirection(desired);
      } else if (this.fpsTurningActive || !this.fpsMoveInputActive) {
        this.haltFpsMovement();
      }
    } else if (desired !== Direction.None) {
      this.player.setDesiredDirection(desired);
      this.coopPlayer?.setDesiredDirection(desired);
    }

    this.player.update(delta);
    this.coopPlayer?.update(delta);

    const playerTile = worldToTile(this.player.view.x, this.player.view.y, this.tileSize);
    const coopTile = this.coopPlayer ? worldToTile(this.coopPlayer.view.x, this.coopPlayer.view.y, this.tileSize) : null;

    if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.triggerBombPlacement();
    }

    const tiles = new Map<string, { x: number; y: number }>();
    tiles.set(this.tileKey(playerTile.x, playerTile.y), { x: playerTile.x, y: playerTile.y });
    if (coopTile) tiles.set(this.tileKey(coopTile.x, coopTile.y), { x: coopTile.x, y: coopTile.y });

    let scoreDelta = 0;
    let anyCollected = false;
    let collectedPower = false;

    for (const t of tiles.values()) {
      this.tryCollectBombPickup(t.x, t.y);
      this.tryCollectFruit(t.x, t.y);

      const collect = this.pellets.tryCollectAt(t.x, t.y);
      if (!collect) continue;
      if (collect.scoreDelta > 0) {
        anyCollected = true;
        scoreDelta += collect.scoreDelta;
      }
      if (collect.collected === "power") collectedPower = true;
    }

    if (anyCollected) {
      this.playSfx("chomp");
      this.score += scoreDelta;
      this.scoreText?.setText(`Score: ${this.score}`);
      if (collectedPower) this.frightenedUntilMs = startFrightened(this.time.now, FRIGHTENED_DURATION_MS);
      if (this.pellets.getRemainingPellets() === 0) {
        this.showVictory();
        return;
      }
    }

    if (collectedPower) this.tryVibeReorgShift(this.parsedLevel, "power");

    const frightened = isFrightened(this.time.now, this.frightenedUntilMs);
    for (const ghost of this.ghosts) {
      const targetTile =
        coopTile && this.coopPlayer
          ? this.chooseClosestPlayerTile(ghost, playerTile, coopTile)
          : playerTile;

      ghost.update(delta, targetTile, frightened);
      if (ghost.state === GhostState.Eaten) continue;
      const caughtPrimary = this.checkCaught(ghost, this.player);
      const caughtCoop = this.coopPlayer ? this.checkCaught(ghost, this.coopPlayer) : false;
      if (!caughtPrimary && !caughtCoop) continue;

      if (frightened && ghost.state === GhostState.Frightened) {
        ghost.eat();
        this.playSfx("eatghost");
        this.score += 200;
        this.scoreText?.setText(`Score: ${this.score}`);
        continue;
      }

      this.loseLifeAndMaybeGameOver();
      return;
    }

    if (this.time.now < this.toastUntilMs) {
      this.debugText?.setText(this.toastMessage);
    } else {
      this.debugText?.setText("");
    }

    if (this.gKey && Phaser.Input.Keyboard.JustDown(this.gKey)) {
      this.showVibeShiftDebugOverlay();
    }

    if (this.viewMode === "fps" && this.fpsRenderer && this.parsedLevel && this.player && this.pellets) {
      this.tickFpsLookYaw();
      const frame: FpsRendererFrame = {
        nowMs: this.time.now,
        level: this.parsedLevel,
        tileSize: this.tileSize,
        player: this.player,
        coopPlayer: this.coopPlayer,
        ghosts: this.ghosts,
        frightened,
          pellets: this.pellets,
          bombs: this.collectFpsBombSprites(),
          boxes: this.collectFpsBoxSprites(),
          explosions: this.collectFpsExplosionSprites(),
          viewYawRad: this.fpsLookYawRad
        };
      this.fpsRenderer.setManualYaw(this.fpsLookYawRad);
      this.fpsRenderer.render(frame);
      this.fpsHud?.tick(frame);
      this.fpsMiniMap?.tick(frame);
    }
  }

  private tickFpsLookYaw(): void {
    const now = this.time.now;
    if (this.fpsLookYawTweenUntilMs <= now) {
      this.fpsLookYawRad = this.fpsLookYawTargetRad;
      return;
    }

    const total = 150;
    const remaining = this.fpsLookYawTweenUntilMs - now;
    const t = Math.max(0, Math.min(1, 1 - remaining / total));
    const smooth = t * t * (3 - 2 * t);

    let delta = this.fpsLookYawTargetRad - this.fpsLookYawFromRad;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    this.fpsLookYawRad = this.fpsLookYawFromRad + delta * smooth;
  }

  private readDesiredDirectionFps(deltaMs: number): Direction {
    const k = this.keys;

    // Turn head by exactly 90 deg per key press.
    const leftHeld = Boolean(k?.left?.isDown) || Boolean(k?.a?.isDown);
    const rightHeld = Boolean(k?.right?.isDown) || Boolean(k?.d?.isDown);
    const leftDown = Boolean(k?.left && Phaser.Input.Keyboard.JustDown(k.left)) || Boolean(k?.a && Phaser.Input.Keyboard.JustDown(k.a));
    const rightDown = Boolean(k?.right && Phaser.Input.Keyboard.JustDown(k.right)) || Boolean(k?.d && Phaser.Input.Keyboard.JustDown(k.d));
    if (leftDown || rightDown) {
      const step = Math.PI / 2;
      const delta = leftDown ? -step : step;
      const next = this.snapYawCardinal(this.fpsLookYawTargetRad + delta);
      this.fpsLookYawFromRad = this.fpsLookYawRad;
      this.fpsLookYawTargetRad = next;
      this.fpsLookYawTweenUntilMs = this.time.now + 150;
    }

    // Move: W/S or ArrowUp/ArrowDown (forward/back relative to look yaw).
    const forward = Boolean(k?.up?.isDown) || Boolean(k?.w?.isDown);
    const back = Boolean(k?.down?.isDown) || Boolean(k?.s?.isDown);
    const touchMove = this.touchDirection !== Direction.None;
    this.fpsTurningActive = leftHeld || rightHeld;
    this.fpsMoveInputActive = forward || back || touchMove;

    // While turning (left/right held), don't move.
    if (leftHeld || rightHeld) {
      return Direction.None;
    }

    // Mobile fallback: allow touch direction to drive movement if no keyboard intent.
    if (!forward && !back && this.touchDirection !== Direction.None) {
      // Also align view to touch direction on mobile (snap, then tween is optional).
      const next =
        this.touchDirection === Direction.Right
          ? 0
          : this.touchDirection === Direction.Down
            ? Math.PI / 2
            : this.touchDirection === Direction.Left
              ? Math.PI
              : (3 * Math.PI) / 2;
      this.fpsLookYawFromRad = this.fpsLookYawRad;
      this.fpsLookYawTargetRad = next;
      this.fpsLookYawTweenUntilMs = this.time.now + 120;
      return this.touchDirection;
    }

    if (forward === back) {
      // No movement intent -> no movement (A/D or Left/Right only rotate).
      return Direction.None;
    }

    const facing = this.cardinalFromYaw(this.fpsLookYawTargetRad, this.fpsMoveRefDir);
    this.fpsMoveRefDir = facing;
    const desired = back ? this.oppositeDir(facing) : facing;
    return desired;
  }

  private haltFpsMovement(): void {
    if (!this.player) return;
    this.haltPlayerMotion(this.player);
    if (this.coopPlayer) this.haltPlayerMotion(this.coopPlayer);
  }

  private haltPlayerMotion(player: Player): void {
    const tile = worldToTile(player.view.x, player.view.y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);
    player.view.setPosition(center.x, center.y);
    player.direction = Direction.None;
    player.desiredDirection = Direction.None;
  }

    private collectFpsBombSprites(): Phaser.GameObjects.Sprite[] {
      const out: Phaser.GameObjects.Sprite[] = [];
      for (const p of this.bombPickups.values()) {
        if (p.active && p.visible) out.push(p);
      }
      for (const b of this.activeBombs.values()) {
        if (b.view.active && b.view.visible) out.push(b.view);
      }
      return out;
    }

    private collectFpsBoxSprites(): Phaser.GameObjects.Sprite[] {
      const out: Phaser.GameObjects.Sprite[] = [];
      for (const b of this.boxes.values()) {
        if (b.active && b.visible) out.push(b);
      }
      return out;
    }

  private collectFpsExplosionSprites(): Phaser.GameObjects.Sprite[] {
    if (this.activeExplosions.length === 0) return [];
    return this.activeExplosions.filter((e) => e.active && e.visible);
  }

  private snapYawCardinal(yawRad: number): number {
    const twoPi = Math.PI * 2;
    let a = yawRad % twoPi;
    if (a < 0) a += twoPi;
    const step = Math.PI / 2;
    const idx = Math.round(a / step) % 4;
    return idx * step;
  }

  private cardinalFromYaw(yawRad: number, fallback: Direction): Direction {
    const c = Math.cos(yawRad);
    const s = Math.sin(yawRad);
    const ax = Math.abs(c);
    const ay = Math.abs(s);
    if (Math.abs(ax - ay) < 0.08) return fallback;
    if (ax > ay) return c >= 0 ? Direction.Right : Direction.Left;
    return s >= 0 ? Direction.Down : Direction.Up;
  }

  private oppositeDir(d: Direction): Direction {
    switch (d) {
      case Direction.Up:
        return Direction.Down;
      case Direction.Down:
        return Direction.Up;
      case Direction.Left:
        return Direction.Right;
      case Direction.Right:
        return Direction.Left;
      case Direction.None:
      default:
        return Direction.None;
    }
  }

  private setupViewMode(level: ParsedLevel): void {
    if (this.viewMode !== "fps") {
      this.levelLayer?.setVisible(true);
      this.fpsRenderer?.destroy();
      this.fpsRenderer = undefined;
      this.fpsHud?.destroy();
      this.fpsHud = undefined;
      this.fpsMiniMap?.destroy();
      this.fpsMiniMap = undefined;
      return;
    }

    // Hide classic top-down visuals without touching gameplay (sprites still update positions for logic).
    this.levelLayer?.setVisible(false);

    const viewWidth = this.cameras.main.width;
    const viewHeight = this.cameras.main.height;
    this.fpsRenderer?.destroy();
    this.fpsRenderer = new FpsRenderer(this, { width: viewWidth, height: viewHeight });
    this.fpsRenderer.setLevel(level, { tileSize: this.tileSize });
    // Initialize view direction.
    if (this.player?.direction === Direction.Up) this.fpsLookYawRad = (3 * Math.PI) / 2;
    else if (this.player?.direction === Direction.Down) this.fpsLookYawRad = Math.PI / 2;
    else if (this.player?.direction === Direction.Left) this.fpsLookYawRad = Math.PI;
    else this.fpsLookYawRad = 0;
    this.fpsLookYawRad = this.snapYawCardinal(this.fpsLookYawRad);
    this.fpsLookYawTargetRad = this.fpsLookYawRad;
    this.fpsLookYawFromRad = this.fpsLookYawRad;
    this.fpsLookYawTweenUntilMs = 0;

    this.fpsHud?.destroy();
    this.fpsHud = new HudNavigator(this);
    this.fpsHud.setVisible(true);
    this.fpsHud.layout(viewWidth, viewHeight);

    this.fpsMiniMap?.destroy();
    this.fpsMiniMap = new HudMiniMap(this);
    this.fpsMiniMap.setLevel(level);
    this.fpsMiniMap.layout(viewWidth, viewHeight);
  }

  private loseLifeAndMaybeGameOver(): void {
    if (!this.player || !this.parsedLevel) return;
    const starts = this.parsedLevel.playerStarts.length > 0 ? this.parsedLevel.playerStarts : this.parsedLevel.startPos ? [this.parsedLevel.startPos] : [];
    if (starts.length === 0) return;
    if (this.time.now < this.invulnerableUntilMs) return;
    if (this.deathActive || this.player.isDying() || this.coopPlayer?.isDying()) return;

    this.lives = Math.max(0, this.lives - 1);
    this.refreshLivesDisplay();
    this.playSfx("death");

    // Pause the game while death animation plays.
    this.deathActive = true;
    this.frightenedUntilMs = 0;
    this.touchDirection = Direction.None;
    for (const ghost of this.ghosts) ghost.stop();

    this.player.startDeath();
    this.coopPlayer?.startDeath();

    const finish = () => {
      this.deathActive = false;

      if (this.lives <= 0) {
        this.showCaught();
        return;
      }

      // Respawn player + ghosts, keep pellets/score intact.
      this.invulnerableUntilMs = this.time.now + 1200;
      const s1 = starts[0]!;
      const s2 = starts[1] ?? s1;
      this.player?.resetToTile(s1.x, s1.y);
      this.coopPlayer?.resetToTile(s2.x, s2.y);
      for (const ghost of this.ghosts) ghost.resetToStart(false);
    };

    // Use the dedicated death animation; fallback to a short timer if it can't fire.
    this.player.view.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + "pacman-death", finish);
    this.time.delayedCall(1400, () => {
      if (this.deathActive) finish();
    });
  }

  private checkCaught(ghost: Ghost, player: Player): boolean {
    if (this.time.now < this.invulnerableUntilMs) return false;
    if (ghost.state === GhostState.Eaten) return false;
    const dx = ghost.view.x - player.view.x;
    const dy = ghost.view.y - player.view.y;
    const dist2 = dx * dx + dy * dy;
    const threshold = (this.tileSize * 0.35) ** 2;
    return dist2 <= threshold;
  }

  private chooseClosestPlayerTile(ghost: Ghost, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    const gt = ghost.getTile();
    const da = (a.x - gt.x) * (a.x - gt.x) + (a.y - gt.y) * (a.y - gt.y);
    const db = (b.x - gt.x) * (b.x - gt.x) + (b.y - gt.y) * (b.y - gt.y);
    return da <= db ? a : b;
  }

  private readDesiredDirection(): Direction {
    const k = this.keys;
    if (k) {
      if (k.left.isDown || k.a.isDown) {
        this.bumpTurnBuffer(Direction.Left);
        return Direction.Left;
      }
      if (k.right.isDown || k.d.isDown) {
        this.bumpTurnBuffer(Direction.Right);
        return Direction.Right;
      }
      if (k.up.isDown || k.w.isDown) {
        this.bumpTurnBuffer(Direction.Up);
        return Direction.Up;
      }
      if (k.down.isDown || k.s.isDown) {
        this.bumpTurnBuffer(Direction.Down);
        return Direction.Down;
      }
    }

    if (this.touchDirection !== Direction.None) {
      this.bumpTurnBuffer(this.touchDirection);
      return this.touchDirection;
    }

    if (this.turnBufferDirection !== Direction.None && this.time.now < this.turnBufferUntilMs) {
      return this.turnBufferDirection;
    }

    return Direction.None;
  }

  private showVictory(): void {
    this.victoryActive = true;
    this.caughtActive = false;
    this.caught?.destroy();
    this.caught = undefined;

    this.playSfx("success");

    if (this.player) {
      this.player.direction = Direction.None;
      this.player.desiredDirection = Direction.None;
    }
    if (this.coopPlayer) {
      this.coopPlayer.direction = Direction.None;
      this.coopPlayer.desiredDirection = Direction.None;
    }
    for (const ghost of this.ghosts) ghost.stop();
    this.cleanupDynamicObjects();

    if (this.campaignIndex !== null) {
      const nextIndex = this.campaignIndex + 1;
      const next = CAMPAIGN_LEVELS[nextIndex];
      if (!next) {
        clearSavedGame();
        {
          const mode: GameMode = this.gameMode;
          const seed = mode === "vibe" ? (this.seed ?? getEffectiveSeed(getAppConfig())) : null;
          const durationMs = Math.min(3 * 60 * 60 * 1000, Math.max(0, Date.now() - this.runStartedAtMs));
          const meta = mode === "vibe" ? { shifts: this.vibeShiftCount } : undefined;
          this.scene.start("CelebrationScene", { score: this.score, campaign: true, mode, seed, durationMs, meta });
        }
        return;
      }

      // Campaign checkpoint: after clearing a level, resume should start at the next level.
      {
        const mode: GameMode = this.gameMode;
        const seed = mode === "vibe" ? (this.seed ?? getEffectiveSeed(getAppConfig())) : null;
        saveCheckpoint({
          scope: "campaign",
          mode,
          seed,
          difficulty: this.settings.difficulty,
          score: this.score,
          lives: this.lives,
          campaignIndex: nextIndex,
          levelJson: next,
          runStartedAtMs: this.runStartedAtMs || undefined
        });
      }

      const currentId = this.levelJson.id ?? "";
      const currentN = /Original_Level_(\d+)/i.exec(currentId)?.[1] ?? String(this.campaignIndex + 1);
      const nextId = next.id ?? "";
      const nextN = /Original_Level_(\d+)/i.exec(nextId)?.[1] ?? String(nextIndex + 1);

      this.victory?.destroy();
        this.victory = new Overlay(this, {
          title: `LEVEL GESCHAFFT (${currentN})`,
          body: `Score: ${this.score}\n\nNext: Level ${nextN}\n\nR to Restart`,
          buttonText: "Next Level",
          onButton: () =>
            this.scene.restart({
              settings: this.settings,
              levelJson: next,
              campaignIndex: nextIndex,
              score: this.score,
              lives: this.lives,
              runStartedAtMs: this.runStartedAtMs,
              viewMode: this.viewMode
            })
        });
      this.victory.layout(this.cameras.main.width, this.cameras.main.height);
      this.victory.setVisible(true);
      return;
    }

    // Non-campaign victory ends the run; don't keep offering resume for a finished game.
    clearSavedGame();
    this.victory?.destroy();
    this.victory = new Overlay(this, {
      title: "VICTORY",
      body: `Score: ${this.score}\n\nR to Restart`,
      buttonText: "Restart (R)",
      onButton: () => this.restart(),
      secondaryButtonText: "Share Level",
      onSecondaryButton: () => this.shareLevel()
    });
    this.victory.layout(this.cameras.main.width, this.cameras.main.height);
    this.victory.setVisible(true);
  }

  private showCaught(): void {
    this.caughtActive = true;
    this.victoryActive = false;
    this.victory?.destroy();
    this.victory = undefined;

    if (this.player) {
      this.player.direction = Direction.None;
      this.player.desiredDirection = Direction.None;
    }
    if (this.coopPlayer) {
      this.coopPlayer.direction = Direction.None;
      this.coopPlayer.desiredDirection = Direction.None;
    }
    for (const ghost of this.ghosts) ghost.stop();
    this.cleanupDynamicObjects();
    clearSavedGame();

    this.caught?.destroy();
    this.caught = new Overlay(this, {
      title: "CAUGHT",
      body: `Score: ${this.score}\n\nHighscore speichern?\n\nR to Restart`,
      buttonText: "Restart (R)",
      onButton: () => this.restart(),
      secondaryButtonText: "Submit Highscore",
      onSecondaryButton: () => {
        const prefs = getUserPrefs();
        const mode: HighscoreMode = this.gameMode;
        const seed = mode === "vibe" ? (this.seed ?? getEffectiveSeed(getAppConfig())) : null;
        const durationMs = Math.min(3 * 60 * 60 * 1000, Math.max(0, Date.now() - this.runStartedAtMs));
        const meta = mode === "vibe" ? { shifts: this.vibeShiftCount } : undefined;
        this.scene.start("LeaderboardScene", {
          mode,
          scope: "all",
          seed,
          submit: {
            mode,
            seed,
            score: this.score,
            durationMs,
            defaultName: prefs.username ?? "",
            meta
          }
        });
      }
    });
    this.caught.layout(this.cameras.main.width, this.cameras.main.height);
    this.caught.setVisible(true);
  }

  private restart(): void {
    if (this.campaignIndex !== null) {
      const gameOver = this.lives <= 0;
      const lives = gameOver ? this.maxLives : this.lives;
      const penalty = gameOver ? 0 : Math.max(0, this.score - this.levelStartScore);
      const score = gameOver ? 0 : this.levelStartScore;
      this.scene.restart({
        settings: this.settings,
        levelJson: this.levelJson,
        campaignIndex: this.campaignIndex,
        score,
        lives,
        restartPenaltyScoreDelta: penalty,
        runStartedAtMs: gameOver ? undefined : this.runStartedAtMs,
        viewMode: this.viewMode
      });
      return;
    }
    this.scene.restart({ settings: this.settings, levelJson: this.levelJson, viewMode: this.viewMode });
  }

  private shareLevel(): void {
    const url = buildShareUrl(this.levelJson);

    const tryClipboard = async (): Promise<boolean> => {
      try {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        return false;
      }
    };

    void tryClipboard().then((ok) => {
      if (ok) {
        this.victory?.setBody(`Score: ${this.score}\n\nCopied share URL to clipboard.\n\nR to Restart`);
        return;
      }
      // Fallback for blocked clipboard permissions.
      window.prompt("Copy this URL to share the level:", url);
    });
  }

  private showErrors(errors: string[]): void {
    this.cleanupDynamicObjects();
    this.levelLayer?.destroy(true);
    this.levelLayer = undefined;
    this.wallsGraphics = undefined;
    this.player = undefined;
    this.coopPlayer = undefined;
    this.pellets = undefined;
    this.parsedLevel = undefined;
    this.keys = undefined;
    this.restartKey = undefined;
    this.spaceKey = undefined;
    this.ghosts.forEach((g) => g.view.destroy());
    this.ghosts = [];
    this.swipe?.destroy();
    this.swipe = undefined;
    this.dpad?.destroy();
    this.dpad = undefined;
    this.destroyBombTouchButton();

    this.livesContainer?.destroy(true);
    this.livesContainer = undefined;
    this.livesIcons = [];
    this.bombContainer?.destroy(true);
    this.bombContainer = undefined;
    this.bombCountText = undefined;
    this.campaignInfoText?.destroy();
    this.campaignInfoText = undefined;

    this.victoryActive = false;
    this.victory?.destroy();
    this.victory = undefined;
    this.caughtActive = false;
    this.caught?.destroy();
    this.caught = undefined;

    const viewWidth = this.cameras.main.width;
    const viewHeight = this.cameras.main.height;

    const message = ["Level validation failed:", "", ...errors].join("\n");
    this.errorText?.destroy();
    this.errorText = this.add
      .text(16, 16, message, {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: "16px",
        color: "#ffd7d7",
        wordWrap: { width: viewWidth - 32 }
      })
      .setDepth(10);

    const hint = this.add
      .text(16, viewHeight - 28, "Fix the level data in src/game/levels.ts", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "14px",
        color: "#9fb4d6"
      })
      .setDepth(10);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => hint.destroy());
  }
}
