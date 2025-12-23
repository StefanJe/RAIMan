import { Direction, vec } from "./directions";
import type { ParsedLevel } from "./levelTypes";
import { isWalkable } from "./levelTypes";

export function isAllowedBorderTunnelChar(ch: string): boolean {
  // User-facing rule: tunnels may be empty or pellet-like; we also allow power/bomb/fruit markers.
  return ch === " " || ch === "." || ch === "o" || ch === "A" || ch === "5";
}

export function getWrapDestination(
  level: Pick<ParsedLevel, "width" | "height" | "tileMatrix">,
  tileX: number,
  tileY: number,
  dir: Direction
): { x: number; y: number } | null {
  if (dir === Direction.None) return null;
  const v = vec(dir);
  const nx = tileX + v.x;
  const ny = tileY + v.y;

  // Normal in-bounds move isn't a "wrap".
  if (nx >= 0 && ny >= 0 && nx < level.width && ny < level.height) return null;

  // Only allow wrapping from the edge to the opposite edge on the same row/column.
  if (dir === Direction.Left && tileX === 0) {
    const destX = level.width - 1;
    if (!isWalkable(level.tileMatrix[tileY]![tileX]!)) return null;
    if (!isWalkable(level.tileMatrix[tileY]![destX]!)) return null;
    return { x: destX, y: tileY };
  }
  if (dir === Direction.Right && tileX === level.width - 1) {
    const destX = 0;
    if (!isWalkable(level.tileMatrix[tileY]![tileX]!)) return null;
    if (!isWalkable(level.tileMatrix[tileY]![destX]!)) return null;
    return { x: destX, y: tileY };
  }
  if (dir === Direction.Up && tileY === 0) {
    const destY = level.height - 1;
    if (!isWalkable(level.tileMatrix[tileY]![tileX]!)) return null;
    if (!isWalkable(level.tileMatrix[destY]![tileX]!)) return null;
    return { x: tileX, y: destY };
  }
  if (dir === Direction.Down && tileY === level.height - 1) {
    const destY = 0;
    if (!isWalkable(level.tileMatrix[tileY]![tileX]!)) return null;
    if (!isWalkable(level.tileMatrix[destY]![tileX]!)) return null;
    return { x: tileX, y: destY };
  }

  return null;
}

export function nextTileWithWrap(
  level: Pick<ParsedLevel, "width" | "height" | "tileMatrix">,
  tileX: number,
  tileY: number,
  dir: Direction
): { x: number; y: number } | null {
  if (dir === Direction.None) return null;
  const v = vec(dir);
  const nx = tileX + v.x;
  const ny = tileY + v.y;

  if (nx >= 0 && ny >= 0 && nx < level.width && ny < level.height) {
    if (!isWalkable(level.tileMatrix[ny]![nx]!)) return null;
    return { x: nx, y: ny };
  }

  const wrap = getWrapDestination(level, tileX, tileY, dir);
  if (!wrap) return null;
  return wrap;
}

