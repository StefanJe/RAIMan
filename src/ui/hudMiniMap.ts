import Phaser from "phaser";
import { Direction } from "../game/directions";
import { worldToTile } from "../game/gridMath";
import type { ParsedLevel, TileType } from "../game/levelTypes";
import type { FpsRendererFrame } from "./fpsRenderer";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isWall(t: TileType | undefined): boolean {
  return t === "wall";
}

function ghostColor(ghost: { view: Phaser.GameObjects.Sprite }, frightened: boolean): number {
  if (frightened) return 0x2d6bff;
  const key = ghost.view.texture?.key ?? "";
  if (key.includes("blinky")) return 0xff4b4b;
  if (key.includes("pinky")) return 0xff7bd8;
  if (key.includes("inky")) return 0x3ae9ff;
  if (key.includes("clyde")) return 0xffb347;
  return 0xffffff;
}

export class HudMiniMap {
  readonly container: Phaser.GameObjects.Container;

  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly map: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  private level?: ParsedLevel;
  private visible = true;
  private lastDrawAtMs = 0;
  private readonly redrawIntervalMs = 140;

  private viewW = 800;
  private viewH = 600;
  private sizePx = 170;
  private marginPx = 12;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(1900);
    this.container.setScrollFactor(0);

    this.bg = scene.add.graphics().setScrollFactor(0);
    this.map = scene.add.graphics().setScrollFactor(0);

    this.label = scene.add
      .text(0, 0, "MAP", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "11px",
        color: "#e6f0ff"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0.8);

    this.container.add([this.bg, this.map, this.label]);

    // Tap/click to toggle.
    const hit = scene.add.zone(0, 0, 10, 10).setOrigin(0, 0).setScrollFactor(0).setInteractive();
    hit.on("pointerup", () => this.setVisible(!this.visible));
    this.container.add(hit);
  }

  setLevel(level: ParsedLevel): void {
    this.level = level;
  }

  setVisible(visible: boolean): this {
    this.visible = visible;
    this.map.setVisible(visible);
    // Keep the frame/label visible so user can re-open.
    this.label.setText(visible ? "MAP" : "MAP (off)");
    return this;
  }

  layout(viewWidth: number, viewHeight: number): void {
    this.viewW = Math.max(1, Math.floor(viewWidth));
    this.viewH = Math.max(1, Math.floor(viewHeight));

    const base = Math.min(this.viewW, this.viewH);
    this.sizePx = clamp(Math.floor(base * 0.24), 120, 210);
    this.marginPx = clamp(Math.floor(base * 0.02), 10, 18);

    const x = this.viewW - this.marginPx - this.sizePx;
    const y = this.marginPx + 46; // below top HUD texts
    this.container.setPosition(x, y);

    // Update hit area (last child is the zone).
    const hit = this.container.list[this.container.list.length - 1] as Phaser.GameObjects.Zone;
    hit.setPosition(0, 0);
    hit.setSize(this.sizePx, this.sizePx);

    this.drawFrame();
    this.lastDrawAtMs = 0; // force redraw
  }

  tick(frame: FpsRendererFrame): void {
    if (!this.level) this.setLevel(frame.level);
    if (!this.level) return;

    if (frame.nowMs - this.lastDrawAtMs < this.redrawIntervalMs) return;
    this.lastDrawAtMs = frame.nowMs;

    this.draw(frame);
  }

  private drawFrame(): void {
    const s = this.sizePx;
    this.bg.clear();
    this.bg.fillStyle(0x050a18, 0.42);
    this.bg.fillRoundedRect(0, 0, s, s, 12);
    this.bg.lineStyle(1, 0x1f3a66, 0.5);
    this.bg.strokeRoundedRect(0.5, 0.5, s - 1, s - 1, 12);
    this.label.setPosition(s / 2, 10);
  }

  private draw(frame: FpsRendererFrame): void {
    const level = frame.level;
    const s = this.sizePx;
    const pad = 10;
    const inner = s - pad * 2;

    const scale = inner / Math.max(level.width, level.height);
    const mapW = level.width * scale;
    const mapH = level.height * scale;
    const ox = pad + (inner - mapW) / 2;
    const oy = pad + (inner - mapH) / 2;

    const g = this.map;
    g.clear();
    if (!this.visible) return;

    // Walls.
    g.fillStyle(0x1f3a66, 0.75);
    for (let y = 0; y < level.height; y++) {
      const row = level.tileMatrix[y]!;
      for (let x = 0; x < level.width; x++) {
        if (!isWall(row[x])) continue;
        g.fillRect(ox + x * scale, oy + y * scale, Math.max(0.75, scale), Math.max(0.75, scale));
      }
    }

    // Pellets + power pellets.
    const rPellet = Math.max(0.55, scale * 0.16);
    const rPower = Math.max(0.75, scale * 0.28);
    for (let y = 0; y < level.height; y++) {
      const row = level.tileMatrix[y]!;
      for (let x = 0; x < level.width; x++) {
        const t = row[x]!;
        if (t !== "pellet" && t !== "power") continue;
        const cx = ox + (x + 0.5) * scale;
        const cy = oy + (y + 0.5) * scale;
        if (t === "pellet") {
          g.fillStyle(0xf4e6b0, 0.55);
          g.fillCircle(cx, cy, rPellet);
        } else {
          g.fillStyle(0xffd7ff, 0.72);
          g.fillCircle(cx, cy, rPower);
        }
      }
    }

    // Bombs (pickups + placed).
    const rBomb = Math.max(0.9, scale * 0.32);
    const bombs = frame.bombs ?? [];
    for (const b of bombs) {
      if (!b.active || !b.visible) continue;
      const bt = worldToTile(b.x, b.y, frame.tileSize);
      this.drawBombMarker(g, ox, oy, scale, bt.x, bt.y, rBomb);
    }

    // Boxes.
    const rBox = Math.max(0.9, scale * 0.3);
    const boxes = frame.boxes ?? [];
    for (const b of boxes) {
      if (!b.active || !b.visible) continue;
      const bt = worldToTile(b.x, b.y, frame.tileSize);
      this.drawBoxMarker(g, ox, oy, scale, bt.x, bt.y, rBox);
    }

    // Entities.
    const pt = worldToTile(frame.player.view.x, frame.player.view.y, frame.tileSize);
    this.drawDot(g, ox, oy, scale, pt.x, pt.y, 0xffd24b, 0.95, Math.max(1.3, scale * 0.45));
    const viewDir = this.dirFromView(frame);
    this.drawFacing(g, ox, oy, scale, pt.x, pt.y, viewDir);

    if (frame.coopPlayer) {
      const ct = worldToTile(frame.coopPlayer.view.x, frame.coopPlayer.view.y, frame.tileSize);
      this.drawDot(g, ox, oy, scale, ct.x, ct.y, 0x7cffb2, 0.9, Math.max(1.1, scale * 0.4));
    }

    for (const ghost of frame.ghosts) {
      if (!ghost.view.visible) continue;
      const gt = ghost.getTile();
      this.drawDot(g, ox, oy, scale, gt.x, gt.y, ghostColor(ghost, frame.frightened), 0.9, Math.max(1.1, scale * 0.42));
    }
  }

  private dirFromView(frame: FpsRendererFrame): Direction {
    const yaw = frame.viewYawRad;
    if (typeof yaw === "number" && Number.isFinite(yaw)) {
      const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const step = Math.PI / 2;
      const idx = Math.round(a / step) % 4;
      return idx === 0 ? Direction.Right : idx === 1 ? Direction.Down : idx === 2 ? Direction.Left : Direction.Up;
    }
    return frame.player.direction;
  }

  private drawDot(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    scale: number,
    tileX: number,
    tileY: number,
    color: number,
    alpha: number,
    r: number
  ): void {
    if (!this.level) return;
    if (tileX < 0 || tileY < 0 || tileX >= this.level.width || tileY >= this.level.height) return;
    const cx = ox + (tileX + 0.5) * scale;
    const cy = oy + (tileY + 0.5) * scale;
    g.fillStyle(color, alpha);
    g.fillCircle(cx, cy, r);
  }

  private drawBombMarker(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    scale: number,
    tileX: number,
    tileY: number,
    r: number
  ): void {
    if (!this.level) return;
    if (tileX < 0 || tileY < 0 || tileX >= this.level.width || tileY >= this.level.height) return;
    const cx = ox + (tileX + 0.5) * scale;
    const cy = oy + (tileY + 0.5) * scale;
    const size = Math.max(1.6, r * 2);
    const half = size / 2;

    g.fillStyle(0x6f6f6f, 0.9);
    g.fillRect(cx - half, cy - half, size, size);
    g.lineStyle(1, 0xa8a8a8, 0.85);
    g.strokeRect(cx - half, cy - half, size, size);

    const fuseX = cx + half * 0.7;
    const fuseY = cy - half * 0.7;
    g.lineStyle(1, 0xffc857, 0.9);
    g.beginPath();
    g.moveTo(fuseX, fuseY);
    g.lineTo(fuseX + half * 0.5, fuseY - half * 0.5);
    g.strokePath();
  }

  private drawBoxMarker(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    scale: number,
    tileX: number,
    tileY: number,
    r: number
  ): void {
    if (!this.level) return;
    if (tileX < 0 || tileY < 0 || tileX >= this.level.width || tileY >= this.level.height) return;
    const cx = ox + (tileX + 0.5) * scale;
    const cy = oy + (tileY + 0.5) * scale;
    const size = Math.max(1.6, r * 2);
    const half = size / 2;

    g.fillStyle(0x8b5a2b, 0.88);
    g.fillRect(cx - half, cy - half, size, size);
    g.lineStyle(1, 0xc68a4a, 0.85);
    g.strokeRect(cx - half, cy - half, size, size);
  }

  private drawFacing(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    scale: number,
    tileX: number,
    tileY: number,
    dir: Direction
  ): void {
    const v =
      dir === Direction.Up
        ? { x: 0, y: -1 }
        : dir === Direction.Down
          ? { x: 0, y: 1 }
          : dir === Direction.Left
            ? { x: -1, y: 0 }
            : dir === Direction.Right
              ? { x: 1, y: 0 }
              : null;
    if (!v) return;
    const cx = ox + (tileX + 0.5) * scale;
    const cy = oy + (tileY + 0.5) * scale;
    const len = Math.max(3, scale * 0.9);
    g.lineStyle(1.5, 0xffffff, 0.75);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + v.x * len, cy + v.y * len);
    g.strokePath();
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
