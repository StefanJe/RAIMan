import { LEVEL_LEGEND, type GridPos, type LevelJson, type LevelLegendChar, type ParsedLevel } from "./levelTypes";

export class LevelParseError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "LevelParseError";
    this.errors = errors;
  }
}

function isLegendChar(value: string): value is LevelLegendChar {
  return value.length === 1 && (value in LEVEL_LEGEND);
}

export function parseLevel(level: LevelJson): ParsedLevel {
  const errors: string[] = [];

  if (!level || typeof level !== "object") {
    throw new LevelParseError(["Level must be an object."]);
  }

  if (!Array.isArray(level.grid) || level.grid.length === 0) {
    throw new LevelParseError(["Level.grid must be a non-empty string array."]);
  }

  const rawGrid = level.grid.slice();
  const height = rawGrid.length;
  const width = rawGrid[0]?.length ?? 0;

  if (width === 0) errors.push("Level.grid rows must not be empty.");

  for (let y = 0; y < rawGrid.length; y++) {
    const row = rawGrid[y];
    if (typeof row !== "string") {
      errors.push(`Level.grid[${y}] must be a string.`);
      continue;
    }
    if (row.length !== width) {
      errors.push(`Level.grid[${y}] length ${row.length} does not match width ${width}.`);
    }
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] ?? "";
      if (!isLegendChar(ch)) {
        const printable = ch === "\t" ? "\\t" : ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch;
        errors.push(`Invalid char '${printable}' at (${x}, ${y}).`);
      }
    }
  }

  if (errors.length > 0) throw new LevelParseError(errors);

  const tileMatrix: ParsedLevel["tileMatrix"] = [];
  const ghostStarts: GridPos[] = [];
  const pelletPositions: GridPos[] = [];
  const bombPickupPositions: GridPos[] = [];
  const boxPositions: GridPos[] = [];
  const fruitSpawnPositions: GridPos[] = [];
  const playerStarts: GridPos[] = [];
  let startPos: GridPos | null = null;
  let playerStartCount = 0;
  let pelletCount = 0;
  let powerCount = 0;

  for (let y = 0; y < height; y++) {
    const row = rawGrid[y]!;
    const tileRow = new Array(width) as ParsedLevel["tileMatrix"][number];

    for (let x = 0; x < width; x++) {
      const ch = row[x]! as LevelLegendChar;
      const tile = LEVEL_LEGEND[ch];
      tileRow[x] = tile;

      if (ch === "P") {
        playerStartCount += 1;
        playerStarts.push({ x, y });
        if (!startPos) startPos = { x, y };
      } else if (ch === "G") {
        ghostStarts.push({ x, y });
      } else if (ch === ".") {
        pelletCount += 1;
        pelletPositions.push({ x, y });
      } else if (ch === "o") {
        powerCount += 1;
        pelletPositions.push({ x, y });
      } else if (ch === "A") {
        bombPickupPositions.push({ x, y });
      } else if (ch === "B") {
        boxPositions.push({ x, y });
      } else if (ch === "5") {
        fruitSpawnPositions.push({ x, y });
      }
    }

    tileMatrix.push(tileRow);
  }

  return {
    id: level.id,
    width,
    height,
    rawGrid,
    tileMatrix,
    startPos,
    playerStartCount,
    playerStarts,
    ghostStarts,
    pelletCount,
    powerCount,
    pelletPositions,
    bombPickupPositions,
    boxPositions,
    fruitSpawnPositions
  };
}
