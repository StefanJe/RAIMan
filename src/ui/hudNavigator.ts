import Phaser from "phaser";
import { Direction } from "../game/directions";
import { worldToTile } from "../game/gridMath";
import type { ParsedLevel, TileType } from "../game/levelTypes";
import { isWalkable } from "../game/levelTypes";
import { nextTileWithWrap } from "../game/wrapTunnels";
import type { FpsRendererFrame } from "./fpsRenderer";

type DirCode = 0 | 1 | 2 | 3; // 0=E,1=S,2=W,3=N

function dirToCode(dir: Direction): DirCode | null {
  switch (dir) {
    case Direction.Right:
      return 0;
    case Direction.Down:
      return 1;
    case Direction.Left:
      return 2;
    case Direction.Up:
      return 3;
    case Direction.None:
    default:
      return null;
  }
}

function relativeTurn(from: DirCode, to: DirCode): "straight" | "left" | "right" | "uturn" {
  const diff = (to - from + 4) % 4;
  if (diff === 0) return "straight";
  if (diff === 2) return "uturn";
  return diff === 1 ? "right" : "left";
}

function arrowForTurn(turn: "straight" | "left" | "right" | "uturn"): string {
  switch (turn) {
    case "left":
      return "←";
    case "right":
      return "→";
    case "uturn":
      return "↩";
    case "straight":
    default:
      return "↑";
  }
}

function compassLabel(dir: Direction): string {
  // Screen uses x-right, y-down (Phaser): Up=N, Right=E, Down=S, Left=W.
  switch (dir) {
    case Direction.Up:
      return "N";
    case Direction.Right:
      return "E";
    case Direction.Down:
      return "S";
    case Direction.Left:
      return "W";
    case Direction.None:
    default:
      return "·";
  }
}

function facingFromYawRad(yawRad: number): Direction {
  const a = ((yawRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const step = Math.PI / 2;
  const idx = Math.round(a / step) % 4;
  // 0=E,1=S,2=W,3=N
  return idx === 0 ? Direction.Right : idx === 1 ? Direction.Down : idx === 2 ? Direction.Left : Direction.Up;
}

export class HudNavigator {
  readonly container: Phaser.GameObjects.Container;

  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly compass: Phaser.GameObjects.Text;
  private readonly nextTurn: Phaser.GameObjects.Text;
  private readonly goal: Phaser.GameObjects.Text;

  private level?: ParsedLevel;
  private visitedStamp?: Uint32Array;
  private prev?: Int32Array;
  private prevDir?: Int8Array;
  private queue?: Int32Array;
  private stamp = 1;
  private pathDirBuf?: Int8Array;

  private lastBfsAtMs = 0;
  private lastPlayerIdx = -1;
  private lastGoalMode: "power" | "pellet" = "pellet";
  private lastFacing: Direction = Direction.Right;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(1800);
    this.container.setScrollFactor(0);

    this.bg = scene.add.graphics().setScrollFactor(0);
    this.title = scene.add
      .text(0, 0, "NAV", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#e6f0ff"
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setAlpha(0.85);

    this.compass = scene.add
      .text(0, 0, "N E S W", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: "14px",
        color: "#cfe0ff"
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0);

    this.nextTurn = scene.add
      .text(0, 0, "Next: ↑", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "16px",
        color: "#7cffb2",
        fontStyle: "700"
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0);

    this.goal = scene.add
      .text(0, 0, "Target: pellet", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "12px",
        color: "#9fb4d6"
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0);

    this.container.add([this.bg, this.title, this.compass, this.nextTurn, this.goal]);
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  layout(viewWidth: number, _viewHeight: number): void {
    const w = Math.max(220, Math.min(320, Math.floor(viewWidth * 0.62)));
    const h = 74;
    const x = Math.floor(viewWidth / 2);
    const y = 62;

    this.container.setPosition(x, y);

    this.bg.clear();
    this.bg.fillStyle(0x050a18, 0.72);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    this.bg.lineStyle(1, 0x1f3a66, 0.55);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);

    this.title.setPosition(0, -h / 2 + 12);
    this.compass.setPosition(0, -6);
    this.nextTurn.setPosition(0, 14);
    this.goal.setPosition(0, h / 2 - 12);
  }

  tick(frame: FpsRendererFrame): void {
    this.ensureLevel(frame.level);

    const tile = worldToTile(frame.player.view.x, frame.player.view.y, frame.tileSize);
    const idx = tile.y * frame.level.width + tile.x;

    const facing =
      typeof frame.viewYawRad === "number" && Number.isFinite(frame.viewYawRad)
        ? facingFromYawRad(frame.viewYawRad)
        : frame.player.direction !== Direction.None
          ? frame.player.direction
          : this.lastFacing;
    this.lastFacing = facing;
    this.compass.setText(`N E S W  |  ${compassLabel(facing)}`);

    const ghostNear = this.anyGhostNear(frame, tile.x, tile.y, 6);
    const goalMode: "power" | "pellet" = ghostNear && frame.pellets.getRemainingPowers() > 0 ? "power" : "pellet";

    const now = frame.nowMs;
    const needsUpdate = idx !== this.lastPlayerIdx || goalMode !== this.lastGoalMode;
    if (!needsUpdate && now - this.lastBfsAtMs < 400) return;

    this.lastBfsAtMs = now;
    this.lastPlayerIdx = idx;
    this.lastGoalMode = goalMode;

    const res = this.computeNextTurn(frame.level, tile.x, tile.y, facing, goalMode);
    if (!res) {
      this.nextTurn.setText("Next: ·");
      this.goal.setText(`Target: ${goalMode === "power" ? "power" : "pellet"} (none)`);
      return;
    }

    const distLabel = res.distToTurnTiles > 0 ? `  (${res.distToTurnTiles})` : "";
    this.nextTurn.setText(`Next: ${res.turnArrow}${distLabel}`);
    this.goal.setText(`Target: ${res.targetLabel}  (${res.pathLenTiles})`);
  }

  private anyGhostNear(frame: FpsRendererFrame, px: number, py: number, tiles: number): boolean {
    const r2 = tiles * tiles;
    for (const g of frame.ghosts) {
      if (!g.view.visible) continue;
      const t = g.getTile();
      const dx = t.x - px;
      const dy = t.y - py;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  private ensureLevel(level: ParsedLevel): void {
    if (this.level === level && this.visitedStamp && this.prev && this.prevDir && this.queue && this.pathDirBuf) return;
    this.level = level;
    const n = level.width * level.height;
    this.visitedStamp = new Uint32Array(n);
    this.prev = new Int32Array(n);
    this.prevDir = new Int8Array(n);
    this.queue = new Int32Array(n);
    this.pathDirBuf = new Int8Array(n);
    this.stamp = 1;
  }

  private computeNextTurn(
    level: ParsedLevel,
    startX: number,
    startY: number,
    facing: Direction,
    goalMode: "power" | "pellet",
    allowFallback = true
  ): { turnArrow: string; distToTurnTiles: number; pathLenTiles: number; targetLabel: string } | null {
    const w = level.width;
    const h = level.height;
    if (startX < 0 || startY < 0 || startX >= w || startY >= h) return null;

    const startIdx = startY * w + startX;
    const visited = this.visitedStamp!;
    const prev = this.prev!;
    const prevDir = this.prevDir!;
    const queue = this.queue!;
    const pathBuf = this.pathDirBuf!;

    const stamp = (this.stamp = (this.stamp + 1) >>> 0);
    if (stamp === 0) {
      // Rare overflow: reset stamps.
      visited.fill(0);
      this.stamp = 1;
    }

    const goalTile: (t: TileType) => boolean =
      goalMode === "power"
        ? (t) => t === "power"
        : (t) => t === "pellet";

    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    visited[startIdx] = this.stamp;
    prev[startIdx] = -1;
    prevDir[startIdx] = -1;

    let foundIdx = -1;

    while (head < tail) {
      const cur = queue[head++]!;
      const cy = Math.floor(cur / w);
      const cx = cur - cy * w;
      const tile = level.tileMatrix[cy]?.[cx];
      if (tile && goalTile(tile) && cur !== startIdx) {
        foundIdx = cur;
        break;
      }

      for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
        const nt = nextTileWithWrap(level, cx, cy, dir);
        if (!nt) continue;
        const nx = nt.x;
        const ny = nt.y;
        const t = level.tileMatrix[ny]?.[nx];
        if (!t || !isWalkable(t)) continue;
        const ni = ny * w + nx;
        if (visited[ni] === this.stamp) continue;
        visited[ni] = this.stamp;
        prev[ni] = cur;
        prevDir[ni] = dirToCode(dir) ?? -1;
        queue[tail++] = ni;
      }
    }

    // Fallback: if we wanted "power" but didn't find any, try pellets.
    if (foundIdx === -1 && goalMode === "power" && allowFallback) {
      return this.computeNextTurn(level, startX, startY, facing, "pellet", false);
    }
    // If we wanted pellets but none exist, head to a remaining power pellet if any.
    if (foundIdx === -1 && goalMode === "pellet" && allowFallback) {
      return this.computeNextTurn(level, startX, startY, facing, "power", false);
    }
    if (foundIdx === -1) return null;

    // Reconstruct path directions into buffer (forward order) without allocations.
    let len = 0;
    for (let cur = foundIdx; cur !== startIdx; cur = prev[cur]!) {
      len += 1;
      if (len >= pathBuf.length) break;
    }
    if (len <= 0) return null;

    let write = len;
    for (let cur = foundIdx; cur !== startIdx; cur = prev[cur]!) {
      const d = prevDir[cur]!;
      write -= 1;
      pathBuf[write] = d;
      if (write <= 0) break;
    }

    const facingCode = dirToCode(facing) ?? (pathBuf[0]! as DirCode);
    let nextDir = pathBuf[0]! as DirCode;
    let distToTurn = len;
    for (let i = 0; i < len; i++) {
      const d = pathBuf[i]!;
      if (d !== facingCode) {
        nextDir = d as DirCode;
        distToTurn = i;
        break;
      }
    }

    const turn = relativeTurn(facingCode, nextDir);
    const arrow = arrowForTurn(turn);
    const targetLabel = goalMode === "power" ? "power" : "pellet";
    return {
      turnArrow: arrow,
      distToTurnTiles: Math.max(0, distToTurn),
      pathLenTiles: len,
      targetLabel
    };
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
