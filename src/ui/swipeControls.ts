import Phaser from "phaser";
import { Direction } from "../game/directions";

export interface SwipeControlsOptions {
  thresholdPx?: number;
}

export class SwipeControls {
  private readonly scene: Phaser.Scene;
  private readonly onDirection: (direction: Direction) => void;
  private readonly thresholdPx: number;

  private activePointerId: number | null = null;
  private startX = 0;
  private startY = 0;

  constructor(scene: Phaser.Scene, onDirection: (direction: Direction) => void, options: SwipeControlsOptions = {}) {
    this.scene = scene;
    this.onDirection = onDirection;
    this.thresholdPx = options.thresholdPx ?? 30;

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handleDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.handleUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handleUp, this);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handleDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.handleUp, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handleUp, this);
    this.activePointerId = null;
  }

  private handleDown(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== null) return;
    if (pointer.button !== 0) return;
    this.activePointerId = pointer.id;
    this.startX = pointer.worldX;
    this.startY = pointer.worldY;
  }

  private handleUp(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId === null || pointer.id !== this.activePointerId) return;
    this.activePointerId = null;

    const dx = pointer.worldX - this.startX;
    const dy = pointer.worldY - this.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < this.thresholdPx) return;

    if (absX > absY) {
      this.onDirection(dx < 0 ? Direction.Left : Direction.Right);
    } else {
      this.onDirection(dy < 0 ? Direction.Up : Direction.Down);
    }
  }
}

