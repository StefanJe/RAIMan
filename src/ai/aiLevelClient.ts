import type { Difficulty } from "../game/settings";
import type { LevelJson } from "../game/levelTypes";
import { generatePacRogueLevel } from "../game/pacRogue";

export interface GenerateLevelParams {
  keywords: string;
  difficulty: Difficulty;
  width?: number;
  height?: number;
}

// Stub for later serverless endpoint integration.
// Keep signature stable; swap implementation to `fetch(...)` later.
export async function generateLevel(params: GenerateLevelParams): Promise<LevelJson> {
  return generatePacRogueLevel({
    seed: params.keywords,
    difficulty: params.difficulty,
    width: params.width,
    height: params.height
  });
}
