export type LevelLegendChar = "#" | "." | "o" | "P" | "G" | " " | "A" | "B" | "5";

export type TileType = "wall" | "pellet" | "power" | "playerStart" | "ghostStart" | "empty";

export interface LevelJson {
  id?: string;
  grid: string[];
}

export interface GridPos {
  x: number;
  y: number;
}

export interface ParsedLevel {
  id?: string;
  width: number;
  height: number;
  rawGrid: string[];
  tileMatrix: TileType[][];
  startPos: GridPos | null;
  playerStartCount: number;
  playerStarts: GridPos[];
  ghostStarts: GridPos[];
  pelletCount: number;
  powerCount: number;
  pelletPositions: GridPos[];
  bombPickupPositions: GridPos[];
  boxPositions: GridPos[];
  fruitSpawnPositions: GridPos[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export const LEVEL_LEGEND: Readonly<Record<LevelLegendChar, TileType>> = {
  "#": "wall",
  ".": "pellet",
  o: "power",
  P: "playerStart",
  G: "ghostStart",
  " ": "empty",
  // Special markers (handled by gameplay systems).
  A: "empty",
  B: "empty",
  "5": "empty"
} as const;

export function isWalkable(tile: TileType): boolean {
  return tile !== "wall";
}
