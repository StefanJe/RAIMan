import Phaser from "phaser";
import { Direction } from "../game/directions";

export interface DPadOptions {
  onDirection: (direction: Direction) => void;
}

export type DPadAnchor = "bottom-left" | "bottom-right" | "mid-left" | "mid-right";

export interface DPadLayoutOptions {
  anchor?: DPadAnchor;
  buttonSize?: number;
  gap?: number;
  margin?: number;
  centerY?: number;
}

export class DPad {
  readonly container: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;
  private readonly onDirection: (direction: Direction) => void;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly zones: Record<Exclude<Direction, Direction.None>, Phaser.GameObjects.Zone>;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, options: DPadOptions) {
    this.scene = scene;
    this.onDirection = options.onDirection;

    this.container = scene.add.container(0, 0);
    this.container.setDepth(2000);
    this.container.setScrollFactor(0);

    this.bg = scene.add.graphics();
    this.bg.setScrollFactor(0);

    this.zones = {
      up: scene.add.zone(0, 0, 1, 1).setOrigin(0.5).setInteractive({ useHandCursor: true }),
      down: scene.add.zone(0, 0, 1, 1).setOrigin(0.5).setInteractive({ useHandCursor: true }),
      left: scene.add.zone(0, 0, 1, 1).setOrigin(0.5).setInteractive({ useHandCursor: true }),
      right: scene.add.zone(0, 0, 1, 1).setOrigin(0.5).setInteractive({ useHandCursor: true })
    };
    for (const z of Object.values(this.zones)) z.setScrollFactor(0);

    this.zones.up.on("pointerdown", () => this.onDirection(Direction.Up));
    this.zones.down.on("pointerdown", () => this.onDirection(Direction.Down));
    this.zones.left.on("pointerdown", () => this.onDirection(Direction.Left));
    this.zones.right.on("pointerdown", () => this.onDirection(Direction.Right));

    const mkLabel = (text: string) =>
      scene.add
        .text(0, 0, text, {
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: "18px",
          color: "#e6f0ff"
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setAlpha(0.85);

    this.labels.push(mkLabel("↑"), mkLabel("↓"), mkLabel("←"), mkLabel("→"));

    this.container.add([this.bg, ...Object.values(this.zones), ...this.labels]);
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  layout(viewWidth: number, viewHeight: number, options: DPadLayoutOptions = {}): void {
    const button = Math.max(36, Math.floor(options.buttonSize ?? 56));
    const gap = Math.max(6, Math.floor(options.gap ?? 10));
    const margin = Math.max(8, Math.floor(options.margin ?? 24));

    const crossRadius = (button + gap) + button / 2;
    const minCenterX = margin + crossRadius;
    const maxCenterX = Math.max(minCenterX, viewWidth - margin - crossRadius);
    const minCenterY = margin + crossRadius;
    const maxCenterY = Math.max(minCenterY, viewHeight - margin - crossRadius);

    const anchor: DPadAnchor = options.anchor ?? "bottom-left";
    const centerX =
      anchor === "bottom-right" || anchor === "mid-right"
        ? maxCenterX
        : minCenterX;
    const defaultCenterY =
      anchor === "mid-left" || anchor === "mid-right"
        ? Math.floor(viewHeight * 0.62)
        : maxCenterY;
    const centerY = Math.min(maxCenterY, Math.max(minCenterY, Math.floor(options.centerY ?? defaultCenterY)));

    const up = { x: centerX, y: centerY - (button + gap) };
    const down = { x: centerX, y: centerY + (button + gap) };
    const left = { x: centerX - (button + gap), y: centerY };
    const right = { x: centerX + (button + gap), y: centerY };

    const positions: Record<Exclude<Direction, Direction.None>, { x: number; y: number }> = {
      up,
      down,
      left,
      right
    };

    this.bg.clear();
    for (const pos of Object.values(positions)) {
      this.bg.fillStyle(0xffffff, 0.06);
      this.bg.fillCircle(pos.x, pos.y, button / 2);
      this.bg.lineStyle(2, 0x9fb4d6, 0.25);
      this.bg.strokeCircle(pos.x, pos.y, button / 2);
    }

    this.zones.up.setPosition(up.x, up.y).setSize(button, button);
    this.zones.down.setPosition(down.x, down.y).setSize(button, button);
    this.zones.left.setPosition(left.x, left.y).setSize(button, button);
    this.zones.right.setPosition(right.x, right.y).setSize(button, button);

    this.labels[0]!.setPosition(up.x, up.y);
    this.labels[1]!.setPosition(down.x, down.y);
    this.labels[2]!.setPosition(left.x, left.y);
    this.labels[3]!.setPosition(right.x, right.y);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
