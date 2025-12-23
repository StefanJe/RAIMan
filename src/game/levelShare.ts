import type { LevelJson } from "./levelTypes";

export type DecodeLevelResult = { ok: true; level: LevelJson } | { ok: false; errors: string[] };

const HASH_PREFIX = "lvl=";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(encoded: string): Uint8Array {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeLevel(level: LevelJson): string {
  const json = JSON.stringify(level);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncode(bytes);
}

export function encodeLevelToHash(level: LevelJson): string {
  return `#${HASH_PREFIX}${encodeLevel(level)}`;
}

export function decodeLevelFromHash(hash: string): DecodeLevelResult {
  const errors: string[] = [];
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return { ok: false, errors: ["Empty hash."] };

  const encoded = h.startsWith(HASH_PREFIX) ? h.slice(HASH_PREFIX.length) : h;
  if (!encoded) return { ok: false, errors: ["Missing encoded level in hash."] };

  let obj: unknown;
  try {
    const bytes = base64UrlDecode(encoded);
    const json = new TextDecoder().decode(bytes);
    obj = JSON.parse(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`Failed to decode level from hash: ${message}`] };
  }

  if (!obj || typeof obj !== "object") errors.push("Decoded level is not an object.");
  const maybe = obj as Partial<LevelJson>;
  if (!Array.isArray(maybe.grid) || maybe.grid.length === 0) errors.push("Decoded level.grid must be a non-empty string array.");
  if (Array.isArray(maybe.grid)) {
    for (let i = 0; i < maybe.grid.length; i++) {
      if (typeof maybe.grid[i] !== "string") errors.push(`Decoded level.grid[${i}] must be a string.`);
    }
  }
  if (maybe.id !== undefined && typeof maybe.id !== "string") errors.push("Decoded level.id must be a string if provided.");

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, level: { id: maybe.id, grid: maybe.grid as string[] } };
}

export function getLevelFromLocationHash(): DecodeLevelResult | null {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (!hash) return null;
  return decodeLevelFromHash(hash);
}

export function buildShareUrl(level: LevelJson): string {
  if (typeof window === "undefined") return encodeLevelToHash(level);
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${encodeLevelToHash(level)}`;
}

