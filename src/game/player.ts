import Phaser from "phaser";
import type { ParsedLevel } from "./levelTypes";
import { isWalkable } from "./levelTypes";
import { Direction, isHorizontal, isVertical, vec } from "./directions";
import { tileCenter, worldToTile } from "./gridMath";
import { getWrapDestination, nextTileWithWrap } from "./wrapTunnels";

export interface PlayerConfig {
  tileSize: number;
  speedPxPerSec: number;
  radiusPx?: number;
  color?: number;
}

export class Player {
  readonly view: Phaser.GameObjects.Sprite;
  direction: Direction = Direction.None;
  desiredDirection: Direction = Direction.None;

  private readonly baseDepth = 2;
  private readonly tileSize: number;
  private readonly speedPxPerSec: number;
  private readonly level: ParsedLevel;
  private readonly epsilon: number;
  private facing: Direction = Direction.Right;
  private playingKey: string | null = null;
  private dying = false;
  private lastSafeTile: { x: number; y: number };

  constructor(scene: Phaser.Scene, level: ParsedLevel, startTileX: number, startTileY: number, config: PlayerConfig) {
    this.level = level;
    this.tileSize = config.tileSize;
    this.speedPxPerSec = config.speedPxPerSec;
    this.epsilon = Math.max(0.5, Math.min(2, this.tileSize * 0.04));
    this.lastSafeTile = { x: startTileX, y: startTileY };

    const start = tileCenter(startTileX, startTileY, this.tileSize);
    this.view = scene.add.sprite(start.x, start.y, "pacman-move-right-1");
    this.view.setDepth(this.baseDepth);
    const size = Math.max(10, Math.floor(this.tileSize * 0.9));
    this.view.setDisplaySize(size, size);
    this.applyAnimation();
  }

  setDesiredDirection(direction: Direction): void {
    this.desiredDirection = direction;
  }

  startDeath(): void {
    if (this.dying) return;
    this.dying = true;
    this.direction = Direction.None;
    this.desiredDirection = Direction.None;
    this.view.anims.stop();
    // Force a clean re-apply of the movement sprite on respawn.
    this.playingKey = null;
    // Ensure the first death frame is visible immediately (and above ghosts).
    this.view.setVisible(true);
    this.view.setDepth(this.baseDepth + 1);
    this.view.setTexture("pacman-death-1");
    this.view.play("pacman-death");
  }

  isDying(): boolean {
    return this.dying;
  }

  resetToTile(tileX: number, tileY: number): void {
    const start = tileCenter(tileX, tileY, this.tileSize);
    this.view.setPosition(start.x, start.y);
    this.dying = false;
    this.direction = Direction.None;
    this.desiredDirection = Direction.None;
    this.view.setDepth(this.baseDepth);
    this.view.setVisible(true);
    this.view.anims.stop();
    this.playingKey = null;
    this.lastSafeTile = { x: tileX, y: tileY };
    this.applyAnimation();
  }

  update(deltaMs: number): void {
    let dt = deltaMs / 1000;
    if (dt <= 0) return;

    // Cap large frames to keep stepping stable.
    dt = Math.min(dt, 0.05);

    if (this.dying) return;

    // Safety guard: if we ever end up inside a wall (e.g. due to a missed center snap on some frame rates),
    // snap back to the last known-good tile.
    if (this.enforceNotInWall()) {
      this.applyAnimation();
      return;
    }

    const centerTol = this.centerToleranceForDelta(deltaMs);

    let steps = 0;
    while (dt > 0 && steps < 16) {
      steps += 1;

      if (this.tryApplyTurnAndCollideStop(centerTol)) {
        // At a tile center: direction might have changed or stopped.
      }

      if (this.direction === Direction.None) {
        this.applyAnimation();
        return;
      }

      const moved = this.moveTowardsNextCenter(dt);
      dt -= moved;
    }

    this.applyAnimation();
  }

  private centerToleranceForDelta(deltaMs: number): number {
    const dt = Math.min(Math.max(0, deltaMs) / 1000, 0.05);
    const stepPx = this.speedPxPerSec * dt;

    if (!Number.isFinite(stepPx) || stepPx <= 0) return this.epsilon;
    // Only tighten center snapping when the per-frame movement is small enough that we'd otherwise snap back every frame
    // on high refresh rates (which can stall movement at very low speeds).
    if (stepPx >= this.epsilon) return this.epsilon;
    return Math.max(0.2, stepPx * 0.6);
  }

  private tryApplyTurnAndCollideStop(centerTol: number): boolean {
    const { x, y } = this.view;
    if (!this.isAtCenter(x, y, centerTol)) return false;

    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);
    this.view.setPosition(center.x, center.y);

    if (isWalkable(this.level.tileMatrix[tile.y]?.[tile.x] ?? "wall")) {
      this.lastSafeTile = { x: tile.x, y: tile.y };
    }

    if (this.desiredDirection !== Direction.None && this.canMove(tile.x, tile.y, this.desiredDirection)) {
      this.direction = this.desiredDirection;
    }

    if (this.direction !== Direction.None && !this.canMove(tile.x, tile.y, this.direction)) {
      this.direction = Direction.None;
    }

    // If we are on an edge tunnel and continue outward, wrap immediately.
    if (this.direction !== Direction.None) {
      const wrap = getWrapDestination(this.level, tile.x, tile.y, this.direction);
      if (wrap) {
        const p = tileCenter(wrap.x, wrap.y, this.tileSize);
        this.view.setPosition(p.x, p.y);
      }
    }

    return true;
  }

  private moveTowardsNextCenter(dt: number): number {
    const dir = this.direction;
    const speed = this.speedPxPerSec;

    const { x, y } = this.view;
    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);

    let targetX = x;
    let targetY = y;

    if (isHorizontal(dir)) {
      // Keep perfectly aligned on the row centerline.
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

  private canMove(tileX: number, tileY: number, dir: Direction): boolean {
    return nextTileWithWrap(this.level, tileX, tileY, dir) !== null;
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

  private isAtCenter(x: number, y: number, epsilon = this.epsilon): boolean {
    const tile = worldToTile(x, y, this.tileSize);
    const center = tileCenter(tile.x, tile.y, this.tileSize);
    return Math.abs(x - center.x) <= epsilon && Math.abs(y - center.y) <= epsilon;
  }

  private applyAnimation(): void {
    if (this.dying) return;
    const dir = this.direction !== Direction.None ? this.direction : this.desiredDirection !== Direction.None ? this.desiredDirection : this.facing;
    if (dir !== Direction.None) this.facing = dir;

    const suffix = this.facing === Direction.Up ? "top" : this.facing === Direction.Down ? "bottom" : this.facing === Direction.Left ? "left" : "right";
    const animKey = `pacman-move-${suffix}`;
    const stillKey = `pacman-move-${suffix}-1`;

    if (this.direction === Direction.None) {
      if (this.view.anims.isPlaying) this.view.anims.stop();
      if (this.playingKey !== stillKey) {
        this.view.setTexture(stillKey);
        this.playingKey = stillKey;
      }
      return;
    }

    const current = this.view.anims.currentAnim?.key ?? null;
    if (current !== animKey) {
      this.view.play(animKey);
      this.playingKey = animKey;
    }
  }
}
