export interface TileCoord {
  x: number;
  y: number;
}

export interface WorldCoord {
  x: number;
  y: number;
}

export function worldToTile(x: number, y: number, tileSize: number): TileCoord {
  return {
    x: Math.floor(x / tileSize),
    y: Math.floor(y / tileSize)
  };
}

export function tileToWorld(tileX: number, tileY: number, tileSize: number): WorldCoord {
  return {
    x: tileX * tileSize,
    y: tileY * tileSize
  };
}

export function tileCenter(tileX: number, tileY: number, tileSize: number): WorldCoord {
  return {
    x: tileX * tileSize + tileSize / 2,
    y: tileY * tileSize + tileSize / 2
  };
}

export function isAtTileCenter(x: number, y: number, tileSize: number, epsilon = 0.75): boolean {
  const t = worldToTile(x, y, tileSize);
  const c = tileCenter(t.x, t.y, tileSize);
  return Math.abs(x - c.x) <= epsilon && Math.abs(y - c.y) <= epsilon;
}

