import { parseLevel } from "./levelParser";
import type { GridPos, LevelJson, ValidationResult } from "./levelTypes";
import { isAllowedBorderTunnelChar, nextTileWithWrap } from "./wrapTunnels";
import { Direction } from "./directions";

function borderRules(grid: string[], width: number, height: number): string[] {
  const errors: string[] = [];
  if (width < 3 || height < 3) errors.push(`Level must be at least 3x3, got ${width}x${height}.`);
  if (errors.length > 0) return errors;

  const checkPair = (a: string, ax: number, ay: number, b: string, bx: number, by: number, axis: "horizontal" | "vertical"): void => {
    const aWall = a === "#";
    const bWall = b === "#";
    if (aWall && bWall) return;
    if (aWall !== bWall) {
      errors.push(
        `Tunnel mismatch (${axis}): (${ax}, ${ay}) is '${a}', but (${bx}, ${by}) is '${b}' (both must be wall or tunnel).`
      );
      return;
    }

    // Both are tunnels: must be allowed tunnel chars.
    if (!isAllowedBorderTunnelChar(a)) errors.push(`Invalid tunnel tile at (${ax}, ${ay}): '${a}'. Use ' ' or '.', 'o', 'A', '5'.`);
    if (!isAllowedBorderTunnelChar(b)) errors.push(`Invalid tunnel tile at (${bx}, ${by}): '${b}'. Use ' ' or '.', 'o', 'A', '5'.`);
  };

  // Left/right pairing per row.
  for (let y = 0; y < height; y++) {
    const row = grid[y]!;
    checkPair(row[0]!, 0, y, row[width - 1]!, width - 1, y, "horizontal");
  }

  // Top/bottom pairing per column.
  const top = grid[0]!;
  const bottom = grid[height - 1]!;
  for (let x = 0; x < width; x++) {
    checkPair(top[x]!, x, 0, bottom[x]!, x, height - 1, "vertical");
  }

  return errors;
}

function pelletsReachableFromStart(
  parsed: ReturnType<typeof parseLevel>,
  starts: GridPos[],
  pelletPositions: GridPos[]
): string[] {
  const height = parsed.tileMatrix.length;
  const width = parsed.tileMatrix[0]?.length ?? 0;

  const visited: boolean[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  const queue: GridPos[] = [];
  for (const start of starts) {
    if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) continue;
    if (visited[start.y]![start.x]) continue;
    visited[start.y]![start.x] = true;
    queue.push({ x: start.x, y: start.y });
  }

  const directions = [Direction.Right, Direction.Left, Direction.Down, Direction.Up] as const;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const d of directions) {
      const next = nextTileWithWrap(parsed, current.x, current.y, d);
      if (!next) continue;
      if (visited[next.y]![next.x]) continue;
      visited[next.y]![next.x] = true;
      queue.push({ x: next.x, y: next.y });
    }
  }

  const errors: string[] = [];
  for (const pellet of pelletPositions) {
    if (!visited[pellet.y]?.[pellet.x]) {
      errors.push(`Pellet at (${pellet.x}, ${pellet.y}) is not reachable from PlayerStart.`);
    }
  }
  return errors;
}

export function validateLevel(level: LevelJson): ValidationResult {
  const errors: string[] = [];

  let parsed: ReturnType<typeof parseLevel> | null = null;
  try {
    parsed = parseLevel(level);
  } catch (e) {
    if (typeof e === "object" && e !== null && "errors" in e && Array.isArray((e as { errors: unknown }).errors)) {
      return { ok: false, errors: (e as { errors: string[] }).errors };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [message] };
  }

  errors.push(...borderRules(parsed.rawGrid, parsed.width, parsed.height));

  if (parsed.playerStartCount < 1 || parsed.playerStartCount > 2) {
    errors.push(`Expected 1 or 2 PlayerStart 'P', found ${parsed.playerStartCount}.`);
  }

  if (parsed.pelletCount < 1) {
    errors.push("Expected at least 1 Pellet '.'.");
  }

  if (parsed.ghostStarts.length < 1) {
    errors.push("Expected at least 1 GhostStart 'G'.");
  }

  if (parsed.playerStarts.length > 0 && parsed.pelletCount > 0) {
    errors.push(...pelletsReachableFromStart(parsed, parsed.playerStarts, parsed.pelletPositions));
  }

  return { ok: errors.length === 0, errors };
}
