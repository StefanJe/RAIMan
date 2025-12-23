import type { HighscoreGame, HighscoreItem, HighscoreMode, HighscoreModeFilter, HighscoreScope } from "./highscoreApi";

export interface LocalHighscoreEntry extends HighscoreItem {
  source: "local";
}

const LOCAL_KEY = "raiman.highscores.local.v1";
const LEGACY_LOCAL_KEY = "coopman.highscores.local.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readLocalRaw(): string | null {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) return raw;
  const legacy = localStorage.getItem(LEGACY_LOCAL_KEY);
  if (!legacy) return null;
  localStorage.setItem(LOCAL_KEY, legacy);
  localStorage.removeItem(LEGACY_LOCAL_KEY);
  return legacy;
}

function localDay(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function scoreCmp(a: HighscoreItem, b: HighscoreItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
  return a.ts - b.ts;
}

function normalizeEntries(raw: unknown): LocalHighscoreEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalHighscoreEntry[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const obj = it as Partial<LocalHighscoreEntry>;
    if (typeof obj.id !== "string" || !obj.id) continue;
    if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) continue;
    if (obj.game !== "pacman") continue;
    if (obj.mode !== "classic" && obj.mode !== "vibe") continue;
    if (obj.seed !== null && typeof obj.seed !== "string") continue;
    if (typeof obj.name !== "string") continue;
    if (typeof obj.score !== "number" || !Number.isFinite(obj.score)) continue;
    if (typeof obj.durationMs !== "number" || !Number.isFinite(obj.durationMs)) continue;
    out.push({
      id: obj.id,
      ts: obj.ts,
      game: "pacman",
      mode: obj.mode,
      seed: obj.seed ?? null,
      name: obj.name,
      score: Math.floor(obj.score),
      durationMs: Math.floor(obj.durationMs),
      meta: obj.meta,
      source: "local"
    });
  }
  out.sort(scoreCmp);
  return out.slice(0, 500);
}

export function addLocalHighscore(entry: {
  game?: HighscoreGame;
  mode: HighscoreMode;
  seed: string | null;
  name: string;
  score: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}): LocalHighscoreEntry {
  const now = Date.now();
  const id = `local_${now}_${Math.random().toString(16).slice(2)}`;
  const item: LocalHighscoreEntry = {
    id,
    ts: now,
    game: entry.game ?? "pacman",
    mode: entry.mode,
    seed: entry.mode === "vibe" ? entry.seed : null,
    name: entry.name,
    score: Math.floor(entry.score),
    durationMs: Math.floor(entry.durationMs),
    meta: entry.meta,
    source: "local"
  };

  const current = normalizeEntries(safeParse<unknown>(readLocalRaw()));
  const next = [item, ...current].sort(scoreCmp).slice(0, 500);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    // ignore
  }
  return item;
}

export function listLocalHighscores(params: {
  game?: HighscoreGame;
  mode?: HighscoreModeFilter;
  scope?: HighscoreScope;
  seed?: string | null;
  limit?: number;
}): { ok: true; offline: true; game: HighscoreGame; mode: HighscoreModeFilter; scope: HighscoreScope; seed: string | null; limit: number; items: LocalHighscoreEntry[] } {
  const game = params.game ?? "pacman";
  const mode = params.mode ?? "all";
  const scope = params.scope ?? "all";
  const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
  const seed = scope === "daily" ? (params.seed ?? localDay(Date.now())) : null;

  const all = normalizeEntries(safeParse<unknown>(readLocalRaw()));
  const filtered = all.filter((it) => {
    if (it.game !== game) return false;
    if (mode !== "all" && it.mode !== mode) return false;
    if (scope === "daily") {
      if (it.seed) return it.seed === seed;
      return localDay(it.ts) === seed;
    }
    return true;
  });
  filtered.sort(scoreCmp);

  return {
    ok: true,
    offline: true,
    game,
    mode,
    scope,
    seed,
    limit,
    items: filtered.slice(0, limit)
  };
}
