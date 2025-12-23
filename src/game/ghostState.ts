export enum GhostState {
  Normal = "normal",
  Frightened = "frightened",
  Eaten = "eaten"
}

export const FRIGHTENED_DURATION_MS = 7000;
export const EATEN_RESPAWN_MS = 2000;

export interface GhostTimers {
  frightenedUntilMs: number;
  eatenRemainingMs: number;
}

export function startFrightened(nowMs: number, durationMs = FRIGHTENED_DURATION_MS): number {
  return nowMs + durationMs;
}

export function isFrightened(nowMs: number, frightenedUntilMs: number): boolean {
  return nowMs < frightenedUntilMs;
}

export function tickRemainingMs(remainingMs: number, deltaMs: number): number {
  return Math.max(0, remainingMs - deltaMs);
}

