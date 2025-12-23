import Phaser from "phaser";
import type { ParsedLevel, TileType } from "./levelTypes";
import { drawPellets } from "./renderLevel";

export type CollectedItem = "pellet" | "power" | null;

export interface CollectResult {
  collected: CollectedItem;
  scoreDelta: number;
  remainingCount: number;
  remainingPellets: number;
  remainingPowers: number;
}

export class PelletSystem {
  readonly graphics: Phaser.GameObjects.Graphics;

  private readonly level: ParsedLevel;
  private readonly tileSize: number;
  private remainingPellets: number;
  private remainingPowers: number;

  constructor(scene: Phaser.Scene, level: ParsedLevel, tileSize: number) {
    this.level = level;
    this.tileSize = tileSize;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(1);

    const { pellets, powers } = this.countRemaining(level.tileMatrix);
    this.remainingPellets = pellets;
    this.remainingPowers = powers;

    this.redraw();
  }

  getRemainingPellets(): number {
    return this.remainingPellets;
  }

  getRemainingPowers(): number {
    return this.remainingPowers;
  }

  getRemainingCount(): number {
    return this.remainingPellets + this.remainingPowers;
  }

  tryCollectAt(tileX: number, tileY: number): CollectResult | null {
    if (tileX < 0 || tileY < 0 || tileX >= this.level.width || tileY >= this.level.height) return null;

    const tile = this.level.tileMatrix[tileY]?.[tileX] as TileType | undefined;
    if (tile !== "pellet" && tile !== "power") return null;

    this.level.tileMatrix[tileY]![tileX] = "empty";

    let collected: CollectedItem = null;
    let scoreDelta = 0;
    if (tile === "pellet") {
      collected = "pellet";
      scoreDelta = 10;
      this.remainingPellets = Math.max(0, this.remainingPellets - 1);
    } else {
      collected = "power";
      scoreDelta = 50;
      this.remainingPowers = Math.max(0, this.remainingPowers - 1);
    }

    this.redraw();

    return {
      collected,
      scoreDelta,
      remainingCount: this.getRemainingCount(),
      remainingPellets: this.remainingPellets,
      remainingPowers: this.remainingPowers
    };
  }

  spawnPowerPelletAt(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= this.level.width || tileY >= this.level.height) return false;

    const current = this.level.tileMatrix[tileY]?.[tileX] as TileType | undefined;
    if (!current) return false;
    if (current === "power") return false;
    // Boxes occupy a temporary "wall" tile; allow spawning there after destruction.
    if (current !== "empty" && current !== "wall") return false;

    this.level.tileMatrix[tileY]![tileX] = "power";
    this.remainingPowers += 1;

    // Keep `pelletPositions` in sync so FPS-mode rendering can see dynamically spawned pellets.
    const exists = this.level.pelletPositions.some((p) => p.x === tileX && p.y === tileY);
    if (!exists) this.level.pelletPositions.push({ x: tileX, y: tileY });

    this.redraw();
    return true;
  }

  redraw(): void {
    this.graphics.clear();
    drawPellets(this.graphics, this.level, this.tileSize);
  }

  private countRemaining(tileMatrix: TileType[][]): { pellets: number; powers: number } {
    let pellets = 0;
    let powers = 0;
    for (let y = 0; y < tileMatrix.length; y++) {
      const row = tileMatrix[y]!;
      for (let x = 0; x < row.length; x++) {
        const tile = row[x]!;
        if (tile === "pellet") pellets += 1;
        else if (tile === "power") powers += 1;
      }
    }
    return { pellets, powers };
  }
}
