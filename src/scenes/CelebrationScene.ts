import Phaser from "phaser";
import { getUserPrefs } from "../game/userPrefs";
import { stopBackgroundMusic } from "../game/backgroundMusic";
import type { HighscoreMode } from "../game/highscoreApi";
import { Overlay } from "../ui/overlay";

const CELEBRATION_VIDEO_KEY = "celebration-video";
const CELEBRATION_WINNER_MUSIC_KEY = "music-celebration-winner";
const CELEBRATION_VIDEO_URL = new URL("../ui/media/Celebrate.mp4", import.meta.url).toString();
const CELEBRATION_WINNER_MUSIC_URL = new URL("../ui/media/PacMan Christmas WINNER.mp3", import.meta.url).toString();

export class CelebrationScene extends Phaser.Scene {
  private score = 0;
  private mode: HighscoreMode = "classic";
  private seed: string | null = null;
  private durationMs = 0;
  private meta: Record<string, unknown> | undefined;
  private askHighscore = false;
  private music?: Phaser.Sound.BaseSound;
  private restartKey?: Phaser.Input.Keyboard.Key;
  private video?: Phaser.GameObjects.Video;
  private videoFrame?: Phaser.GameObjects.Rectangle;
  private backText?: Phaser.GameObjects.Text;
  private highscoreOverlay?: Overlay;

  constructor() {
    super({ key: "CelebrationScene" });
  }

  init(data: unknown): void {
    const maybe = data as
      | {
          score?: number;
          campaign?: boolean;
          mode?: HighscoreMode;
          seed?: string | null;
          durationMs?: number;
          meta?: Record<string, unknown>;
        }
      | undefined;
    this.score = typeof maybe?.score === "number" && Number.isFinite(maybe.score) ? Math.max(0, Math.floor(maybe.score)) : 0;
    this.mode = maybe?.mode === "vibe" ? "vibe" : "classic";
    this.seed = typeof maybe?.seed === "string" ? maybe.seed : null;
    this.durationMs = typeof maybe?.durationMs === "number" && Number.isFinite(maybe.durationMs) ? Math.max(0, Math.floor(maybe.durationMs)) : 0;
    this.meta = maybe?.meta ?? undefined;
    this.askHighscore = Boolean(maybe?.campaign);
  }

  create(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.cameras.main.setBackgroundColor(0x0b1020);
    const prefs = getUserPrefs();

    this.createConfetti();

    const title = this.add
      .text(w / 2, 70, "YOU WIN!", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "64px",
        color: "#ffd36a",
        fontStyle: "800"
      })
      .setOrigin(0.5)
      .setDepth(10);

    const greeting = this.add
      .text(
        w / 2,
        135,
        "Du hast es geschafft!\nWunderbare Feiertage und alles Liebe für 2026\nherzlichst Stefan",
        {
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: "22px",
          color: "#e6f0ff",
          align: "center",
          lineSpacing: 6,
          wordWrap: { width: Math.max(240, w - 80) }
        }
      )
      .setOrigin(0.5)
      .setDepth(10);

    const body = this.add
      .text(w / 2, 200, `Final Score: ${this.score}`, {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "18px",
        color: "#9fb4d6"
      })
      .setOrigin(0.5)
      .setDepth(10);

    const hint = this.add
      .text(w / 2, h - 46, "Zurück - R Neustart", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#9fb4d6"
      })
      .setOrigin(0.5)
      .setDepth(10);

    const reelWidth = Math.min(580, w - 80);
    const reelHeight = Math.min(260, h - 260);
    const reelX = w / 2;
    const reelY = h / 2 + 40;

    const keyboard = this.input.keyboard;
    this.restartKey = keyboard ? keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R) : undefined;

    this.backText?.destroy();
    this.backText = this.add
      .text(Math.max(12, w - 12), 10, "Zurück", {
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
    this.backText.on("pointerup", () => this.scene.start("BootScene"));

    this.ensureCelebrationMediaLoaded((ok) => {
      if (prefs.musicEnabled) this.playWinnerMusic();
      if (ok) {
        this.createCelebrationVideo(reelX, reelY, reelWidth, reelHeight);
        if (this.askHighscore) this.showHighscorePrompt();
        return;
      }
      // Fallback if video cannot be loaded.
      this.ensureCelebrationAnimations();
      this.createCelebrationReel(reelX, reelY, reelWidth, reelHeight);
      if (this.askHighscore) this.showHighscorePrompt();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      title.destroy();
      greeting.destroy();
      body.destroy();
      hint.destroy();
      this.backText?.destroy();
      this.backText = undefined;
      this.video?.stop();
      this.video?.destroy();
      this.video = undefined;
      this.videoFrame?.destroy();
      this.videoFrame = undefined;
      this.highscoreOverlay?.destroy();
      this.highscoreOverlay = undefined;
      this.music?.stop();
      this.music?.destroy();
      this.music = undefined;
      this.restartKey = undefined;
    });
  }

  update(): void {
    if (this.restartKey && Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.start("BootScene");
    }
  }

  private playWinnerMusic(): void {
    if (!this.sound) return;
    // Not all Phaser builds expose cache.audio.exists consistently; fail soft if missing.
    try {
      stopBackgroundMusic();
      this.music?.stop();
      this.music?.destroy();
      this.music = this.sound.add(CELEBRATION_WINNER_MUSIC_KEY, { loop: true, volume: 0.55 });
      this.music.play();
    } catch {
      // ignore
    }
  }

  private ensureCelebrationMediaLoaded(onReady: (ok: boolean) => void): void {
    const needsVideo = !this.cache.video.exists(CELEBRATION_VIDEO_KEY);
    const needsMusic = !this.cache.audio.exists(CELEBRATION_WINNER_MUSIC_KEY);

    if (!needsVideo && !needsMusic) {
      onReady(true);
      return;
    }

    if (needsVideo) {
      // `noAudio=true` so browsers can autoplay without a user gesture.
      this.load.video(CELEBRATION_VIDEO_KEY, CELEBRATION_VIDEO_URL, true);
    }
    if (needsMusic) {
      this.load.audio(CELEBRATION_WINNER_MUSIC_KEY, CELEBRATION_WINNER_MUSIC_URL);
    }

    let ok = true;
    const onError = () => {
      ok = false;
    };
    const onComplete = () => {
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      onReady(ok);
    };

    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
    this.load.start();
  }

  private showHighscorePrompt(): void {
    if (this.highscoreOverlay) return;
    if (this.score <= 0) return;

    const prefs = getUserPrefs();

    const submit = () => {
      this.scene.start("LeaderboardScene", {
        mode: this.mode,
        scope: "all",
        seed: this.mode === "vibe" ? this.seed : null,
        backTo: {
          scene: "CelebrationScene",
          data: {
            score: this.score,
            campaign: false,
            mode: this.mode,
            seed: this.seed,
            durationMs: this.durationMs,
            meta: this.meta
          }
        },
        returnAfterSubmit: true,
        submit: {
          mode: this.mode,
          seed: this.mode === "vibe" ? this.seed : null,
          score: this.score,
          durationMs: Math.min(3 * 60 * 60 * 1000, Math.max(0, this.durationMs)),
          defaultName: prefs.username ?? "",
          meta: this.meta
        }
      });
    };

    this.highscoreOverlay = new Overlay(this, {
      title: "HIGHSCORE",
      body: `Score: ${this.score}\n\nMöchtest du deinen Score eintragen?`,
      buttonText: "Eintragen",
      onButton: submit,
      secondaryButtonText: "Später",
      onSecondaryButton: () => {
        this.highscoreOverlay?.destroy();
        this.highscoreOverlay = undefined;
      }
    });
    this.highscoreOverlay.layout(this.cameras.main.width, this.cameras.main.height);
    this.highscoreOverlay.setVisible(true);
  }

  private createCelebrationVideo(centerX: number, centerY: number, width: number, height: number): void {
    this.videoFrame?.destroy();
    this.videoFrame = this.add
      .rectangle(centerX, centerY, width, height, 0x061024, 1)
      .setDepth(5);

    this.video?.stop();
    this.video?.destroy();
    this.video = this.add.video(centerX, centerY, CELEBRATION_VIDEO_KEY).setDepth(6);
    this.video.setOrigin(0.5);
    this.video.setScrollFactor(0);
    this.video.setMute(true);
    this.video.setVolume(0);
    this.video.playWhenUnlocked = true;

    const maskG = this.add.graphics();
    maskG.setVisible(false);
    maskG.fillStyle(0xffffff, 1);
    maskG.fillRect(centerX - width / 2, centerY - height / 2, width, height);
    const mask = maskG.createGeometryMask();
    this.video.setMask(mask);

    const fit = () => {
      const el = this.video?.video ?? null;
      const iw = (el?.videoWidth ?? 0) || 1;
      const ih = (el?.videoHeight ?? 0) || 1;
      const sx = width / iw;
      const sy = height / ih;
      this.video?.setScale(Math.min(sx, sy));
    };

    this.video.on(Phaser.GameObjects.Events.VIDEO_CREATED, () => {
      fit();
      // Now that the underlying element exists, autoplay has a much higher chance of succeeding.
      try {
        const el = this.video?.video ?? null;
        if (el) {
          el.muted = true;
          el.volume = 0;
          el.autoplay = true;
          el.loop = true;
          // Helps iOS / some Chromium variants for inline playback.
          (el as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
          el.setAttribute("muted", "");
          el.setAttribute("autoplay", "");
          el.setAttribute("loop", "");
          el.setAttribute("playsinline", "");
          el.setAttribute("webkit-playsinline", "");
        }
        this.video?.play(true);
      } catch {
        // ignore autoplay failures
      }
    });
    this.video.on(Phaser.GameObjects.Events.VIDEO_METADATA, () => {
      fit();
      try {
        const el = this.video?.video ?? null;
        if (el) {
          el.muted = true;
          el.volume = 0;
          el.autoplay = true;
          el.loop = true;
          (el as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
          el.setAttribute("muted", "");
          el.setAttribute("autoplay", "");
          el.setAttribute("loop", "");
          el.setAttribute("playsinline", "");
          el.setAttribute("webkit-playsinline", "");
        }
        this.video?.play(true);
      } catch {
        // ignore autoplay failures
      }
    });
    this.video.on(Phaser.GameObjects.Events.VIDEO_ERROR, () => {
      const msg = this.add
        .text(centerX, centerY, "Video konnte nicht geladen werden.", {
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: "14px",
          color: "#ffd7d7",
          align: "center"
        })
        .setOrigin(0.5)
        .setDepth(20);
      this.time.delayedCall(2500, () => msg.destroy());
    });

    fit();
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
      try {
        this.video?.play(true);
      } catch {
        // ignore
      }
    });

    this.time.delayedCall(120, fit);
    this.time.delayedCall(450, fit);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      maskG.destroy();
    });
  }

  private createConfetti(): void {
    const textureKey = "fx-confetti";
    if (!this.textures.exists(textureKey)) {
      const g = this.add.graphics();
      g.setVisible(false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture(textureKey, 2, 2);
      g.destroy();
    }

    const particles = this.add.particles(0, 0, textureKey, {
      x: { min: 0, max: this.cameras.main.width },
      y: -10,
      lifespan: { min: 2200, max: 4200 },
      speedY: { min: 140, max: 320 },
      speedX: { min: -60, max: 60 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      quantity: 3,
      frequency: 90,
      scale: { start: 1.4, end: 0.2 },
      tint: [0x7cffb2, 0xffd36a, 0x7aa2ff, 0xff6ad5]
    });
    particles.setDepth(1);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      particles.destroy();
    });
  }

  private ensureCelebrationAnimations(): void {
    const ensure = (key: string, create: () => void) => {
      if (this.anims.exists(key)) return;
      create();
    };

    ensure("bomb-explosion", () => {
      this.anims.create({
        key: "bomb-explosion",
        frames: Array.from({ length: 10 }, (_, i) => ({ key: `bomb-explosion-${i + 1}` })),
        frameRate: 16,
        repeat: 0
      });
    });
  }

  private createCelebrationReel(centerX: number, centerY: number, width: number, height: number): void {
    const frame = this.add
      .rectangle(centerX, centerY, width, height, 0x061024, 1)
      .setStrokeStyle(2, 0x7cffb2, 0.9)
      .setDepth(5);

    const reel = this.add.container(0, 0).setDepth(6);

    const maskG = this.add.graphics();
    maskG.setVisible(false);
    maskG.fillStyle(0xffffff, 1);
    maskG.fillRect(centerX - width / 2, centerY - height / 2, width, height);
    const mask = maskG.createGeometryMask();
    reel.setMask(mask);
    maskG.destroy();

    const spriteSize = Math.max(18, Math.floor(Math.min(width, height) * 0.12));

    const pac = this.add.sprite(centerX - width / 2 - spriteSize, centerY, "pacman-move-right-1");
    pac.setDisplaySize(spriteSize, spriteSize);
    if (this.anims.exists("pacman-move-right")) pac.play("pacman-move-right");
    reel.add(pac);

    this.tweens.add({
      targets: pac,
      x: centerX + width / 2 + spriteSize,
      duration: 4200,
      repeat: -1,
      onRepeat: () => {
        pac.x = centerX - width / 2 - spriteSize;
      }
    });

    const ghostSkins = ["blinky", "pinky", "inky", "clyde"] as const;
    for (let i = 0; i < 4; i++) {
      const y = centerY - height / 2 + ((i + 1) * height) / 5;
      const ghost = this.add.sprite(centerX + width / 2 + spriteSize, y, `ghost-${ghostSkins[i]}-left-1`);
      ghost.setDisplaySize(spriteSize, spriteSize);
      const animKey = `ghost-${ghostSkins[i]}-left`;
      if (this.anims.exists(animKey)) ghost.play(animKey);
      reel.add(ghost);

      this.tweens.add({
        targets: ghost,
        x: centerX - width / 2 - spriteSize,
        duration: 5200 + i * 300,
        repeat: -1,
        delay: i * 250,
        onRepeat: () => {
          ghost.x = centerX + width / 2 + spriteSize;
        }
      });
    }

    const fruitKeys = ["fruit-cherry", "fruit-strawberry", "fruit-orange", "fruit-apple", "fruit-melon"] as const;
    for (let i = 0; i < 6; i++) {
      const key = fruitKeys[i % fruitKeys.length]!;
      const x = centerX - width / 2 + ((i + 1) * width) / 7;
      const y = centerY - height / 2 + (height * 0.15) + (i % 2) * (height * 0.7);
      const fruit = this.add.sprite(x, y, key);
      fruit.setDisplaySize(Math.floor(spriteSize * 0.9), Math.floor(spriteSize * 0.9));
      reel.add(fruit);
      this.tweens.add({
        targets: fruit,
        angle: 360,
        duration: 2400 + i * 120,
        repeat: -1
      });
      this.tweens.add({
        targets: fruit,
        y: y + (i % 2 === 0 ? 14 : -14),
        duration: 900 + i * 40,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut"
      });
    }

    const explode = () => {
      const x = Phaser.Math.Between(Math.floor(centerX - width / 2 + 40), Math.floor(centerX + width / 2 - 40));
      const y = Phaser.Math.Between(Math.floor(centerY - height / 2 + 40), Math.floor(centerY + height / 2 - 40));
      const s = this.add.sprite(x, y, "bomb-explosion-1");
      s.setDisplaySize(spriteSize * 1.6, spriteSize * 1.6);
      reel.add(s);
      if (this.anims.exists("bomb-explosion")) {
        s.play("bomb-explosion");
        s.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + "bomb-explosion", () => s.destroy());
      } else {
        this.time.delayedCall(500, () => s.destroy());
      }
    };

    const explosions = this.time.addEvent({ delay: 850, loop: true, callback: explode });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      explosions.destroy();
      reel.destroy(true);
      frame.destroy();
    });
  }
}
