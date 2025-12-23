export type Difficulty = "easy" | "normal" | "hard";

export interface GameSettings {
  difficulty: Difficulty;
  playerSpeedTilesPerSec: number;
}

const STORAGE_KEY = "raiman.settings.v1";
const LEGACY_STORAGE_KEY = "coopman.settings.v1";

export const DIFFICULTY_PRESETS: Record<Difficulty, GameSettings> = {
  // "Easy" should not make the controls feel sluggish; make it easier via other mechanics (e.g. ghosts),
  // not by slowing the player's movement. 6 langsam und 8 normal ging gut
  easy: { difficulty: "easy", playerSpeedTilesPerSec: 4 },
  normal: { difficulty: "normal", playerSpeedTilesPerSec: 7 },
  hard: { difficulty: "hard", playerSpeedTilesPerSec: 11 }
};

export const DEFAULT_SETTINGS: GameSettings = DIFFICULTY_PRESETS.normal;

export function getSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const legacy = raw ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsedRaw = raw ?? legacy;
    if (!parsedRaw) return DEFAULT_SETTINGS;
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const parsed = JSON.parse(parsedRaw) as Partial<GameSettings>;
    const difficulty = parsed.difficulty;
    if (difficulty === "easy" || difficulty === "normal" || difficulty === "hard") {
      return DIFFICULTY_PRESETS[difficulty];
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function setDifficulty(difficulty: Difficulty): GameSettings {
  const next = DIFFICULTY_PRESETS[difficulty];
  saveSettings(next);
  return next;
}

export function playerSpeedPxPerSec(tileSize: number, settings: GameSettings): number {
  return settings.playerSpeedTilesPerSec * tileSize;
}
