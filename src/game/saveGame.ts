import type { GameMode } from "./appConfig";
import type { Difficulty } from "./settings";
import type { LevelJson } from "./levelTypes";

export type SaveGameScope = "campaign" | "level";

export interface SavedGameV1 {
  v: 1;
  savedAtMs: number;
  runStartedAtMs?: number;
  scope: SaveGameScope;
  mode: GameMode;
  seed: string | null;
  difficulty: Difficulty;
  score: number;
  lives: number;
  campaignIndex: number | null;
  levelJson: LevelJson;
}

/**
 * Local checkpoint storage (no server).
 *
 * Approach A (current): resume restores the run state but restarts the *current level*.
 * This avoids having to serialize all dynamic objects (ghost states, bombs, pellets, etc.).
 */
const STORAGE_KEY = "raiman.savegame.v1";
const LEGACY_STORAGE_KEY = "coopman.savegame.v1";

function isDifficulty(v: unknown): v is Difficulty {
  return v === "easy" || v === "normal" || v === "hard";
}

function isMode(v: unknown): v is GameMode {
  return v === "classic" || v === "vibe";
}

function isLevelJson(v: unknown): v is LevelJson {
  if (!v || typeof v !== "object") return false;
  const obj = v as Partial<LevelJson>;
  if (!Array.isArray(obj.grid) || obj.grid.length === 0) return false;
  if (typeof obj.grid[0] !== "string") return false;
  if (typeof obj.id !== "undefined" && typeof obj.id !== "string") return false;
  return true;
}

function normalizeSavedGame(raw: unknown): SavedGameV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<SavedGameV1>;
  if (obj.v !== 1) return null;

  if (typeof obj.savedAtMs !== "number" || !Number.isFinite(obj.savedAtMs)) return null;
  const runStartedAtMs =
    typeof obj.runStartedAtMs === "number" && Number.isFinite(obj.runStartedAtMs) && obj.runStartedAtMs > 0
      ? Math.floor(obj.runStartedAtMs)
      : undefined;
  const scope: SaveGameScope = obj.scope === "campaign" ? "campaign" : "level";
  if (!isMode(obj.mode)) return null;
  const seed = typeof obj.seed === "string" ? obj.seed : null;
  if (!isDifficulty(obj.difficulty)) return null;
  if (typeof obj.score !== "number" || !Number.isFinite(obj.score) || obj.score < 0 || obj.score > 5_000_000) return null;
  if (typeof obj.lives !== "number" || !Number.isFinite(obj.lives) || obj.lives < 0 || obj.lives > 99) return null;
  const campaignIndex =
    typeof obj.campaignIndex === "number" && Number.isFinite(obj.campaignIndex) ? Math.floor(obj.campaignIndex) : null;
  if (!isLevelJson(obj.levelJson)) return null;

  return {
    v: 1,
    savedAtMs: obj.savedAtMs,
    runStartedAtMs,
    scope,
    mode: obj.mode,
    seed,
    difficulty: obj.difficulty,
    score: Math.floor(obj.score),
    lives: Math.floor(obj.lives),
    campaignIndex,
    levelJson: { id: obj.levelJson.id, grid: obj.levelJson.grid.slice() }
  };
}

export function loadSavedGame(): SavedGameV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeSavedGame(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return null;
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return normalizeSavedGame(JSON.parse(legacy));
  } catch {
    return null;
  }
}

export function saveCheckpoint(params: Omit<SavedGameV1, "v" | "savedAtMs">): void {
  try {
    const payload: SavedGameV1 = {
      v: 1,
      savedAtMs: Date.now(),
      ...params
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
