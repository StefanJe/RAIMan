import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CelebrationScene } from "./scenes/CelebrationScene";
import { GameScene } from "./scenes/GameScene";
import { InfoScene } from "./scenes/InfoScene";
import { LeaderboardScene } from "./scenes/LeaderboardScene";
import { SettingsScene } from "./scenes/SettingsScene";
import { getUserPrefs } from "./game/userPrefs";

const isDev = import.meta.env.DEV;
if (isDev) console.log("[RAI-Man] main.ts loaded");

/**
 * Canvas sizing strategy:
 * - Desktop default: `Scale.FIT` with a fixed internal resolution (800x600) to preserve the original desktop look.
 * - Mobile Layout (auto/on): `Scale.RESIZE` so the canvas matches the browser viewport and the maze can use the width.
 *
 * Note: the "auto" decision must stay conservative, otherwise desktop visuals would change.
 */
function shouldUseMobileResizeCanvas(): boolean {
  try {
    const prefs = getUserPrefs();
    const mobile = prefs.mobileLayout ?? "auto";
    if (mobile === "off") return false;
    if (mobile === "on") return true;

    if (typeof window === "undefined") return false;
    const w = window.innerWidth || 0;
    const h = window.innerHeight || 0;
    const minDim = Math.min(w, h);
    if (minDim > 760) return false;

    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    return Boolean(touch || coarse);
  } catch {
    return false;
  }
}

const useMobileResizeCanvas = shouldUseMobileResizeCanvas();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#0b1020",
  audio: {
    noAudio: false
  },
  dom: {
    createContainer: true
  },
  scale: {
    mode: useMobileResizeCanvas ? Phaser.Scale.RESIZE : Phaser.Scale.FIT,
    autoCenter: useMobileResizeCanvas ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
    width: useMobileResizeCanvas ? window.innerWidth : 800,
    height: useMobileResizeCanvas ? window.innerHeight : 600
  },
  scene: [BootScene, SettingsScene, InfoScene, LeaderboardScene, GameScene, CelebrationScene]
};

const game = new Phaser.Game(config);
(window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__ = game;
game.events.once(Phaser.Core.Events.READY, () => {
  if (isDev) console.log("[RAI-Man] Phaser READY");
});
