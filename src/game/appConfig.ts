export type GameMode = "classic" | "vibe";

export interface VibeSettings {
  // Vibe-only systems (kept inert unless mode === "vibe").
  shiftIntervalMs: number;
  hintDurationMs: number;
}

export interface AppConfig {
  mode: GameMode;
  seed: string | null;
  vibe: VibeSettings;
}

const DEFAULT_VIBE_SETTINGS: VibeSettings = {
  shiftIntervalMs: 12_000,
  hintDurationMs: 2_500
};

let appConfig: AppConfig = {
  mode: "classic",
  seed: null,
  vibe: DEFAULT_VIBE_SETTINGS
};

function parseMode(raw: string | null): GameMode {
  return raw === "vibe" ? "vibe" : "classic";
}

export function dailySeed(now = new Date()): string {
  // Local date in YYYY-MM-DD.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the effective seed used by Vibe systems.
 * - Vibe: URL `seed` or daily seed fallback
 * - Classic: empty string (classic code path must remain unchanged)
 */
export function getEffectiveSeed(cfg: AppConfig = appConfig): string {
  return cfg.mode === "vibe" ? (cfg.seed ?? dailySeed()) : "";
}

/**
 * Initializes `appConfig` from the current URL query.
 * - `?mode=vibe` enables vibe mode
 * - `?seed=...` sets the deterministic seed (default: local date)
 */
export function initAppConfigFromUrl(urlSearch?: string): AppConfig {
  const search = urlSearch ?? (typeof window !== "undefined" ? window.location.search : "");
  const params = new URLSearchParams(search);
  const mode = parseMode(params.get("mode"));

  const seed =
    mode === "vibe"
      ? (params.get("seed")?.trim() || dailySeed())
      : null;

  appConfig = {
    mode,
    seed,
    vibe: DEFAULT_VIBE_SETTINGS
  };

  return appConfig;
}

export function getAppConfig(): AppConfig {
  return appConfig;
}

export function setGameMode(mode: GameMode): AppConfig {
  const next: AppConfig = {
    ...appConfig,
    mode,
    seed: mode === "vibe" ? (appConfig.seed ?? dailySeed()) : null
  };
  appConfig = next;
  syncModeToUrl(next.mode);
  return appConfig;
}

/**
 * Builds a shareable URL that forces Vibe + a specific seed.
 */
export function buildVibeShareUrl(seed: string): string {
  if (typeof window === "undefined") return `?mode=vibe&seed=${encodeURIComponent(seed)}`;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "vibe");
  url.searchParams.set("seed", seed);
  return url.toString();
}

function syncModeToUrl(mode: GameMode): void {
  if (typeof window === "undefined") return;
  if (!window.history?.replaceState) return;

  const url = new URL(window.location.href);
  if (mode === "vibe") {
    url.searchParams.set("mode", "vibe");
  } else {
    url.searchParams.delete("mode");
  }
  window.history.replaceState({}, "", url.toString());
}
