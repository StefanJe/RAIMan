import { Direction, opposite, vec } from "./directions";
import type { ParsedLevel } from "./levelTypes";
import { nextTileWithWrap } from "./wrapTunnels";

export interface TilePos {
  x: number;
  y: number;
}

function canMove(level: ParsedLevel, tile: TilePos, direction: Direction): boolean {
  return nextTileWithWrap(level, tile.x, tile.y, direction) !== null;
}

function availableDirections(level: ParsedLevel, tile: TilePos): Direction[] {
  const dirs: Direction[] = [];
  for (const d of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
    if (canMove(level, tile, d)) dirs.push(d);
  }
  return dirs;
}

function pickRandom<T>(items: T[], rng: () => number): T {
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(items.length - 1, Math.max(0, idx))]!;
}

function dist2(a: TilePos, b: TilePos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function nextTile(tile: TilePos, direction: Direction): TilePos {
  return { x: tile.x + vec(direction).x, y: tile.y + vec(direction).y };
}

// Rules:
// - At intersections pick random direction
// - Don't immediately reverse, unless dead end (only reverse possible)
export function chooseDirection(
  level: ParsedLevel,
  ghostTile: TilePos,
  currentDir: Direction,
  rng: () => number,
  context?: { mode?: "normal" | "frightened"; playerTile?: TilePos }
): Direction {
  const dirs = availableDirections(level, ghostTile);
  if (dirs.length === 0) return Direction.None;
  if (dirs.length === 1) return dirs[0]!;

  const rev = opposite(currentDir);
  const forwardPossible = currentDir !== Direction.None && dirs.includes(currentDir);

  // Prefer continuing in corridors (2-way) unless blocked.
  if ((context?.mode ?? "normal") === "normal" && dirs.length === 2 && forwardPossible) {
    return currentDir;
  }

  const withoutReverse = currentDir === Direction.None ? dirs : dirs.filter((d) => d !== rev);
  const candidates = withoutReverse.length > 0 ? withoutReverse : dirs;

  if ((context?.mode ?? "normal") === "frightened" && context?.playerTile) {
    let best: Direction[] = [];
    let bestScore = -Infinity;
    for (const d of candidates) {
      const wrapped = nextTileWithWrap(level, ghostTile.x, ghostTile.y, d);
      const nt = wrapped ? wrapped : nextTile(ghostTile, d);
      const score = dist2(nt, context.playerTile);
      if (score > bestScore) {
        bestScore = score;
        best = [d];
      } else if (score === bestScore) {
        best.push(d);
      }
    }
    return pickRandom(best.length > 0 ? best : candidates, rng);
  }

  return pickRandom(candidates, rng);
}
