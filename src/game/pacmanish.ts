import type { Difficulty } from "./settings";
import type { LevelJson } from "./levelTypes";

export interface PacmanishParams {
  seed: string;
  difficulty: Difficulty;
  width?: number;
  height?: number;
}

export function generatePacmanishLevel(params: PacmanishParams): LevelJson {
  const width = clampOdd(params.width ?? 19, 19);
  const height = clampOdd(params.height ?? 21, 21);

  const rng = seededRng(`${params.difficulty}|${params.seed}`.trim().toLowerCase());

  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => "#"));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) grid[y]![x] = ".";
  }

  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  const fillRect = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    const ax0 = Math.max(1, Math.min(width - 2, Math.min(x0, x1)));
    const ax1 = Math.max(1, Math.min(width - 2, Math.max(x0, x1)));
    const ay0 = Math.max(1, Math.min(height - 2, Math.min(y0, y1)));
    const ay1 = Math.max(1, Math.min(height - 2, Math.max(y0, y1)));
    for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) grid[y]![x] = ch;
  };

  const fillSymRect = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    fillRect(x0, y0, x1, y1, ch);
    const mx0 = width - 1 - x1;
    const mx1 = width - 1 - x0;
    fillRect(mx0, y0, mx1, y1, ch);
  };

  // Solid blocks (mirrored) to mimic classic Pac-Man maze "chunks".
  fillSymRect(2, 2, Math.min(4, midX - 1), 4, "#");
  fillSymRect(2, height - 5, Math.min(4, midX - 1), height - 3, "#");

  fillSymRect(2, 6, 2, 8, "#");
  fillSymRect(2, height - 9, 2, height - 7, "#");

  fillSymRect(Math.max(3, midX - 4), 2, Math.max(4, midX - 3), 4, "#");
  fillSymRect(Math.max(3, midX - 4), height - 5, Math.max(4, midX - 3), height - 3, "#");

  // Center top/bottom bars.
  fillRect(midX - 1, 2, midX + 1, 3, "#");
  fillRect(midX - 1, height - 4, midX + 1, height - 3, "#");

  // Ghost house (hollow with a single door).
  const houseW = 7;
  const houseH = 5;
  const hx0 = Math.max(2, midX - Math.floor(houseW / 2));
  const hx1 = Math.min(width - 3, hx0 + houseW - 1);
  const hy0 = Math.max(4, midY - Math.floor(houseH / 2));
  const hy1 = Math.min(height - 5, hy0 + houseH - 1);

  fillRect(hx0, hy0, hx1, hy1, "#");
  fillRect(hx0 + 1, hy0 + 1, hx1 - 1, hy1 - 1, " ");

  const doorX = Math.floor((hx0 + hx1) / 2);
  grid[hy0]![doorX] = ".";

  // Optional extra blocks: harder = tighter.
  const extraProb = params.difficulty === "hard" ? 0.8 : params.difficulty === "easy" ? 0.35 : 0.55;
  const extras: Array<() => void> = [
    () => fillSymRect(2, midY - 1, Math.min(4, midX - 2), midY + 1, "#"),
    () => fillSymRect(Math.max(3, midX - 5), midY - 4, Math.max(4, midX - 3), midY - 2, "#"),
    () => fillSymRect(Math.max(3, midX - 5), midY + 2, Math.max(4, midX - 3), midY + 4, "#"),
    () => fillRect(midX - 1, midY - 6, midX + 1, midY - 5, "#"),
    () => fillRect(midX - 1, midY + 5, midX + 1, midY + 6, "#")
  ];
  for (const apply of extras) {
    if (rng() < extraProb) apply();
  }

  // Player start near bottom center.
  const playerX = midX;
  const playerY = Math.min(height - 3, Math.max(2, height - 4));
  grid[playerY]![playerX] = "P";
  if (grid[playerY]![playerX - 1] === "#") grid[playerY]![playerX - 1] = ".";
  if (grid[playerY]![playerX + 1] === "#") grid[playerY]![playerX + 1] = ".";

  // Ghost starts inside the house (count varies with difficulty).
  const ghostSlots = [
    { x: doorX - 1, y: hy0 + 2 },
    { x: doorX, y: hy0 + 2 },
    { x: doorX + 1, y: hy0 + 2 },
    { x: doorX, y: hy0 + 3 }
  ];
  const ghostCount = params.difficulty === "easy" ? 1 : params.difficulty === "hard" ? 3 : 2;
  for (let i = 0; i < ghostSlots.length; i++) {
    const p = ghostSlots[i]!;
    if (i < ghostCount) grid[p.y]![p.x] = "G";
    else if (grid[p.y]![p.x] === " ") grid[p.y]![p.x] = ".";
  }

  // Power pellets in the four corners (if walkable).
  const corners = [
    { x: 1, y: 1 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
    { x: width - 2, y: height - 2 }
  ];
  for (const c of corners) {
    if (grid[c.y]![c.x] !== "#") grid[c.y]![c.x] = "o";
  }

  // Guarantee borders are walls (safety against any accidental overwrite).
  for (let x = 0; x < width; x++) {
    grid[0]![x] = "#";
    grid[height - 1]![x] = "#";
  }
  for (let y = 0; y < height; y++) {
    grid[y]![0] = "#";
    grid[y]![width - 1] = "#";
  }

  // Make sure all pellets are reachable from the player start to satisfy validation.
  makePelletsReachable(grid, { x: playerX, y: playerY });

  const compactSeed = params.seed
    .trim()
    .toLowerCase()
    .split(/[^\w]+/g)
    .filter(Boolean)
    .slice(0, 3)
    .join("-");

  return {
    id: `ai-pac-${params.difficulty}${compactSeed ? `-${compactSeed}` : ""}`,
    grid: grid.map((row) => row.join(""))
  };
}

function seededRng(seed: string): () => number {
  let x = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    x ^= seed.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
    x >>>= 0;
  }
  if (x === 0) x = 0x12345678;

  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0xffffffff;
  };
}

function clampOdd(value: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  const clamped = Math.max(9, Math.min(41, n));
  return clamped % 2 === 0 ? clamped - 1 : clamped;
}

function makePelletsReachable(grid: string[][], start: { x: number; y: number }): void {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (height === 0 || width === 0) return;

  const visited: boolean[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  const queue: Array<{ x: number; y: number }> = [start];
  visited[start.y]![start.x] = true;

  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ] as const;

  const isWalkable = (ch: string) => ch !== "#";

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const d of directions) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (visited[ny]![nx]) continue;
      if (!isWalkable(grid[ny]![nx]!)) continue;
      visited[ny]![nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }

  let pelletCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = grid[y]![x]!;
      if (ch === ".") {
        if (!visited[y]![x]) {
          grid[y]![x] = " ";
        } else {
          pelletCount += 1;
        }
      }
    }
  }

  if (pelletCount < 1) {
    const px = start.x + 1 < width - 1 ? start.x + 1 : start.x - 1;
    if (px > 0 && px < width - 1) grid[start.y]![px] = ".";
  }
}

