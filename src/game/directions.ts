export enum Direction {
  None = "none",
  Up = "up",
  Down = "down",
  Left = "left",
  Right = "right"
}

export interface DirectionVec {
  x: number;
  y: number;
}

export function vec(direction: Direction): DirectionVec {
  switch (direction) {
    case Direction.Up:
      return { x: 0, y: -1 };
    case Direction.Down:
      return { x: 0, y: 1 };
    case Direction.Left:
      return { x: -1, y: 0 };
    case Direction.Right:
      return { x: 1, y: 0 };
    case Direction.None:
    default:
      return { x: 0, y: 0 };
  }
}

export function opposite(direction: Direction): Direction {
  switch (direction) {
    case Direction.Up:
      return Direction.Down;
    case Direction.Down:
      return Direction.Up;
    case Direction.Left:
      return Direction.Right;
    case Direction.Right:
      return Direction.Left;
    case Direction.None:
    default:
      return Direction.None;
  }
}

export function isHorizontal(direction: Direction): boolean {
  return direction === Direction.Left || direction === Direction.Right;
}

export function isVertical(direction: Direction): boolean {
  return direction === Direction.Up || direction === Direction.Down;
}

