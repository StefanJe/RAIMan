import Phaser from "phaser";
import type { ParsedLevel, TileType } from "./levelTypes";

function isWall(tile: TileType): boolean {
  return tile === "wall";
}

export function drawWalls(graphics: Phaser.GameObjects.Graphics, level: ParsedLevel, tileSize: number): void {
  graphics.clear();
  graphics.fillStyle(0x102038, 1);
  graphics.lineStyle(Math.max(1, Math.floor(tileSize / 16)), 0x1f3a66, 1);

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      if (!isWall(level.tileMatrix[y]![x]!)) continue;
      const px = x * tileSize;
      const py = y * tileSize;
      graphics.fillRect(px, py, tileSize, tileSize);
      graphics.strokeRect(px, py, tileSize, tileSize);
    }
  }
}

export function renderWalls(scene: Phaser.Scene, level: ParsedLevel, tileSize: number): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setDepth(0);
  drawWalls(graphics, level, tileSize);

  return graphics;
}

export function drawPellets(graphics: Phaser.GameObjects.Graphics, level: ParsedLevel, tileSize: number): void {
  const pelletRadius = Math.max(2, Math.floor(tileSize * 0.12));
  const powerRadius = Math.max(pelletRadius + 2, Math.floor(tileSize * 0.28));

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const tile = level.tileMatrix[y]![x]!;
      if (tile !== "pellet" && tile !== "power") continue;

      const cx = x * tileSize + tileSize / 2;
      const cy = y * tileSize + tileSize / 2;

      if (tile === "pellet") {
        graphics.fillStyle(0xf4e6b0, 1);
        graphics.fillCircle(cx, cy, pelletRadius);
      } else {
        graphics.fillStyle(0xffd7ff, 1);
        graphics.fillCircle(cx, cy, powerRadius);
        graphics.lineStyle(Math.max(1, Math.floor(tileSize / 18)), 0xffffff, 0.6);
        graphics.strokeCircle(cx, cy, powerRadius);
      }
    }
  }
}

export function renderPellets(scene: Phaser.Scene, level: ParsedLevel, tileSize: number): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setDepth(1);
  drawPellets(graphics, level, tileSize);
  return graphics;
}
