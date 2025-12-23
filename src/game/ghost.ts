import Phaser from "phaser";
import { Direction, isHorizontal, isVertical, vec } from "./directions";
import { chooseDirection, type TilePos } from "./ghostAI";
import { tileCenter, worldToTile } from "./gridMath";
import type { ParsedLevel } from "./levelTypes";
import { isWalkable } from "./levelTypes";
import { EATEN_RESPAWN_MS, GhostState, tickRemainingMs } from "./ghostState";
import { getWrapDestination } from "./wrapTunnels";

export type GhostSkin = "blinky" | "pinky" | "inky" | "clyde";

export interface GhostConfig {
  tileSize: number;
  speedPxPerSec: number;
  radiusPx?: number;
  color?: number;
  rng?: () => number;
  frightenedSpeedMultiplier?: number;
  skin?: GhostSkin;
  /**
   * Helps very slow configurations: if a ghost ends up stopped, snap to the nearest tile center
   * and re-pick a direction to avoid getting "stuck".
   */
  snapWhenStopped?: boolean;
}

export class Ghost {
  readonly view: Phaser.GameObjects.Sprite;
  state: GhostState = GhostState.Normal;
  direction: Direction = Direction.None;

  private readonly level: ParsedLevel;
  private readonly tileSize: number;
  private readonly baseSpeedPxPerSec: number;
  private readonly frightenedSpeedMultiplier: number;
  private readonly epsilon: number;
  private readonly centerEpsilon: number;
  private readonly rng: () => number;
  private readonly startTile: TilePos;
  private readonly skin: GhostSkin;
  private readonly snapWhenStopped: boolean;
  private facing: Direction = Direction.Left;
  private lastSafeTile: TilePos;

  private eatenRemainingMs = 0;

  constructor(scene: Phaser.Scene, level: ParsedLevel, startTileX: number, startTileY: number, config: GhostConfig) {
    this.level = level;
    this.tileSize = config.tileSize;
    this.baseSpeedPxPerSec = config.speedPxPerSec;
    this.frightenedSpeedMultiplier = config.frightenedSpeedMultiplier ?? 0.6;
    this.epsilon = Math.max(0.5, Math.min(2, this.tileSize * 0.04));
    this.rng = config.rng ?? (() => Phaser.Math.RND.frac());
    this.startTile = { x: startTileX, y: startTileY };
    this.lastSafeTile = { x: startTileX, y: startTileY };
    this.skin = config.skin ?? "blinky";
    this.snapWhenStopped = config.snapWhenStopped === true;
    // On very slow configurations, use a tighter center tolerance so we don't keep snapping back to center
    // every frame (which looks like jitter on high refresh rates).
    this.centerEpsilon = this.snapWhenStopped ? 0.35 : this.epsilon;

    const start = tileCenter(startTileX, startTileY, this.tileSize);
    this.view = scene.add.sprite(start.x, start.y, `ghost-${this.skin}-left-1`);
    this.view.setDepth(2);
    const size = Math.max(10, Math.floor(this.tileSize * 0.9));
    this.view.setDisplaySize(size, size);
    this.applyAnimation();
  }

  update(deltaMs: number, playerTile: TilePos, globalFrightened: boolean): void {
    if (this.state === GhostState.Eaten) {
      this.eatenRemainingMs = tickRemainingMs(this.eatenRemainingMs, deltaMs);
      if (this.eatenRemainingMs === 0) {
        this.respawn(globalFrightened ? GhostState.Frightened : GhostState.Normal);
      }
      return;
    }

    const nextState = globalFrightened ? GhostState.Frightened : GhostState.Normal;
    if (nextState !== this.state) {
      this.state = nextState;
      this.applyAnimation();
    } else {
      this.state = nextState;
    }

    let dt = deltaMs / 1000;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);

    // Safety guard: if we ever end up inside a wall, snap back to last known-good tile.
    if (this.enforceNotInWall()) {
      this.applyAnimation();
      return;
    }

    const centerTol = this.centerToleranceForDelta(deltaMs);

    if (this.direction === Direction.None && this.snapWhenStopped) {
      // Snap to the nearest center to stabilize tile math, then choose a fresh direction.
      const tile = worldToTile(this.view.x, this.view.y, this.tileSize);
      const center = tileCenter(tile.x, tile.y, this.tileSize);
      this.view.setPosition(center.x, center.y);
      const mode = this.state === GhostState.Frightened ? "frightened" : "normal";
      this.direction = chooseDirection(this.level, tile, Direction.None, this.rng, { mode, playerTile });

      if (this.direction !== Direction.None) {
        const wrap = getWrapDestination(this.level, tile.x, tile.y, this.direction);
        if (wrap) {
          const p = tileCenter(wrap.x, wrap.y, this.tileSize);
          this.view.setPosition(p.x, p.y);
        }
      }
    }

    let steps = 0;
    while (dt > 0 && steps < 16) {
      steps += 1;
      this.pickDirectionIfAtCenter(playerTile, centerTol);
      if (this.direction === Direction.None) return;
      const moved = this.moveTowardsNextCenter(dt);
      dt -= moved;
    }

    this.applyAnimation();
  }

  getTile(): TilePos {
    return worldToTile(this.view.x, this.view.y, this.tileSize);
  }

  stop(): void {
    this.direction = Direction.None;
    this.applyAnimation();
  }

  resetToStart(globalFrightened: boolean): void {
    this.eatenRemainingMs = 0;
    this.respawn(globalFrightened ? GhostState.Frightened : GhostState.Normal);
  }

  eat(respawnMs = EATEN_RESPAWN_MS): void {
    this.state = GhostState.Eaten;
    this.eatenRemainingMs = respawnMs;
    this.direction = Direction.None;
    this.view.setVisible(false);
  }

  private respawn(nextState: GhostState): void {
    const p = tileCenter(this.startTile.x, this.startTile.y, this.tileSize);
    this.view.setPosition(p.x, p.y);
    this.view.setVisible(true);
    this.direction = Direction.None;
    this.state = nextState;
    this.lastSafeTile = { x: this.startTile.x, y: this.startTile.y };
    this.applyAnimation();
  }

  private currentSpeedPxPerSec(): number {
    return this.state === GhostState.Frightened ? this.baseSpeedPxPerSec * this.frightenedSpeedMultiplier : this.baseSpeedPxPerSec;
  }

  private centerToleranceForDelta(deltaMs: number): number {
    const dt = Math.min(Math.max(0, deltaMs) / 1000, 0.05);
    const speed = this.currentSpeedPxPerSec();
    const stepPx = speed * dt;

    const baseTol = this.centerEpsilon;
    if (!Number.isFinite(stepPx) || stepPx <= 0) return baseTol;
    if (stepPx >= baseTol) return baseTol;
    return Math.max(0.2, stepPx * 0.6);
  }

  private pickDirectionIfAtCenter(playerTile: TilePos, centerTol: number): void {
    const { x, y } = this.view;
    if (!this.isAtCenter(x, y, centerTol)) return;

    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);
    this.view.setPosition(center.x, center.y);

    if (isWalkable(this.level.tileMatrix[tile.y]?.[tile.x] ?? "wall")) {
      this.lastSafeTile = { x: tile.x, y: tile.y };
    }

    const mode = this.state === GhostState.Frightened ? "frightened" : "normal";
    const next = chooseDirection(this.level, tile, this.direction, this.rng, { mode, playerTile });
    this.direction = next;
    this.applyAnimation();

    // If we are on an edge tunnel and continue outward, wrap immediately.
    if (this.direction !== Direction.None) {
      const wrap = getWrapDestination(this.level, tile.x, tile.y, this.direction);
      if (wrap) {
        const p = tileCenter(wrap.x, wrap.y, this.tileSize);
        this.view.setPosition(p.x, p.y);
      }
    }
  }

  private moveTowardsNextCenter(dt: number): number {
    const dir = this.direction;
    const speed = this.currentSpeedPxPerSec();

    const { x, y } = this.view;
    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);

    let targetX = x;
    let targetY = y;

    if (isHorizontal(dir)) {
      if (Math.abs(y - center.y) > this.epsilon) this.view.y = center.y;
      if (dir === Direction.Right) {
        targetX = x < center.x - this.epsilon ? center.x : tileCenter(tile.x + 1, tile.y, this.tileSize).x;
      } else {
        targetX = x > center.x + this.epsilon ? center.x : tileCenter(tile.x - 1, tile.y, this.tileSize).x;
      }
      targetY = center.y;
    } else if (isVertical(dir)) {
      if (Math.abs(x - center.x) > this.epsilon) this.view.x = center.x;
      if (dir === Direction.Down) {
        targetY = y < center.y - this.epsilon ? center.y : tileCenter(tile.x, tile.y + 1, this.tileSize).y;
      } else {
        targetY = y > center.y + this.epsilon ? center.y : tileCenter(tile.x, tile.y - 1, this.tileSize).y;
      }
      targetX = center.x;
    } else {
      return dt;
    }

    const distance = Math.abs(targetX - this.view.x) + Math.abs(targetY - this.view.y);
    if (distance <= this.epsilon) {
      this.view.setPosition(targetX, targetY);
      return 0;
    }

    const timeToTarget = distance / speed;
    const travelTime = Math.min(dt, timeToTarget);
    const travelDist = travelTime * speed;
    const v = vec(dir);
    this.view.x += v.x * travelDist;
    this.view.y += v.y * travelDist;

    if (travelTime === timeToTarget) {
      this.view.setPosition(targetX, targetY);
    }

    return travelTime;
  }

  private enforceNotInWall(): boolean {
    const tile = worldToTile(this.view.x, this.view.y, this.tileSize);
    const t = this.level.tileMatrix[tile.y]?.[tile.x];
    if (!t || isWalkable(t)) return false;

    const safe = this.lastSafeTile;
    const safeT = this.level.tileMatrix[safe.y]?.[safe.x];
    if (!safeT || !isWalkable(safeT)) return false;

    const p = tileCenter(safe.x, safe.y, this.tileSize);
    this.view.setPosition(p.x, p.y);
    this.direction = Direction.None;
    return true;
  }

  private isAtCenter(x: number, y: number, epsilon = this.centerEpsilon): boolean {
    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);
    return Math.abs(x - center.x) <= epsilon && Math.abs(y - center.y) <= epsilon;
  }

  private applyAnimation(): void {
    if (!this.view.visible) return;

    const dir = this.direction !== Direction.None ? this.direction : this.facing;
    if (dir !== Direction.None) this.facing = dir;

    if (this.state === GhostState.Frightened) {
      const current = this.view.anims.currentAnim?.key ?? null;
      if (current !== "ghost-frightened") this.view.play("ghost-frightened");
      return;
    }

    const suffix = this.facing === Direction.Up ? "up" : this.facing === Direction.Down ? "down" : this.facing === Direction.Left ? "left" : "right";
    const animKey = `ghost-${this.skin}-${suffix}`;
    const stillKey = `ghost-${this.skin}-${suffix}-1`;

    if (this.direction === Direction.None) {
      if (this.view.anims.isPlaying) this.view.anims.stop();
      this.view.setTexture(stillKey);
      return;
    }

    const current = this.view.anims.currentAnim?.key ?? null;
    if (current !== animKey) this.view.play(animKey);
  }
}
