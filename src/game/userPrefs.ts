import type { LevelJson } from "./levelTypes";
import type { Difficulty } from "./settings";

export type PreferredGameMode = "normal" | "vibe";
export type MobileLayoutMode = "off" | "auto" | "on";

export interface GeneratedLevelEntry {
  id: string;
  createdAtMs: number;
  keywords: string;
  difficulty: Difficulty;
  level: LevelJson;
}

export interface UserPrefs {
  preferredMode: PreferredGameMode;
  viewMode: "topdown" | "fps";
  mobileLayout: MobileLayoutMode;
  soundEnabled: boolean;
  musicEnabled: boolean;
  musicTrackId: string;
  username: string;
  aiModeEnabled: boolean;
  generatedLevels: GeneratedLevelEntry[];
}

/**
 * LocalStorage schema versioning:
 * - Keep the key stable (`...v1`) as long as `normalizePrefs()` can safely migrate older fields.
 * - If an incompatible change is needed, bump the key and provide a new normalizer.
 */
const STORAGE_KEY = "raiman.userprefs.v1";
const LEGACY_STORAGE_KEY = "coopman.userprefs.v1";

const DEFAULT_PREFS: UserPrefs = {
  preferredMode: "vibe",
  viewMode: "topdown",
  mobileLayout: "auto",
  soundEnabled: true,
  musicEnabled: true,
  musicTrackId: "rotate",
  username: "",
  aiModeEnabled: false,
  generatedLevels: []
};

function isDifficulty(v: unknown): v is Difficulty {
  return v === "easy" || v === "normal" || v === "hard";
}

function normalizePrefs(raw: unknown): UserPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const obj = raw as Partial<UserPrefs>;

  const preferredMode: PreferredGameMode = obj.preferredMode === "normal" ? "normal" : "vibe";
  const viewMode: UserPrefs["viewMode"] = obj.viewMode === "fps" ? "fps" : "topdown";
  const mobileLayout: MobileLayoutMode =
    obj.mobileLayout === "on" ? "on" : obj.mobileLayout === "off" ? "off" : "auto";
  const soundEnabled = obj.soundEnabled !== false;
  const musicEnabled = obj.musicEnabled !== false;
  const musicTrackId = typeof obj.musicTrackId === "string" ? obj.musicTrackId.slice(0, 96) : "";
  const username = typeof obj.username === "string" ? obj.username.slice(0, 48) : "";
  const aiModeEnabled = obj.aiModeEnabled === true;

  const generatedLevels: GeneratedLevelEntry[] = [];
  if (Array.isArray(obj.generatedLevels)) {
    for (const e of obj.generatedLevels) {
      if (!e || typeof e !== "object") continue;
      const entry = e as Partial<GeneratedLevelEntry>;
      if (typeof entry.id !== "string" || !entry.id) continue;
      if (typeof entry.createdAtMs !== "number" || !Number.isFinite(entry.createdAtMs)) continue;
      if (!isDifficulty(entry.difficulty)) continue;
      if (typeof entry.keywords !== "string") continue;
      if (!entry.level || typeof entry.level !== "object") continue;
      const level = entry.level as Partial<LevelJson>;
      if (!Array.isArray(level.grid) || level.grid.length === 0) continue;
      generatedLevels.push({
        id: entry.id,
        createdAtMs: entry.createdAtMs,
        keywords: entry.keywords,
        difficulty: entry.difficulty,
        level: { id: level.id, grid: level.grid as string[] }
      });
    }
  }

  // Newest first, cap size.
  generatedLevels.sort((a, b) => b.createdAtMs - a.createdAtMs);

  return {
    preferredMode,
    viewMode,
    mobileLayout,
    soundEnabled,
    musicEnabled,
    musicTrackId,
    username,
    aiModeEnabled,
    generatedLevels: generatedLevels.slice(0, 50)
  };
}

export function getUserPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizePrefs(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_PREFS };
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return normalizePrefs(JSON.parse(legacy));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveUserPrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function updateUserPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const current = getUserPrefs();
  const next: UserPrefs = {
    ...current,
    ...patch,
    generatedLevels: patch.generatedLevels ?? current.generatedLevels
  };
  saveUserPrefs(next);
  return next;
}

export function addGeneratedLevel(params: { level: LevelJson; keywords: string; difficulty: Difficulty }): UserPrefs {
  const now = Date.now();
  const id = `AI_${now}`;
  const entry: GeneratedLevelEntry = {
    id,
    createdAtMs: now,
    keywords: params.keywords,
    difficulty: params.difficulty,
    level: {
      id: params.level.id ?? `AI_Level_${new Date(now).toISOString().slice(0, 10)}_${id.slice(-4)}`,
      grid: params.level.grid
    }
  };

  const current = getUserPrefs();
  const generatedLevels = [entry, ...current.generatedLevels].slice(0, 50);
  const next = { ...current, generatedLevels };
  saveUserPrefs(next);
  return next;
}

export function removeGeneratedLevel(id: string): UserPrefs {
  const current = getUserPrefs();
  const generatedLevels = current.generatedLevels.filter((e) => e.id !== id);
  const next = { ...current, generatedLevels };
  saveUserPrefs(next);
  return next;
}
