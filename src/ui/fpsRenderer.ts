import Phaser from "phaser";
import { Direction } from "../game/directions";
import type { Ghost } from "../game/ghost";
import type { PelletSystem } from "../game/pelletSystem";
import type { Player } from "../game/player";
import type { ParsedLevel, TileType } from "../game/levelTypes";

export interface FpsRendererFrame {
  nowMs: number;
  level: ParsedLevel;
  tileSize: number;
  player: Player;
  coopPlayer?: Player;
  ghosts: Ghost[];
  frightened: boolean;
  pellets: PelletSystem;
  bombs?: Phaser.GameObjects.Sprite[];
  boxes?: Phaser.GameObjects.Sprite[];
  explosions?: Phaser.GameObjects.Sprite[];
  viewYawRad?: number;
}

export interface FpsRendererOptions {
  width: number;
  height: number;
  renderScale?: number;
  fovDeg?: number;
  maxDepthTiles?: number;
  rayCount?: number;
  occludeSprites?: boolean;
}

function dirToYawRad(dir: Direction): number | null {
  switch (dir) {
    case Direction.Right:
      return 0;
    case Direction.Down:
      return Math.PI / 2;
    case Direction.Left:
      return Math.PI;
    case Direction.Up:
      return (3 * Math.PI) / 2;
    case Direction.None:
    default:
      return null;
  }
}

function normalizeAngleSigned(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isWall(tile: TileType | undefined): boolean {
  return tile === "wall";
}

function ghostColorHex(ghost: Ghost, frightened: boolean): string {
  if (frightened) return "#2d6bff";
  const key = ghost.view.texture?.key ?? "";
  if (key.includes("blinky")) return "#ff4b4b";
  if (key.includes("pinky")) return "#ff7bd8";
  if (key.includes("inky")) return "#3ae9ff";
  if (key.includes("clyde")) return "#ffb347";
  return "#ffffff";
}

export class FpsRenderer {
  private readonly scene: Phaser.Scene;
  private readonly textureKey: string;
  private texture: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private ctx: CanvasRenderingContext2D;

  private level?: ParsedLevel;
  private tileSize = 32;

  private viewWidth: number;
  private viewHeight: number;
  private renderScale: number;
  private renderWidth: number;
  private renderHeight: number;

  private readonly fovRad: number;
  private readonly maxDepthTiles: number;
  private rayCount: number;
  private depthBuffer: Float32Array;
  private columnWidth: number;

  private yaw = 0;
  private yawTarget = 0;
  private yawFrom = 0;
  private yawTweenUntilMs = 0;
  private lastNowMs = 0;
  private manualYaw: number | null = null;

  private occludeSprites: boolean;
  private boxTiles = new Set<string>();

  constructor(scene: Phaser.Scene, options: FpsRendererOptions) {
    this.scene = scene;
    this.viewWidth = Math.max(1, Math.floor(options.width));
    this.viewHeight = Math.max(1, Math.floor(options.height));

    const rs = typeof options.renderScale === "number" && Number.isFinite(options.renderScale) ? options.renderScale : 0.6;
    this.renderScale = clamp(rs, 0.25, 1);
    this.renderWidth = Math.max(1, Math.floor(this.viewWidth * this.renderScale));
    this.renderHeight = Math.max(1, Math.floor(this.viewHeight * this.renderScale));

    const fovDeg = typeof options.fovDeg === "number" && Number.isFinite(options.fovDeg) ? options.fovDeg : 66;
    this.fovRad = clamp((fovDeg * Math.PI) / 180, Math.PI / 8, (Math.PI * 3) / 4);

    const md = typeof options.maxDepthTiles === "number" && Number.isFinite(options.maxDepthTiles) ? options.maxDepthTiles : 24;
    this.maxDepthTiles = clamp(md, 6, 96);

    this.occludeSprites = options.occludeSprites !== false;

    const rc =
      typeof options.rayCount === "number" && Number.isFinite(options.rayCount)
        ? Math.floor(options.rayCount)
        : Math.min(240, Math.max(120, this.renderWidth));
    this.rayCount = clamp(rc, 80, 320);
    this.depthBuffer = new Float32Array(this.rayCount);
    this.columnWidth = this.renderWidth / this.rayCount;

    this.textureKey = `fps-view-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const tex = scene.textures.createCanvas(this.textureKey, this.renderWidth, this.renderHeight);
    if (!tex) throw new Error("FPS renderer: failed to create canvas texture");
    this.texture = tex;

    const ctx = tex.getContext();
    if (!ctx) throw new Error("FPS renderer: missing 2D context");
    this.ctx = ctx;

    this.image = scene.add.image(0, 0, this.textureKey).setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    this.image.setDisplaySize(this.viewWidth, this.viewHeight);

    this.ctx.imageSmoothingEnabled = false;
  }

  setManualYaw(yawRad: number | null): void {
    this.manualYaw = yawRad;
    if (typeof yawRad === "number" && Number.isFinite(yawRad)) {
      this.yaw = yawRad;
      this.yawTarget = yawRad;
      this.yawTweenUntilMs = 0;
    }
  }

  setLevel(level: ParsedLevel, options: { tileSize: number }): void {
    this.level = level;
    this.tileSize = options.tileSize;
  }

  resize(viewWidth: number, viewHeight: number): void {
    this.viewWidth = Math.max(1, Math.floor(viewWidth));
    this.viewHeight = Math.max(1, Math.floor(viewHeight));
    this.image.setDisplaySize(this.viewWidth, this.viewHeight);

    const newW = Math.max(1, Math.floor(this.viewWidth * this.renderScale));
    const newH = Math.max(1, Math.floor(this.viewHeight * this.renderScale));
    if (newW === this.renderWidth && newH === this.renderHeight) return;

    this.renderWidth = newW;
    this.renderHeight = newH;

    this.texture.setSize(this.renderWidth, this.renderHeight);
    const ctx = this.texture.getContext();
    if (!ctx) return;
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    const rc = Math.min(240, Math.max(120, this.renderWidth));
    this.rayCount = clamp(rc, 80, 320);
    this.depthBuffer = new Float32Array(this.rayCount);
    this.columnWidth = this.renderWidth / this.rayCount;
  }

  render(frame: FpsRendererFrame): void {
    if (!this.level) this.setLevel(frame.level, { tileSize: frame.tileSize });
    if (!this.level) return;
    this.tileSize = frame.tileSize;
    this.updateBoxTiles(frame);

    const now = frame.nowMs;
    const dtMs = this.lastNowMs > 0 ? Math.max(0, now - this.lastNowMs) : 16;
    this.lastNowMs = now;

    if (this.manualYaw === null) {
      this.updateYaw(frame.player, now, dtMs);
    }

    const ctx = this.ctx;
    const w = this.renderWidth;
    const h = this.renderHeight;

    // Ceiling / floor.
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = "#060a16";
    ctx.fillRect(0, h / 2, w, h / 2);

    const posX = frame.player.view.x / frame.tileSize;
    const posY = frame.player.view.y / frame.tileSize;
    this.castWalls(ctx, frame.level, posX, posY, w, h);
    this.drawSprites(ctx, frame, w, h);

    this.texture.refresh();
  }

  private updateYaw(player: Player, nowMs: number, _dtMs: number): void {
    const dir = player.direction;
    const target = dirToYawRad(dir);
    if (target !== null && target !== this.yawTarget) {
      this.yawFrom = this.yaw;
      this.yawTarget = target;
      this.yawTweenUntilMs = nowMs + 150;
    }

    if (this.yawTweenUntilMs <= nowMs) {
      this.yaw = this.yawTarget;
      return;
    }

    const total = 150;
    const remaining = this.yawTweenUntilMs - nowMs;
    const t = clamp(1 - remaining / total, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    const delta = normalizeAngleSigned(this.yawTarget - this.yawFrom);
    this.yaw = this.yawFrom + delta * smooth;
  }

  private castWalls(ctx: CanvasRenderingContext2D, level: ParsedLevel, posX: number, posY: number, w: number, h: number): void {
    const fovHalf = this.fovRad / 2;
    const projPlaneDist = (w / 2) / Math.tan(fovHalf);

    const map = level.tileMatrix;
    const mapW = level.width;
    const mapH = level.height;

    for (let r = 0; r < this.rayCount; r++) {
      const rayAngle = this.yaw - fovHalf + (this.fovRad * (r + 0.5)) / this.rayCount;
      const rayDirX = Math.cos(rayAngle);
      const rayDirY = Math.sin(rayAngle);

      let mapX = Math.floor(posX);
      let mapY = Math.floor(posY);

      const invX = rayDirX === 0 ? 1e9 : 1 / rayDirX;
      const invY = rayDirY === 0 ? 1e9 : 1 / rayDirY;
      const deltaDistX = Math.abs(invX);
      const deltaDistY = Math.abs(invY);

      const stepX = rayDirX < 0 ? -1 : 1;
      const stepY = rayDirY < 0 ? -1 : 1;

      let sideDistX = (rayDirX < 0 ? posX - mapX : mapX + 1 - posX) * deltaDistX;
      let sideDistY = (rayDirY < 0 ? posY - mapY : mapY + 1 - posY) * deltaDistY;

      let hit = false;
      let side: 0 | 1 = 0;

      const maxSteps = Math.floor(this.maxDepthTiles * 2 + 6);
      for (let i = 0; i < maxSteps; i++) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        if (mapX < 0 || mapY < 0 || mapX >= mapW || mapY >= mapH) break;
        if (isWall(map[mapY]?.[mapX])) {
          hit = true;
          break;
        }
      }

      let dist = this.maxDepthTiles;
      let wallX = 0;
      if (hit) {
        dist =
          side === 0
            ? (mapX - posX + (1 - stepX) / 2) / (rayDirX === 0 ? 1e-9 : rayDirX)
            : (mapY - posY + (1 - stepY) / 2) / (rayDirY === 0 ? 1e-9 : rayDirY);
        if (!Number.isFinite(dist) || dist <= 0) dist = 0.001;
        wallX = side === 0 ? posY + dist * rayDirY : posX + dist * rayDirX;
        wallX -= Math.floor(wallX);
      }

      const corrected = Math.max(0.001, dist * Math.cos(rayAngle - this.yaw));
      this.depthBuffer[r] = corrected;

      const lineH = projPlaneDist / corrected;
      const y0 = Math.floor(h / 2 - lineH / 2);
      const y1 = Math.floor(h / 2 + lineH / 2);
      const x = r * this.columnWidth;
      const top = clamp(y0, 0, h);
      const bottom = clamp(y1, 0, h);
      const hh = Math.max(0, bottom - top);

      // Arcade shading: side darkening + distance fade.
      const isBoxTile = hit && this.boxTiles.has(`${mapX},${mapY}`);
      const baseAlpha = side === 1 ? (isBoxTile ? 0.88 : 0.75) : isBoxTile ? 0.98 : 0.9;
      const fade = clamp(1 / (1 + corrected * (isBoxTile ? 0.15 : 0.22)), isBoxTile ? 0.3 : 0.12, 1);
      ctx.globalAlpha = baseAlpha * fade;
      if (isBoxTile) {
        const stripe = Math.floor(wallX * 6) % 2 === 1;
        const light = side === 1 ? "#8a5a2d" : "#9a6a36";
        const dark = side === 1 ? "#6b3f1b" : "#7a4a1f";
        ctx.fillStyle = stripe ? light : dark;
      } else {
        ctx.fillStyle = side === 1 ? "#1a2f55" : "#1f3a66";
      }
      if (hh > 0) ctx.fillRect(x, top, this.columnWidth + 0.75, hh);
    }

    ctx.globalAlpha = 1;
  }

  private updateBoxTiles(frame: FpsRendererFrame): void {
    this.boxTiles.clear();
    const boxes = frame.boxes ?? [];
    if (boxes.length === 0) return;
    for (const b of boxes) {
      if (!b.active || !b.visible) continue;
      const tileX = Math.floor(b.x / frame.tileSize);
      const tileY = Math.floor(b.y / frame.tileSize);
      if (tileX < 0 || tileY < 0 || tileX >= frame.level.width || tileY >= frame.level.height) continue;
      this.boxTiles.add(`${tileX},${tileY}`);
    }
  }

  private drawSprites(ctx: CanvasRenderingContext2D, frame: FpsRendererFrame, w: number, h: number): void {
    const level = frame.level;
    const posX = frame.player.view.x / frame.tileSize;
    const posY = frame.player.view.y / frame.tileSize;

    const fovHalf = this.fovRad / 2;
    const projPlaneDist = (w / 2) / Math.tan(fovHalf);

    // Pellets / power pellets (no sorting; occlusion is wall depth-buffered).
    const pelletPositions = level.pelletPositions;
    for (let i = 0; i < pelletPositions.length; i++) {
      const p = pelletPositions[i]!;
      const t = level.tileMatrix[p.y]?.[p.x];
      if (t !== "pellet" && t !== "power") continue;

      const sx = p.x + 0.5;
      const sy = p.y + 0.5;
      const dx = sx - posX;
      const dy = sy - posY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0.001 || dist > this.maxDepthTiles) continue;

      const angle = Math.atan2(dy, dx);
      const rel = normalizeAngleSigned(angle - this.yaw);
      if (Math.abs(rel) > fovHalf + 0.05) continue;

      const corrected = dist * Math.cos(rel);
      if (corrected <= 0.001) continue;

      const centerX = (w / 2) * (1 + rel / fovHalf);
      const worldSize = t === "power" ? 0.36 : 0.18;
      const diameter = (projPlaneDist * worldSize) / corrected;
      const radius = diameter / 2;
      if (radius < 0.75) continue;

      const yBottom = h / 2 + diameter * 0.35;
      const centerY = yBottom - radius;

      if (this.occludeSprites) {
        const col = Math.floor(centerX / this.columnWidth);
        if (col < 0 || col >= this.rayCount) continue;
        if (corrected >= this.depthBuffer[col] - 0.02) continue;
      }

      const pulse = t === "power" ? 0.72 + 0.28 * Math.sin(frame.nowMs / 120) : 1;
      const highlight = t === "power" ? "#fff4ff" : "#fffbe1";
      const mid = t === "power" ? "#ffd0ff" : "#f4e6b0";
      const dark = t === "power" ? "#9c6d98" : "#bda36a";
      const grad = ctx.createRadialGradient(
        centerX - radius * 0.35,
        centerY - radius * 0.35,
        Math.max(0.5, radius * 0.2),
        centerX,
        centerY,
        radius
      );
      grad.addColorStop(0, highlight);
      grad.addColorStop(0.55, mid);
      grad.addColorStop(1, dark);
      ctx.fillStyle = grad;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const spriteEntries: Array<{
      d: number;
      x: number;
      y: number;
      sprite: Phaser.GameObjects.Sprite;
      worldSize: number;
      groundBias: number;
      fallbackColor: string;
      forceSolid?: boolean;
      outlineColor?: string;
      occlusionPad?: number;
    }> = [];

    const addSpriteEntry = (
      sprite: Phaser.GameObjects.Sprite,
      worldSize: number,
      groundBias: number,
      fallbackColor: string,
      options?: { forceSolid?: boolean; outlineColor?: string; occlusionPad?: number }
    ): void => {
      if (!sprite.active || !sprite.visible) return;
      const sx = sprite.x / frame.tileSize;
      const sy = sprite.y / frame.tileSize;
      const dx = sx - posX;
      const dy = sy - posY;
      const dist = Math.hypot(dx, dy);
      if (!Number.isFinite(dist) || dist <= 0.001 || dist > this.maxDepthTiles) return;
      spriteEntries.push({
        d: dist,
        x: sx,
        y: sy,
        sprite,
        worldSize,
        groundBias,
        fallbackColor,
        forceSolid: options?.forceSolid,
        outlineColor: options?.outlineColor,
        occlusionPad: options?.occlusionPad
      });
    };

    for (const g of frame.ghosts) {
      addSpriteEntry(g.view, 0.9, 0.5, ghostColorHex(g, frame.frightened));
    }
    const bombs = frame.bombs ?? [];
    for (const b of bombs) {
      addSpriteEntry(b, 0.55, 0.6, "#b8b8b8");
    }
    const boxes = frame.boxes ?? [];
    for (const b of boxes) {
      addSpriteEntry(b, 1.05, 0.6, "#8b5a2b", { forceSolid: true, outlineColor: "#c68a4a", occlusionPad: 0.08 });
    }
    const explosions = frame.explosions ?? [];
    for (const e of explosions) {
      addSpriteEntry(e, 1.35, 0.6, "#ff9c3a");
    }

    spriteEntries.sort((a, b) => b.d - a.d);

    for (const s of spriteEntries) {
      const dx = s.x - posX;
      const dy = s.y - posY;
      const dist = s.d;
      const angle = Math.atan2(dy, dx);
      const rel = normalizeAngleSigned(angle - this.yaw);
      if (Math.abs(rel) > fovHalf + 0.2) continue;

      const corrected = dist * Math.cos(rel);
      if (corrected <= 0.001) continue;

      const screenX = (w / 2) * (1 + rel / fovHalf);
      const size = (projPlaneDist * s.worldSize) / corrected;
      if (size < 2) continue;

      const frameRef = s.sprite.frame as Phaser.Textures.Frame | undefined;
      const source = frameRef?.source?.image as CanvasImageSource | undefined;
      const srcX = (frameRef as { cutX?: number } | undefined)?.cutX ?? 0;
      const srcY = (frameRef as { cutY?: number } | undefined)?.cutY ?? 0;
      const srcW =
        (frameRef as { cutWidth?: number } | undefined)?.cutWidth ??
        frameRef?.width ??
        (source as { width?: number } | undefined)?.width ??
        0;
      const srcH =
        (frameRef as { cutHeight?: number } | undefined)?.cutHeight ??
        frameRef?.height ??
        (source as { height?: number } | undefined)?.height ??
        0;

      const aspect = srcW > 0 && srcH > 0 ? srcW / srcH : 1;
      const wPx = size * aspect;
      const hPx = size;
      const x0 = screenX - wPx / 2;
      const x1 = screenX + wPx / 2;
      const yBottom = h / 2 + size * s.groundBias;
      const yTop = Math.floor(yBottom - hPx);
      const yH = Math.floor(hPx);

      const textureKey = s.sprite.texture?.key ?? "";
      const isBox = Boolean(s.forceSolid) || textureKey === "obj-box";
      const fadeBase = isBox ? 0.12 : 0.18;
      const fade = clamp(1 / (1 + corrected * fadeBase), isBox ? 0.35 : 0.15, 1);
      ctx.globalAlpha = fade;
      const occlusionPad = s.occlusionPad ?? -0.02;

      const forceSolid = isBox || textureKey === "obj-box";
      if (!forceSolid && source && srcW > 0 && srcH > 0) {
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
          if (this.occludeSprites) {
            const col = Math.floor(x / this.columnWidth);
            if (col < 0 || col >= this.rayCount) continue;
            if (corrected > this.depthBuffer[col] + occlusionPad) continue;
          }
          const u = wPx <= 0 ? 0 : (x - x0) / wPx;
          const sx = srcX + Math.max(0, Math.min(srcW - 1, Math.floor(u * srcW)));
          ctx.drawImage(source, sx, srcY, 1, srcH, x, yTop, 1, yH);
        }
      } else {
        const x0i = Math.floor(x0);
        const x1i = Math.floor(x1);
        const outline = s.outlineColor;
        const stripe = isBox ? "#a86a33" : s.fallbackColor;
        for (let x = x0i; x <= x1i; x++) {
          if (this.occludeSprites) {
            const col = Math.floor(x / this.columnWidth);
            if (col < 0 || col >= this.rayCount) continue;
            if (corrected > this.depthBuffer[col] + occlusionPad) continue;
          }
          const u = wPx <= 0 ? 0 : (x - x0) / wPx;
          if (outline && (x <= x0i + 1 || x >= x1i - 1)) {
            ctx.fillStyle = outline;
          } else if (isBox && Math.floor(u * 6) % 2 === 1) {
            ctx.fillStyle = stripe;
          } else {
            ctx.fillStyle = s.fallbackColor;
          }
          ctx.fillRect(x, yTop, 1, yH);
        }

        if (isBox) {
          let centerVisible = true;
          if (this.occludeSprites) {
            const col = Math.floor(screenX / this.columnWidth);
            centerVisible = col >= 0 && col < this.rayCount && corrected <= this.depthBuffer[col] + occlusionPad;
          }
          if (centerVisible) {
            const xLeft = Math.floor(x0);
            const xRight = Math.floor(x1);
            const yTopPx = Math.floor(yTop);
            const yBotPx = Math.floor(yBottom);
            ctx.strokeStyle = "#4a2d13";
            ctx.lineWidth = Math.max(1, Math.floor(size * 0.03));
            ctx.beginPath();
            ctx.moveTo(xLeft, yTopPx);
            ctx.lineTo(xRight, yBotPx);
            ctx.moveTo(xRight, yTopPx);
            ctx.lineTo(xLeft, yBotPx);
            ctx.stroke();
          }
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.image.destroy(true);
    this.scene.textures.remove(this.textureKey);
  }
}
