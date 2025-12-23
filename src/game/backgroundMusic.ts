import Phaser from "phaser";
import { ROTATE_TRACK_ID, getMusicTrackById, getMusicTracks, type MusicTrack } from "./musicTracks";

/**
 * Background music controller (singleton).
 *
 * Design goals:
 * - Exactly one music track at a time (global across scenes).
 * - Works with browsers that block WebAudio autoplay: if `scene.sound.locked` we defer until UNLOCKED.
 * - Supports "rotieren" (randomized playlist cycling).
 *
 * Important: This controls only "songs" (background music), not SFX.
 */
let current: Phaser.Sound.BaseSound | null = null;
let currentKey: string | null = null;
let pendingLoadKey: string | null = null;
let rotationActive = false;
let rotationIndex = 0;
let rotationOrder: MusicTrack[] = [];
let lastRotationKey: string | null = null;
let loaderScene: Phaser.Scene | null = null;
let loadToken = 0;
let pendingRequestedTrackId: string | null = null;
let pendingRequestedScene: Phaser.Scene | null = null;
let pendingUnlockArmed = false;

function stopAndDestroy(): void {
  try {
    current?.stop();
    current?.destroy();
  } catch {
    // ignore
  }
  if (currentKey) lastRotationKey = currentKey;
  current = null;
  currentKey = null;
  pendingLoadKey = null;
  rotationActive = false;
  pendingRequestedTrackId = null;
  pendingRequestedScene = null;
  pendingUnlockArmed = false;
  rotationOrder = [];
  rotationIndex = 0;
}

export function stopBackgroundMusic(): void {
  stopAndDestroy();
}

function ensureLoaderScene(scene: Phaser.Scene): Phaser.Scene {
  loaderScene = scene;
  return scene;
}

function playSound(scene: Phaser.Scene, key: string, loop: boolean, onComplete?: () => void): void {
  try {
    current = scene.sound.add(key, { loop, volume: 0.35 });
    currentKey = key;
    if (onComplete) (current as any)?.once?.("complete", onComplete);
    current.play();
  } catch {
    stopAndDestroy();
  }
}

function loadAndPlay(scene: Phaser.Scene, key: string, url: string, loop: boolean, onComplete?: () => void): void {
  const token = ++loadToken;
  pendingLoadKey = key;
  ensureLoaderScene(scene);

  const play = () => {
    if (token !== loadToken) return;
    if (pendingLoadKey !== key) return;
    pendingLoadKey = null;
    playSound(scene, key, loop, onComplete);
  };

  try {
    if ((scene.cache as any)?.audio?.exists?.(key)) {
      play();
      return;
    }
  } catch {
    // ignore
  }

  scene.load.audio(key, url);
  scene.load.once(Phaser.Loader.Events.COMPLETE, play);
  scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: unknown) => {
    if (token !== loadToken) return;
    const f = file as { key?: unknown } | null;
    if (f?.key !== key) return;
    stopAndDestroy();
  });
  scene.load.start();
}

function shuffleTracks(tracks: ReadonlyArray<MusicTrack>, avoidId?: string | null): MusicTrack[] {
  const list = tracks.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  if (avoidId && list.length > 1 && list[0]?.id === avoidId) {
    const swapIdx = list.findIndex((t) => t.id !== avoidId);
    if (swapIdx > 0) [list[0], list[swapIdx]] = [list[swapIdx]!, list[0]!];
  }
  return list;
}

function rotationMatches(tracks: ReadonlyArray<MusicTrack>): boolean {
  if (rotationOrder.length !== tracks.length) return false;
  const ids = new Set(tracks.map((t) => t.id));
  if (ids.size !== rotationOrder.length) return false;
  for (const t of rotationOrder) {
    if (!ids.has(t.id)) return false;
  }
  return true;
}

function nextRotationTrack(tracks: ReadonlyArray<MusicTrack>, avoidId?: string | null): MusicTrack | null {
  if (tracks.length === 0) return null;
  if (!rotationMatches(tracks) || rotationOrder.length === 0 || rotationIndex >= rotationOrder.length) {
    rotationOrder = shuffleTracks(tracks, avoidId ?? lastRotationKey);
    rotationIndex = 0;
  }
  if (rotationIndex >= rotationOrder.length) return null;
  const next = rotationOrder[rotationIndex]!;
  rotationIndex += 1;
  return next;
}

function startRotation(scene: Phaser.Scene): void {
  const tracks = getMusicTracks();
  if (tracks.length === 0) {
    stopAndDestroy();
    return;
  }

  rotationActive = true;
  ensureLoaderScene(scene);

  // If already playing a song in rotation mode, keep it.
  if (currentKey && current && current.isPlaying) return;

  const next = nextRotationTrack(tracks, lastRotationKey);
  if (!next) {
    stopAndDestroy();
    return;
  }

  const advance = () => {
    if (!rotationActive) return;
    const s = loaderScene ?? scene;
    const list = getMusicTracks();
    if (list.length === 0) {
      stopAndDestroy();
      return;
    }
    const t = nextRotationTrack(list, lastRotationKey);
    if (!t) {
      stopAndDestroy();
      return;
    }
    stopAndDestroy();
    rotationActive = true;
    loadAndPlay(s, t.id, t.url, false, advance);
  };

  stopAndDestroy();
  rotationActive = true;
  loadAndPlay(scene, next.id, next.url, false, advance);
}

/**
 * Enables background music for the given scene.
 *
 * - `trackId === null/""`: stop music
 * - `trackId === ROTATE_TRACK_ID`: rotate through all tracks in `src/ui/songs`
 * - otherwise: load + loop a specific track
 *
 * This is safe to call from any scene; the current track persists across scene changes.
 */
export function setBackgroundMusic(scene: Phaser.Scene, trackId: string | null): void {
  if (!scene.sound) return;

  const id = (trackId ?? "").trim();
  if (!id) {
    stopAndDestroy();
    return;
  }

  // Avoid WebAudio autoplay errors: if the sound system is locked, defer until unlocked.
  if (scene.sound.locked) {
    pendingRequestedScene = scene;
    pendingRequestedTrackId = id;
    ensureLoaderScene(scene);
    if (!pendingUnlockArmed) {
      pendingUnlockArmed = true;
      scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        pendingUnlockArmed = false;
        const s = pendingRequestedScene ?? scene;
        const nextId = pendingRequestedTrackId;
        pendingRequestedScene = null;
        pendingRequestedTrackId = null;
        if (!nextId) return;
        setBackgroundMusic(s, nextId);
      });
    }
    return;
  }

  if (id === ROTATE_TRACK_ID) {
    startRotation(scene);
    return;
  }

  rotationActive = false;
  if (currentKey === id && current && current.isPlaying) return;
  if (pendingLoadKey === id) return;

  const track = getMusicTrackById(id);
  if (!track) {
    stopAndDestroy();
    return;
  }

  // Stop old track first to avoid overlaps.
  stopAndDestroy();
  loadAndPlay(scene, id, track.url, true);
}
