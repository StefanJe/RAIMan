import { Direction } from "./directions";
import type { GridPos, ParsedLevel, TileType } from "./levelTypes";
import { isWalkable } from "./levelTypes";
import type { Rng } from "./rng";
import { nextTileWithWrap } from "./wrapTunnels";

export interface ReorgShiftConfig {
  mutations: number; // how many accepted swaps to apply
  maxTriesPerMutation: number; // retries to find a valid candidate
  softlockMaxSteps: number; // for dead-end escape check
}

export interface ReorgShiftResult {
  ok: boolean;
  mutatedTiles: GridPos[];
}

type SwapCandidate = { ax: number; ay: number; bx: number; by: number };

function isMutableWalkable(tile: TileType): boolean {
  // Keep start markers stable; everything else walkable may move.
  return isWalkable(tile) && tile !== "playerStart" && tile !== "ghostStart";
}

function hasProtected(mask: boolean[][], x: number, y: number): boolean {
  return Boolean(mask[y]?.[x]);
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function collectAdjacentSwapCandidates(level: ParsedLevel, protectedMask: boolean[][], used: Set<string>): SwapCandidate[] {
  const candidates: SwapCandidate[] = [];
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const key = tileKey(x, y);
      if (used.has(key)) continue;
      if (hasProtected(protectedMask, x, y)) continue;

      // Only consider each pair once (right + down).
      for (const d of [
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 }
      ] as const) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
        const nkey = tileKey(nx, ny);
        if (used.has(nkey)) continue;
        if (hasProtected(protectedMask, nx, ny)) continue;

        const a = level.tileMatrix[y]![x]!;
        const b = level.tileMatrix[ny]![nx]!;
        const aWall = a === "wall";
        const bWall = b === "wall";
        if (aWall === bWall) continue;

        const aWalk = isMutableWalkable(a);
        const bWalk = isMutableWalkable(b);
        if (!aWalk && !bWalk) continue;

        candidates.push({ ax: x, ay: y, bx: nx, by: ny });
      }
    }
  }
  return candidates;
}

function swapTiles(level: ParsedLevel, a: GridPos, b: GridPos): void {
  const tA = level.tileMatrix[a.y]![a.x]!;
  const tB = level.tileMatrix[b.y]![b.x]!;
  level.tileMatrix[a.y]![a.x] = tB;
  level.tileMatrix[b.y]![b.x] = tA;
}

function reachableFromStart(level: ParsedLevel, start: GridPos): boolean[][] {
  const visited: boolean[][] = Array.from({ length: level.height }, () => Array.from({ length: level.width }, () => false));
  const queue: GridPos[] = [];

  if (
    start.x < 0 ||
    start.y < 0 ||
    start.x >= level.width ||
    start.y >= level.height ||
    !isWalkable(level.tileMatrix[start.y]![start.x]!)
  ) {
    return visited;
  }

  visited[start.y]![start.x] = true;
  queue.push({ x: start.x, y: start.y });

  const dirs = [Direction.Right, Direction.Left, Direction.Down, Direction.Up] as const;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of dirs) {
      const next = nextTileWithWrap(level, cur.x, cur.y, d);
      if (!next) continue;
      if (visited[next.y]![next.x]) continue;
      visited[next.y]![next.x] = true;
      queue.push({ x: next.x, y: next.y });
    }
  }

  return visited;
}

function neighborCount(level: ParsedLevel, x: number, y: number): number {
  let count = 0;
  for (const d of [Direction.Up, Direction.Down, Direction.Left, Direction.Right] as const) {
    if (nextTileWithWrap(level, x, y, d)) count += 1;
  }
  return count;
}

function hasNearbyBranch(level: ParsedLevel, start: GridPos, maxSteps: number): boolean {
  const visited: boolean[][] = Array.from({ length: level.height }, () => Array.from({ length: level.width }, () => false));
  const queue: Array<{ x: number; y: number; steps: number }> = [{ x: start.x, y: start.y, steps: 0 }];
  visited[start.y]![start.x] = true;

  const dirs = [Direction.Right, Direction.Left, Direction.Down, Direction.Up] as const;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.steps > 0) {
      const deg = neighborCount(level, cur.x, cur.y);
      if (deg >= 3) return true;
    }
    if (cur.steps >= maxSteps) continue;
    for (const d of dirs) {
      const next = nextTileWithWrap(level, cur.x, cur.y, d);
      if (!next) continue;
      if (visited[next.y]![next.x]) continue;
      visited[next.y]![next.x] = true;
      queue.push({ x: next.x, y: next.y, steps: cur.steps + 1 });
    }
  }
  return false;
}

function passesChecks(level: ParsedLevel, starts: GridPos[], critical: GridPos[], softlockMaxSteps: number): boolean {
  if (starts.length === 0) return false;
  const visited = reachableFromStart(level, starts[0]!);

  // Ensure remaining pellets/powers stay reachable (avoid unwinnable shifts).
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const t = level.tileMatrix[y]![x]!;
      if (t !== "pellet" && t !== "power") continue;
      if (!visited[y]![x]) return false;
    }
  }

  // All player tiles (incl. coop) must remain connected to the primary.
  for (const s of starts) {
    if (s.x < 0 || s.y < 0 || s.x >= level.width || s.y >= level.height) return false;
    if (!isWalkable(level.tileMatrix[s.y]![s.x]!)) return false;
    if (!visited[s.y]![s.x]) return false;
  }

  for (const pos of critical) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= level.width || pos.y >= level.height) continue;
    if (!isWalkable(level.tileMatrix[pos.y]![pos.x]!)) return false;
    if (!visited[pos.y]![pos.x]) return false;
  }

  // No-softlock: each start tile should not be a deep dead-end.
  for (const s of starts) {
    if (s.x < 0 || s.y < 0 || s.x >= level.width || s.y >= level.height) continue;
    if (!isWalkable(level.tileMatrix[s.y]![s.x]!)) return false;
    const deg = neighborCount(level, s.x, s.y);
    if (deg === 0) return false;
    if (deg >= 2) continue;
    if (!hasNearbyBranch(level, s, softlockMaxSteps)) return false;
  }

  return true;
}

export function applyReorgShift(
  level: ParsedLevel,
  rng: Rng,
  cfg: ReorgShiftConfig,
  protectedMask: boolean[][],
  starts: GridPos[],
  critical: GridPos[]
): ReorgShiftResult {
  const used = new Set<string>();
  const accepted: Array<{ a: GridPos; b: GridPos }> = [];
  const mutatedKeys = new Set<string>();

  for (let i = 0; i < cfg.mutations; i++) {
    let applied = false;
    for (let attempt = 0; attempt < cfg.maxTriesPerMutation; attempt++) {
      const candidates = collectAdjacentSwapCandidates(level, protectedMask, used);
      if (candidates.length === 0) break;
      const pick = candidates[rng.nextInt(0, candidates.length)]!;

      const a: GridPos = { x: pick.ax, y: pick.ay };
      const b: GridPos = { x: pick.bx, y: pick.by };
      const tA = level.tileMatrix[a.y]![a.x]!;
      const tB = level.tileMatrix[b.y]![b.x]!;

      // Enforce wall <-> walkable swap.
      const okPair =
        (tA === "wall" && isMutableWalkable(tB)) ||
        (tB === "wall" && isMutableWalkable(tA));
      if (!okPair) continue;

      swapTiles(level, a, b);
      if (passesChecks(level, starts, critical, cfg.softlockMaxSteps)) {
        accepted.push({ a, b });
        used.add(tileKey(a.x, a.y));
        used.add(tileKey(b.x, b.y));
        mutatedKeys.add(tileKey(a.x, a.y));
        mutatedKeys.add(tileKey(b.x, b.y));
        applied = true;
        break;
      }
      swapTiles(level, a, b);
    }
    if (!applied) {
      // Revert full shift to keep maze stable.
      for (let j = accepted.length - 1; j >= 0; j--) {
        const { a, b } = accepted[j]!;
        swapTiles(level, a, b);
      }
      return { ok: false, mutatedTiles: [] };
    }
  }

  const mutatedTiles: GridPos[] = [];
  for (const k of mutatedKeys) {
    const [xStr, yStr] = k.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    if (Number.isFinite(x) && Number.isFinite(y)) mutatedTiles.push({ x, y });
  }

  return { ok: true, mutatedTiles };
}
