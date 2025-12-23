import Phaser from "phaser";

export interface OverlayOptions {
  title: string;
  body: string;
  buttonText: string;
  onButton: () => void;
  secondaryButtonText?: string;
  onSecondaryButton?: () => void;
}

export class Overlay {
  readonly container: Phaser.GameObjects.Container;

  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly bodyText: Phaser.GameObjects.Text;
  private readonly buttonBg: Phaser.GameObjects.Graphics;
  private readonly buttonText: Phaser.GameObjects.Text;
  private readonly buttonZone: Phaser.GameObjects.Zone;
  private readonly secondaryButtonBg?: Phaser.GameObjects.Graphics;
  private readonly secondaryButtonText?: Phaser.GameObjects.Text;
  private readonly secondaryButtonZone?: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene, options: OverlayOptions) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(5000);

    this.bg = scene.add.graphics();
    this.titleText = scene.add.text(0, 0, options.title, {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      fontSize: "64px",
      color: "#e6f0ff"
    });
    this.bodyText = scene.add.text(0, 0, options.body, {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: "18px",
      color: "#cfe0ff",
      align: "center"
    });

    this.buttonBg = scene.add.graphics();
    this.buttonText = scene.add.text(0, 0, options.buttonText, {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      fontSize: "22px",
      color: "#061024",
      fontStyle: "700"
    });
    this.buttonZone = scene.add.zone(0, 0, 260, 60).setInteractive({ useHandCursor: true });
    this.buttonZone.on("pointerup", options.onButton);

    if (options.secondaryButtonText && options.onSecondaryButton) {
      this.secondaryButtonBg = scene.add.graphics();
      this.secondaryButtonText = scene.add.text(0, 0, options.secondaryButtonText, {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "20px",
        color: "#e6f0ff",
        fontStyle: "700"
      });
      this.secondaryButtonZone = scene.add.zone(0, 0, 260, 52).setInteractive({ useHandCursor: true });
      this.secondaryButtonZone.on("pointerup", options.onSecondaryButton);
      this.secondaryButtonText.setOrigin(0.5);
      this.secondaryButtonZone.setOrigin(0.5);
    }

    this.titleText.setOrigin(0.5);
    this.bodyText.setOrigin(0.5);
    this.buttonText.setOrigin(0.5);
    this.buttonZone.setOrigin(0.5);

    this.container.add([this.bg, this.titleText, this.bodyText, this.buttonBg, this.buttonText, this.buttonZone]);
    if (this.secondaryButtonBg && this.secondaryButtonText && this.secondaryButtonZone) {
      this.container.add([this.secondaryButtonBg, this.secondaryButtonText, this.secondaryButtonZone]);
    }

    const scrollFix = [
      this.bg,
      this.titleText,
      this.bodyText,
      this.buttonBg,
      this.buttonText,
      this.buttonZone,
      this.secondaryButtonBg,
      this.secondaryButtonText,
      this.secondaryButtonZone
    ].filter(Boolean) as unknown[];
    for (const obj of scrollFix) {
      (obj as unknown as { setScrollFactor?: (x: number, y?: number) => unknown }).setScrollFactor?.(0);
    }
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  setBody(body: string): this {
    this.bodyText.setText(body);
    return this;
  }

  layout(viewWidth: number, viewHeight: number): void {
    const centerX = viewWidth / 2;
    const centerY = viewHeight / 2;

    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.65);
    this.bg.fillRect(0, 0, viewWidth, viewHeight);

    this.titleText.setPosition(centerX, centerY - 120);
    this.bodyText.setPosition(centerX, centerY - 40);
    this.bodyText.setWordWrapWidth(Math.max(200, viewWidth - 48), true);

    const buttonWidth = 260;
    const buttonHeight = 60;
    const buttonX = centerX - buttonWidth / 2;
    const buttonY = centerY + (this.secondaryButtonBg ? 40 : 60) - buttonHeight / 2;

    this.buttonBg.clear();
    this.buttonBg.fillStyle(0x7cffb2, 1);
    this.buttonBg.fillRoundedRect(buttonX, buttonY, buttonWidth, buttonHeight, 14);
    this.buttonBg.lineStyle(2, 0xd8ffe8, 0.9);
    this.buttonBg.strokeRoundedRect(buttonX, buttonY, buttonWidth, buttonHeight, 14);

    this.buttonText.setPosition(centerX, buttonY + buttonHeight / 2);
    this.buttonZone.setPosition(centerX, buttonY + buttonHeight / 2);

    if (this.secondaryButtonBg && this.secondaryButtonText && this.secondaryButtonZone) {
      const secondaryHeight = 52;
      const secondaryY = buttonY + buttonHeight + 14;
      const secondaryX = centerX - buttonWidth / 2;

      this.secondaryButtonBg.clear();
      this.secondaryButtonBg.fillStyle(0x1f3a66, 0.95);
      this.secondaryButtonBg.fillRoundedRect(secondaryX, secondaryY, buttonWidth, secondaryHeight, 14);
      this.secondaryButtonBg.lineStyle(2, 0x9fb4d6, 0.45);
      this.secondaryButtonBg.strokeRoundedRect(secondaryX, secondaryY, buttonWidth, secondaryHeight, 14);

      this.secondaryButtonText.setPosition(centerX, secondaryY + secondaryHeight / 2);
      this.secondaryButtonZone.setPosition(centerX, secondaryY + secondaryHeight / 2);
      this.secondaryButtonZone.setSize(buttonWidth, secondaryHeight);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
