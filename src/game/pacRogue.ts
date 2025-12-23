import type { Difficulty } from "./settings";
import type { LevelJson } from "./levelTypes";

type Direction = "north" | "south" | "east" | "west";
type Shape =
  | "plus"
  | "triNorth"
  | "triSouth"
  | "triEast"
  | "triWest"
  | "cornerNE"
  | "cornerSE"
  | "cornerNW"
  | "cornerSW"
  | "lineV"
  | "lineH"
  | "empty";

export interface PacRogueParams {
  seed: string;
  difficulty: Difficulty;
  width?: number;
  height?: number;
}

const TILE_GROUP_DIM = 3;

// Codes from the Pac-Rogue generator: 1 = occupied (wall), 0 = walkable (pellet/empty).
// Order is: [0]=C, [1]=NW, [2]=N, [3]=NE, [4]=W, [5]=E, [6]=SW, [7]=S, [8]=SE
const INCORRECT_BIG_C = "111110111";
const INCORRECT_SMALL_C = "101100011";
const INCORRECT_TL = "111100011";
const INCORRECT_CRANE = "101100111";

const INCORRECT_BIG_C_REVERSE = "111101111";
const INCORRECT_SMALL_C_REVERSE = "111000110";
const INCORRECT_TL_REVERSE = "111100110";
const INCORRECT_CRANE_REVERSE = "111000111";

const INCORRECT_U = "110111111";
const INCORRECT_U_UPSIDEDOWN = "111111101";

const INCORRECT_OCCUPIED = "101000010";

const ALL_SHAPES: readonly Shape[] = [
  "plus",
  "triNorth",
  "triSouth",
  "triEast",
  "triWest",
  "cornerNE",
  "cornerSE",
  "cornerNW",
  "cornerSW",
  "lineV",
  "lineH",
  "empty"
] as const;

const CONNECTIONS: Record<Direction, ReadonlySet<Shape>> = {
  north: new Set<Shape>(["plus", "triNorth", "triEast", "triWest", "cornerNE", "cornerNW", "lineV"]),
  south: new Set<Shape>(["plus", "triSouth", "triEast", "triWest", "cornerSE", "cornerSW", "lineV"]),
  east: new Set<Shape>(["plus", "triNorth", "triSouth", "triEast", "cornerNE", "cornerSE", "lineH"]),
  west: new Set<Shape>(["plus", "triNorth", "triSouth", "triWest", "cornerNW", "cornerSW", "lineH"])
};

export function generatePacRogueLevel(params: PacRogueParams): LevelJson {
  // Pac-Rogue defaults: even-ish width and odd height (ghost box layout preference).
  const width = clampInt(params.width ?? 22, 15, 41);
  const height = clampInt(params.height ?? 31, 15, 45);

  const rng = seededRng(`${params.difficulty}|${params.seed}`.trim().toLowerCase());

  // Coordinate system: origin bottom-left (x right, y up). Grid rows in output are top->bottom.
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => "#"));
  const ghostSpace = new Set<string>();

  const get = (x: number, y: number): string | undefined => {
    if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
    return grid[height - 1 - y]![x]!;
  };
  const set = (x: number, y: number, v: string): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    grid[height - 1 - y]![x] = v;
  };
  const keyOf = (x: number, y: number) => `${x},${y}`;
  const isGhostSpace = (x: number, y: number) => ghostSpace.has(keyOf(x, y));
  const isWall = (x: number, y: number) => get(x, y) === "#";
  const isOpen = (x: number, y: number) => {
    const c = get(x, y);
    return c !== undefined && c !== "#";
  };
  const setPellet = (x: number, y: number) => {
    const c = get(x, y);
    if (c === undefined) return;
    if (c === "#") set(x, y, ".");
  };

  // 1) Generate left-side tile-groups with constraint propagation.
  const groupWidth = Math.max(1, Math.floor((width / TILE_GROUP_DIM) * 0.5));
  const groupHeight = Math.max(1, Math.floor(height / TILE_GROUP_DIM));
  const pickShape = (available: Shape[]): Shape => pickWeightedShape(params.difficulty, available, rng);
  const groupDefs = generateTileGroups(groupWidth, groupHeight, rng, pickShape);

  // 2) Expand group shapes into pellet/wall tiles on the left, then mirror to the right.
  for (let gx = 0; gx < groupWidth; gx++) {
    for (let gy = 0; gy < groupHeight; gy++) {
      const def = shapeDefinition(groupDefs[gx]![gy]!);
      for (let lx = 0; lx < TILE_GROUP_DIM; lx++) {
        for (let ly = 0; ly < TILE_GROUP_DIM; ly++) {
          const x = lx + gx * TILE_GROUP_DIM;
          const y = ly + gy * TILE_GROUP_DIM;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          set(x, y, def[lx]![ly]! ? "." : "#");
        }
      }
    }
  }

  mirrorLeftToRight(width, height, get, set);
  enforceBorderWalls(width, height, set);

  // 3) Carve the ghost box (walkable interior, no pellets) and mark ghost-space tiles.
  const ghostBox = carveGhostBox(width, height, set, ghostSpace);

  // 4) Add pellets to fix some typical gaps/patterns; open a small set of problematic wall patterns.
  addMissingPellets(width, height, get, setPellet);
  removeIncorrectTiles(width, height, get, set, isGhostSpace);

  // 5) Ensure everything is connected by carving straight pellet tunnels between components (mirrored).
  let guard = 0;
  while (guard++ < 80) {
    const result = checkForConnectedPath(
      width,
      height,
      get,
      (x, y) => setPellet(x, y),
      (x, y) => mirrorAndPellet(width, get, setPellet, x, y)
    );
    removeIncorrectTiles(width, height, get, set, isGhostSpace);
    if (result.connected) break;
  }
  removeIncorrectTiles(width, height, get, set, isGhostSpace);

  // 6) Place power pellets based on reachable pellets (mirrored).
  placePowerPellets(width, height, get, set, ghostBox);

  // 7) Ensure pellets exist on all non-ghost-box walkable tiles (except spawns).
  fillPelletsOutsideGhostBox(width, height, get, set, ghostBox);

  // 8) Place spawns last (remove pellets at spawn locations).
  placeSpawns(width, height, get, set, params.difficulty, ghostBox);

  // Ensure our game's validation constraint (border must be walls).
  enforceBorderWalls(width, height, set);

  return { id: buildId("ai-rogue", params.difficulty, params.seed), grid: grid.map((row) => row.join("")) };
}

function generateTileGroups(groupWidth: number, groupHeight: number, rng: () => number, pickShape: (available: Shape[]) => Shape): Shape[][] {
  const options: Shape[][][] = Array.from({ length: groupWidth }, () =>
    Array.from({ length: groupHeight }, () => ALL_SHAPES.slice())
  );

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < groupWidth && y < groupHeight;
  const opposite = (d: Direction): Direction => (d === "north" ? "south" : d === "south" ? "north" : d === "east" ? "west" : "east");

  const removeAll = (target: Shape[], toRemove: ReadonlySet<Shape>) => target.filter((s) => !toRemove.has(s));

  const updateNeighbors = (x: number, y: number) => {
    const queue: Array<{ x: number; y: number }> = [{ x, y }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentOpts = options[current.x]![current.y]!;
      const neighbors: Array<{ dir: Direction; nx: number; ny: number }> = [
        { dir: "north", nx: current.x, ny: current.y + 1 },
        { dir: "south", nx: current.x, ny: current.y - 1 },
        { dir: "east", nx: current.x + 1, ny: current.y },
        { dir: "west", nx: current.x - 1, ny: current.y }
      ];

      for (const n of neighbors) {
        if (!inBounds(n.nx, n.ny)) continue;
        const nextOpts = options[n.nx]![n.ny]!;
        if (nextOpts.length <= 1) continue;

        const prevLen = nextOpts.length;
        const intersectionRemove = intersectRemovals(currentOpts, opposite(n.dir));
        if (intersectionRemove.size === 0) continue;
        const reduced = removeAll(nextOpts, intersectionRemove);
        if (reduced.length === 0 || reduced.length === prevLen) continue;
        options[n.nx]![n.ny] = reduced;
        queue.push({ x: n.nx, y: n.ny });
      }
    }
  };

  // Border constraints (Pac-Rogue uses y=0 as bottom; we do the same in group-space).
  for (let x = 0; x < groupWidth; x++) {
    for (let y = 0; y < groupHeight; y++) {
      let changed = false;
      if (x === 0) {
        const before = options[x]![y]!;
        const after = removeAll(before, CONNECTIONS.west);
        if (after.length > 0 && after.length !== before.length) {
          options[x]![y] = after;
          changed = true;
        }
      }
      if (y === 0) {
        const before = options[x]![y]!;
        const after = removeAll(before, CONNECTIONS.south);
        if (after.length > 0 && after.length !== before.length) {
          options[x]![y] = after;
          changed = true;
        }
      }
      if (y === groupHeight - 1) {
        const before = options[x]![y]!;
        const after = removeAll(before, CONNECTIONS.north);
        if (after.length > 0 && after.length !== before.length) {
          options[x]![y] = after;
          changed = true;
        }
      }
      if (changed) updateNeighbors(x, y);
    }
  }

  const remaining: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < groupWidth; x++) for (let y = 0; y < groupHeight; y++) remaining.push({ x, y });

  while (remaining.length > 0) {
    const idx = Math.floor(rng() * remaining.length);
    const { x, y } = remaining.splice(idx, 1)[0]!;
    const cur = options[x]![y]!;
    if (cur.length > 1) {
      const pick = pickShape(cur);
      options[x]![y] = [pick];
      updateNeighbors(x, y);
    }
  }

  return options.map((col) => col.map((cell) => cell[0] ?? "empty"));
}

function intersectRemovals(currentOptions: Shape[], requiredNeighborDir: Direction): ReadonlySet<Shape> {
  // For each possible shape in currentOptions, compute which shapes would be invalid in the neighbor.
  // Intersect those invalid sets (remove shapes invalid for all current possibilities).
  const invalidCounts = new Map<Shape, number>();
  for (const s of currentOptions) {
    const invalid = invalidNeighborShapes(s, requiredNeighborDir);
    for (const x of invalid) invalidCounts.set(x, (invalidCounts.get(x) ?? 0) + 1);
  }
  const mustRemove = new Set<Shape>();
  for (const [shape, count] of invalidCounts) {
    if (count === currentOptions.length) mustRemove.add(shape);
  }
  return mustRemove;
}

function invalidNeighborShapes(current: Shape, neighborDir: Direction): ReadonlySet<Shape> {
  // If current connects toward the neighbor, the neighbor must connect back; otherwise it must NOT connect back.
  const needsBackConnection = CONNECTIONS[neighborDir].has(current);
  const opposite = neighborDir === "north" ? "south" : neighborDir === "south" ? "north" : neighborDir === "east" ? "west" : "east";
  return needsBackConnection ? nonConnections(opposite) : CONNECTIONS[opposite];
}

function nonConnections(dir: Direction): ReadonlySet<Shape> {
  const all = new Set<Shape>(ALL_SHAPES);
  for (const s of CONNECTIONS[dir]) all.delete(s);
  return all;
}

function shapeDefinition(shape: Shape): boolean[][] {
  // 3x3, indexed as [x][y], y grows upward.
  // These definitions mirror the Pac-Rogue generator's 3x3 pellet layout per TileGroupShape.
  const def = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => false));
  const col = (x: number, v0: boolean, v1: boolean, v2: boolean) => {
    def[x]![0] = v0;
    def[x]![1] = v1;
    def[x]![2] = v2;
  };

  switch (shape) {
    case "plus":
      col(0, false, true, false);
      col(1, true, true, true);
      col(2, false, true, false);
      break;
    case "triNorth":
      col(0, false, true, false);
      col(1, false, true, true);
      col(2, false, true, false);
      break;
    case "triSouth":
      col(0, false, true, false);
      col(1, true, true, false);
      col(2, false, true, false);
      break;
    case "triEast":
      col(0, false, false, false);
      col(1, true, true, true);
      col(2, false, true, false);
      break;
    case "triWest":
      col(0, false, true, false);
      col(1, true, true, true);
      col(2, false, false, false);
      break;
    case "cornerNE":
      col(0, false, false, false);
      col(1, false, true, true);
      col(2, false, true, false);
      break;
    case "cornerSE":
      col(0, false, false, false);
      col(1, true, true, false);
      col(2, false, true, false);
      break;
    case "cornerNW":
      col(0, false, true, false);
      col(1, false, true, true);
      col(2, false, false, false);
      break;
    case "cornerSW":
      col(0, false, true, false);
      col(1, true, true, false);
      col(2, false, false, false);
      break;
    case "lineV":
      col(0, false, false, false);
      col(1, true, true, true);
      col(2, false, false, false);
      break;
    case "lineH":
      col(0, false, true, false);
      col(1, false, true, false);
      col(2, false, true, false);
      break;
    case "empty":
      col(0, false, false, false);
      col(1, false, false, false);
      col(2, false, false, false);
      break;
  }

  return def;
}

function mirrorLeftToRight(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  set: (x: number, y: number, v: string) => void
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = width - 1 - x;
      if (mx < x) continue;
      const v = get(x, y);
      if (v === undefined) continue;
      set(mx, y, v);
    }
  }
}

function enforceBorderWalls(width: number, height: number, set: (x: number, y: number, v: string) => void): void {
  for (let x = 0; x < width; x++) {
    set(x, 0, "#");
    set(x, height - 1, "#");
  }
  for (let y = 0; y < height; y++) {
    set(0, y, "#");
    set(width - 1, y, "#");
  }
}

function carveGhostBox(
  width: number,
  height: number,
  set: (x: number, y: number, v: string) => void,
  ghostSpace: Set<string>
): { x0: number; y0: number; x1: number; y1: number } {
  const boxWidth = clampInt(14, 7, Math.max(7, width - 2));
  const boxHeight = clampInt(11, 7, Math.max(7, height - 2));

  const halfHeight = Math.floor((height - 1) / 2);
  const halfWidth = Math.floor(width / 2);
  const ghostBoxHalfHeight = Math.floor((boxHeight - 1) / 2);
  const ghostBoxHalfWidth = Math.floor(boxWidth / 2);
  const startX = halfWidth - ghostBoxHalfWidth;
  const startY = halfHeight - ghostBoxHalfHeight + 1;

  const x0 = clampInt(startX, 1, width - 2);
  const y0 = clampInt(startY, 1, height - 2);
  const x1 = clampInt(startX + boxWidth - 1, 1, width - 2);
  const y1 = clampInt(startY + boxHeight - 1, 1, height - 2);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const onBorder = x === x0 || x === x1 || y === y0 || y === y1;
      set(x, y, onBorder ? "#" : " ");
      if (!onBorder) ghostSpace.add(`${x},${y}`);
    }
  }

  // Door opening (top edge), plus a short corridor above it.
  const doorX = Math.floor((x0 + x1) / 2);
  set(doorX, y1, " ");
  set(doorX, y1 + 1, ".");
  set(doorX, y1 + 2, ".");

  return { x0, y0, x1, y1 };
}

function determineTileCode(width: number, height: number, isWall: (x: number, y: number) => boolean, x: number, y: number): string {
  const coords = [
    { x, y }, // C
    { x: x - 1, y: y + 1 }, // NW
    { x, y: y + 1 }, // N
    { x: x + 1, y: y + 1 }, // NE
    { x: x - 1, y }, // W
    { x: x + 1, y }, // E
    { x: x - 1, y: y - 1 }, // SW
    { x, y: y - 1 }, // S
    { x: x + 1, y: y - 1 } // SE
  ];

  let code = "";
  for (const c of coords) {
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) {
      code += "1";
      continue;
    }
    code += isWall(c.x, c.y) ? "1" : "0";
  }
  return code;
}

function addMissingPellets(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  setPellet: (x: number, y: number) => void
): void {
  const isWall = (x: number, y: number) => get(x, y) === "#";

  const addPelletsToWidth = () => {
    let reUpdate = false;
    do {
      reUpdate = false;
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (!isWall(x, y)) continue;
          const code = determineTileCode(width, height, isWall, x, y);
          switch (code) {
            case INCORRECT_BIG_C:
              setPellet(x, y);
              setPellet(x - 1, y);
              reUpdate = true;
              break;
            case INCORRECT_SMALL_C:
            case INCORRECT_TL:
            case INCORRECT_CRANE:
              setPellet(x, y);
              break;
            case INCORRECT_BIG_C_REVERSE:
              setPellet(x, y);
              setPellet(x + 1, y);
              break;
            case INCORRECT_SMALL_C_REVERSE:
            case INCORRECT_TL_REVERSE:
            case INCORRECT_CRANE_REVERSE:
              setPellet(x, y);
              break;
          }
        }
      }
    } while (reUpdate);
  };

  const addPelletsToHeight = () => {
    let reUpdate = false;
    do {
      reUpdate = false;
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (!isWall(x, y)) continue;
          const code = determineTileCode(width, height, isWall, x, y);
          if (code === INCORRECT_U) {
            setPellet(x, y);
            let cy = y;
            while (true) {
              const south = { x, y: cy - 1 };
              const east = { x: x + 1, y: cy - 1 };
              const west = { x: x - 1, y: cy - 1 };
              if (south.y <= 0) break;
              const inside = get(south.x, south.y) !== undefined && get(east.x, east.y) !== undefined && get(west.x, west.y) !== undefined;
              if (!inside) break;
              const allOccupied = isWall(south.x, south.y) && isWall(east.x, east.y) && isWall(west.x, west.y);
              setPellet(south.x, south.y);
              if (!allOccupied) break;
              cy -= 1;
            }
            reUpdate = true;
          } else if (code === INCORRECT_U_UPSIDEDOWN) {
            setPellet(x, y);
            let cy = y;
            while (true) {
              const north = { x, y: cy + 1 };
              const east = { x: x + 1, y: cy + 1 };
              const west = { x: x - 1, y: cy + 1 };
              if (north.y >= height - 1) break;
              const inside = get(north.x, north.y) !== undefined && get(east.x, east.y) !== undefined && get(west.x, west.y) !== undefined;
              if (!inside) break;
              const allOccupied = isWall(north.x, north.y) && isWall(east.x, east.y) && isWall(west.x, west.y);
              setPellet(north.x, north.y);
              if (!allOccupied) break;
              cy += 1;
            }
            reUpdate = true;
          }
        }
      }
    } while (reUpdate);
  };

  addPelletsToWidth();
  addPelletsToHeight();
}

function removeIncorrectTiles(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  set: (x: number, y: number, v: string) => void,
  isGhostSpace: (x: number, y: number) => boolean
): void {
  const isWall = (x: number, y: number) => get(x, y) === "#";
  const toOpen = new Set<string>();
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    toOpen.add(`${x},${y}`);
  };

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (!isWall(x, y)) continue;
      const code = determineTileCode(width, height, isWall, x, y);
      if (code !== INCORRECT_OCCUPIED) continue;
      add(x, y);
      add(x, y + 1);
      add(x, y - 1);
    }
  }

  for (const k of toOpen) {
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const ghostTile = isGhostSpace(x + 1, y) || isGhostSpace(x - 1, y);
    if (ghostTile) continue;
    if (get(x, y) === "#") set(x, y, ".");
  }
}

function checkForConnectedPath(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  setPellet: (x: number, y: number) => void,
  setPelletMirrored: (x: number, y: number) => void
): { connected: boolean; changed: boolean } {
  const isWall = (x: number, y: number) => get(x, y) === "#";
  const visited = new Set<string>();

  const findComponent = (sx: number, sy: number): Set<string> => {
    const comp = new Set<string>();
    const q: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
    const k0 = `${sx},${sy}`;
    comp.add(k0);
    visited.add(k0);
    while (q.length > 0) {
      const { x, y } = q.shift()!;
      const neigh = [
        { x, y: y + 1 },
        { x, y: y - 1 },
        { x: x + 1, y },
        { x: x - 1, y }
      ];
      for (const n of neigh) {
        if (n.x <= 0 || n.y <= 0 || n.x >= width - 1 || n.y >= height - 1) continue;
        if (isWall(n.x, n.y)) continue;
        const kk = `${n.x},${n.y}`;
        if (visited.has(kk)) continue;
        visited.add(kk);
        comp.add(kk);
        q.push(n);
      }
    }
    return comp;
  };

  let connected: Set<string> | null = null;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const kk = `${x},${y}`;
      if (visited.has(kk)) continue;
      if (isWall(x, y)) continue;

      if (!connected) {
        connected = findComponent(x, y);
      } else {
        const disconnected = findComponent(x, y);
        const changed = placePelletsForDisconnectedPath(width, height, get, setPellet, setPelletMirrored, connected, disconnected);
        return { connected: false, changed };
      }
    }
  }

  return { connected: true, changed: false };
}

function placePelletsForDisconnectedPath(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  setPellet: (x: number, y: number) => void,
  setPelletMirrored: (x: number, y: number) => void,
  connected: Set<string>,
  disconnected: Set<string>
): boolean {
  const isWall = (x: number, y: number) => get(x, y) === "#";
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  let changed = false;

  const eligible: Array<{ x: number; y: number }> = [];
  for (const k of connected) {
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const halfGrid = x < width * 0.5 - 1;
    const centerPellet = x % TILE_GROUP_DIM === 1 && y % TILE_GROUP_DIM === 1;
    if (!halfGrid || !centerPellet) continue;
    const edge = isWall(x - 1, y) || isWall(x + 1, y) || isWall(x, y - 1) || isWall(x, y + 1);
    if (edge) eligible.push({ x, y });
  }

  const validate = (x: number, y: number, dir: Direction): { ok: boolean; length: number; endKey: string } => {
    const v = dirVec(dir);
    let length = 0;
    let nx = x + v.x;
    let ny = y + v.y;
    while (inBounds(nx, ny)) {
      if (isWall(nx, ny)) {
        length += 1;
      } else {
        return { ok: true, length, endKey: `${nx},${ny}` };
      }
      nx += v.x;
      ny += v.y;
    }
    return { ok: false, length: 0, endKey: "" };
  };

  for (const start of eligible) {
    const candidates: Array<{ dir: Direction; length: number }> = [];
    for (const dir of ["north", "south", "east", "west"] as const) {
      const r = validate(start.x, start.y, dir);
      if (!r.ok || r.length <= 0) continue;
      if (!disconnected.has(r.endKey)) continue;
      candidates.push({ dir, length: r.length });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.length - b.length);
    const best = candidates[0]!;
    const v = dirVec(best.dir);
    for (let i = 1; i <= best.length; i++) {
      const x = start.x + v.x * i;
      const y = start.y + v.y * i;
      if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
      if (get(x, y) === "#") {
        setPellet(x, y);
        changed = true;
      }
      const mx = width - 1 - x;
      if (mx <= 0 || mx >= width - 1) continue;
      if (get(mx, y) === "#") {
        setPelletMirrored(x, y);
        changed = true;
      }
    }
  }

  if (changed) return true;
  return fallbackConnectComponents(width, height, get, setPellet, setPelletMirrored, connected, disconnected);
}

function mirrorAndPellet(width: number, get: (x: number, y: number) => string | undefined, setPellet: (x: number, y: number) => void, x: number, y: number) {
  const mx = width - 1 - x;
  if (get(mx, y) === "#") setPellet(mx, y);
}

function fallbackConnectComponents(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  setPellet: (x: number, y: number) => void,
  setPelletMirrored: (x: number, y: number) => void,
  connected: Set<string>,
  disconnected: Set<string>
): boolean {
  const parse = (k: string) => {
    const [xs, ys] = k.split(",");
    return { x: Number(xs), y: Number(ys) };
  };

  const connectedList = Array.from(connected).slice(0, 250).map(parse);
  const disconnectedList = Array.from(disconnected).slice(0, 250).map(parse);
  if (connectedList.length === 0 || disconnectedList.length === 0) return false;

  let bestA = connectedList[0]!;
  let bestB = disconnectedList[0]!;
  let bestD = Number.POSITIVE_INFINITY;

  for (const a of connectedList) {
    for (const b of disconnectedList) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d < bestD) {
        bestD = d;
        bestA = a;
        bestB = b;
      }
    }
  }

  const carve = (x: number, y: number): boolean => {
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return false;
    if (get(x, y) === "#") {
      setPellet(x, y);
      setPelletMirrored(x, y);
      return true;
    }
    return false;
  };

  let changed = false;
  let x = bestA.x;
  let y = bestA.y;
  const stepX = bestB.x >= x ? 1 : -1;
  while (x !== bestB.x) {
    x += stepX;
    changed = carve(x, y) || changed;
  }
  const stepY = bestB.y >= y ? 1 : -1;
  while (y !== bestB.y) {
    y += stepY;
    changed = carve(x, y) || changed;
  }
  return changed;
}

function dirVec(dir: Direction): { x: number; y: number } {
  switch (dir) {
    case "north":
      return { x: 0, y: 1 };
    case "south":
      return { x: 0, y: -1 };
    case "east":
      return { x: 1, y: 0 };
    case "west":
      return { x: -1, y: 0 };
  }
}

function placePowerPellets(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  set: (x: number, y: number, v: string) => void,
  ghostBox: { x0: number; y0: number; x1: number; y1: number }
): void {
  const isInGhostBox = (x: number, y: number) => x >= ghostBox.x0 && x <= ghostBox.x1 && y >= ghostBox.y0 && y <= ghostBox.y1;

  const placeMirrored = (x: number, y: number) => {
    const mx = width - 1 - x;
    if (get(x, y) === ".") set(x, y, "o");
    if (get(mx, y) === ".") set(mx, y, "o");
  };

  // Bottom power pellets (search upward a bit).
  for (let y = 2; y < Math.min(height - 2, 8); y++) {
    for (let x = 1; x < Math.floor(width / 2); x++) {
      if (isInGhostBox(x, y)) continue;
      if (get(x, y) === ".") {
        placeMirrored(x, y);
        y = height;
        break;
      }
    }
  }

  // Top power pellets (search downward a bit).
  for (let y = height - 3; y > Math.max(1, height - 9); y--) {
    for (let x = 1; x < Math.floor(width / 2); x++) {
      if (isInGhostBox(x, y)) continue;
      if (get(x, y) === ".") {
        placeMirrored(x, y);
        y = 0;
        break;
      }
    }
  }
}

function fillPelletsOutsideGhostBox(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  set: (x: number, y: number, v: string) => void,
  ghostBox: { x0: number; y0: number; x1: number; y1: number }
): void {
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (x >= ghostBox.x0 && x <= ghostBox.x1 && y >= ghostBox.y0 && y <= ghostBox.y1) continue;
      const c = get(x, y);
      if (c === " " || c === ".") set(x, y, ".");
    }
  }
}

function placeSpawns(
  width: number,
  height: number,
  get: (x: number, y: number) => string | undefined,
  set: (x: number, y: number, v: string) => void,
  difficulty: Difficulty,
  ghostBox: { x0: number; y0: number; x1: number; y1: number }
): void {
  // Player: bottom-ish center, first walkable tile in the center column.
  const cx = Math.floor(width / 2);
  let px = cx;
  let py = 1;
  for (let y = 1; y < Math.max(2, ghostBox.y0); y++) {
    const c = get(cx, y);
    if (c && c !== "#") {
      py = y;
      break;
    }
  }
  if (get(px, py) === "#") {
    // Find any walkable near bottom center.
    outer: for (let y = 1; y < Math.min(height - 2, 8); y++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = cx + dx;
        if (x <= 0 || x >= width - 1) continue;
        if (get(x, y) !== "#") {
          px = x;
          py = y;
          break outer;
        }
      }
    }
  }
  if (get(px, py) === "#") {
    // Fallback: find any open tile outside the ghost box.
    outer2: for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const inGhost = x >= ghostBox.x0 && x <= ghostBox.x1 && y >= ghostBox.y0 && y <= ghostBox.y1;
        if (inGhost) continue;
        if (get(x, y) !== "#") {
          px = x;
          py = y;
          break outer2;
        }
      }
    }
  }
  set(px, py, "P");

  // Ghosts: inside the ghost box.
  const gx = Math.floor((ghostBox.x0 + ghostBox.x1) / 2);
  const gy = Math.floor((ghostBox.y0 + ghostBox.y1) / 2);
  const slots = [
    { x: gx - 1, y: gy },
    { x: gx, y: gy },
    { x: gx + 1, y: gy },
    { x: gx, y: gy - 1 }
  ];
  const wanted = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
  let placed = 0;
  for (const p of slots) {
    if (placed >= wanted) break;
    if (get(p.x, p.y) === "#") continue;
    set(p.x, p.y, "G");
    placed += 1;
  }
  if (placed === 0) {
    // Ensure at least one ghost start exists.
    if (get(gx, gy) !== "#") set(gx, gy, "G");
  }
}

function pickWeightedShape(difficulty: Difficulty, available: Shape[], rng: () => number): Shape {
  const base = (shape: Shape): number => {
    switch (shape) {
      case "empty":
        return 0.25;
      case "plus":
        return 1.35;
      case "lineV":
      case "lineH":
        return 1.15;
      default:
        return 1;
    }
  };

  const emptyFactor = difficulty === "easy" ? 0.25 : difficulty === "hard" ? 1.3 : 0.7;

  let total = 0;
  const weights = available.map((s) => {
    let w = base(s);
    if (s === "empty") w *= emptyFactor;
    total += w;
    return w;
  });

  if (total <= 0) return available[Math.floor(rng() * available.length)] ?? "empty";
  let r = rng() * total;
  for (let i = 0; i < available.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return available[i]!;
  }
  return available[available.length - 1] ?? "empty";
}

function buildId(prefix: string, difficulty: Difficulty, seed: string): string {
  const compact = seed
    .trim()
    .toLowerCase()
    .split(/[^\w]+/g)
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
  return `${prefix}-${difficulty}${compact ? `-${compact}` : ""}`;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, n));
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
