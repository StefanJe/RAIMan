import { stringToSeed32 } from "./rng";

export interface MusicTrack {
  id: string;
  label: string;
  url: string;
}

export const ROTATE_TRACK_ID = "rotate";

function niceLabelFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const noExt = file.replace(/\.[^/.]+$/, "");
  return noExt;
}

// Vite: gather all files from /src/ui/songs at build time as URLs.
// Note: `as: 'url'` is deprecated in Vite 6; use `query: '?url'` + `import: 'default'` instead.
const SONG_URLS = import.meta.glob("../ui/songs/*.{mp3,ogg,wav,m4a}", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;

const tracks: MusicTrack[] = Object.entries(SONG_URLS)
  .map(([path, url]) => {
    const id = `song-${stringToSeed32(path)}`;
    return { id, label: niceLabelFromPath(path), url };
  })
  .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

export function getMusicTracks(): readonly MusicTrack[] {
  return tracks;
}

export function getMusicTrackById(id: string | null | undefined): MusicTrack | null {
  if (!id) return null;
  return tracks.find((t) => t.id === id) ?? null;
}
