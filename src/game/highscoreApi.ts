export const HIGHSCORE_ENDPOINT = "./api/highscore.php";

/**
 * Client API for the file-based PHP highscore backend.
 *
 * Notes:
 * - UI must never render user names via `innerHTML` (always `textContent`).
 * - Server does final validation + rate limiting, but we still sanitize client-side.
 * - If requests fail, the UI can fall back to a local/offline leaderboard.
 */
export type HighscoreGame = "pacman";
export type HighscoreMode = "classic" | "vibe";
export type HighscoreModeFilter = HighscoreMode | "all";
export type HighscoreScope = "all" | "daily";

export interface HighscoreItem {
  id: string;
  ts: number;
  game: HighscoreGame;
  mode: HighscoreMode;
  seed: string | null;
  name: string;
  score: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface HighscoreListResponse {
  ok: boolean;
  game: HighscoreGame;
  mode: HighscoreModeFilter;
  scope: HighscoreScope;
  seed: string | null;
  limit: number;
  items: HighscoreItem[];
}

export interface HighscoreSubmitPayload {
  game: HighscoreGame;
  mode: HighscoreMode;
  seed: string | null;
  name: string;
  score: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface HighscoreSubmitResponse {
  ok: boolean;
  saved: boolean;
  id: string;
  rank: number;
  leaderboard: HighscoreListResponse;
}

export function sanitizeHighscoreName(raw: string): string {
  const trimmed = raw.trim().slice(0, 16);
  if (!trimmed) return "";
  if (trimmed.includes("@")) return "";
  // Allowed: [A-Za-z0-9ÄÖÜäöüß _.-]
  const ok = /^[A-Za-z0-9ÄÖÜäöüß _.\-]+$/u.test(trimmed);
  return ok ? trimmed : "";
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 5000): Promise<unknown> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const id = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      signal: controller?.signal
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = json && typeof json === "object" && json !== null && "error" in json ? (json as { error?: unknown }).error : undefined;
      throw new Error(`HTTP ${res.status}${err ? `: ${String(err)}` : ""}`);
    }
    return json;
  } finally {
    if (id !== null) window.clearTimeout(id);
  }
}

export async function listHighscores(params: {
  game?: HighscoreGame;
  mode?: HighscoreModeFilter;
  scope?: HighscoreScope;
  seed?: string | null;
  limit?: number;
}): Promise<HighscoreListResponse> {
  const game = params.game ?? "pacman";
  const mode = params.mode ?? "all";
  const scope = params.scope ?? "all";
  const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));

  const url = new URL(HIGHSCORE_ENDPOINT, window.location.href);
  url.searchParams.set("action", "list");
  url.searchParams.set("game", game);
  url.searchParams.set("mode", mode);
  url.searchParams.set("scope", scope);
  url.searchParams.set("limit", String(limit));
  if (scope === "daily" && params.seed) url.searchParams.set("seed", params.seed);

  const json = await fetchJsonWithTimeout(url.toString(), { method: "GET" });
  return json as HighscoreListResponse;
}

export async function submitHighscore(payload: HighscoreSubmitPayload): Promise<HighscoreSubmitResponse> {
  const url = new URL(HIGHSCORE_ENDPOINT, window.location.href);
  url.searchParams.set("action", "submit");

  const json = await fetchJsonWithTimeout(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return json as HighscoreSubmitResponse;
}
