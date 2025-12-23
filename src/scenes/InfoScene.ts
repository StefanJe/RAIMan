import Phaser from "phaser";
import { INFO_SECTIONS } from "../ui/infoContent";

type InfoFromScene = "BootScene" | "SettingsScene";

export class InfoScene extends Phaser.Scene {
  private dom?: Phaser.GameObjects.DOMElement;
  private viewportEl?: HTMLDivElement;
  private root?: HTMLDivElement;
  private backEl?: HTMLButtonElement;
  private fromScene: InfoFromScene = "BootScene";

  constructor() {
    super({ key: "InfoScene" });
  }

  init(data?: unknown): void {
    const maybe = data as { from?: unknown } | undefined;
    this.fromScene = maybe?.from === "SettingsScene" ? "SettingsScene" : "BootScene";
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0b1020);

    // Ensure DOM elements (scroll / buttons) work without Phaser capturing inputs.
    this.input.keyboard?.disableGlobalCapture();

    const sectionsHtml = INFO_SECTIONS.map((s) => {
      const items = s.body.map((line) => `<li style="margin:6px 0; line-height:1.35;">${escapeHtml(line)}</li>`).join("");
      return `
        <div style="
          padding:12px;
          border-radius:14px;
          background: rgba(5, 10, 24, 0.55);
          border: 1px solid rgba(159,180,214,0.18);
          margin-top: 12px;
        ">
          <div style="font-weight:900; margin-bottom:8px; letter-spacing:0.2px;">${escapeHtml(s.title)}</div>
          <ul style="margin:0; padding-left: 18px; font-size:14px; color:#e6f0ff; opacity:0.95;">
            ${items}
          </ul>
        </div>
      `;
    }).join("");

    const html = `
      <div data-s="viewport" style="
        width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y;
        padding: 14px;
        box-sizing: border-box;
      ">
        <div data-s="panel" style="
          width: 740px;
          max-width: 100%;
          margin: 0 auto;
          padding: 14px 14px 16px 14px;
          border-radius: 16px;
          background: rgba(12, 18, 38, 0.92);
          border: 1px solid rgba(159, 180, 214, 0.35);
          box-shadow: 0 16px 40px rgba(0,0,0,0.35);
          color: #e6f0ff;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          box-sizing: border-box;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <div>
              <div style="font-size:22px; font-weight:900; letter-spacing:0.2px;">Info RAI-Man</div>
              <div style="font-size:12px; opacity:0.75; margin-top:2px;">powered by Stefan & AI.</div>
            </div>
            <button data-s="back" style="
              padding: 10px 12px;
              border-radius: 12px;
              border: 1px solid rgba(159, 180, 214, 0.45);
              background: rgba(31, 58, 102, 0.85);
              color: #e6f0ff;
              font-weight: 800;
              cursor: pointer;
            ">Zur\u00fcck</button>
          </div>

          ${sectionsHtml}
        </div>
      </div>
    `;

    this.dom?.destroy();
    this.dom = this.add.dom(0, 0).createFromHTML(html);
    this.dom.setDepth(6000);
    this.dom.setScrollFactor(0);
    this.dom.setOrigin(0, 0);
    this.dom.setPosition(0, 0);

    this.viewportEl = this.dom.node as HTMLDivElement;
    // Phaser sets DOMElement nodes to `display:inline` by default; force block for scrolling + sizing.
    this.viewportEl.style.display = "block";
    this.viewportEl.style.boxSizing = "border-box";

    this.root = (this.viewportEl.querySelector('[data-s="panel"]') as HTMLDivElement | null) ?? undefined;
    this.backEl = (this.viewportEl.querySelector('[data-s="back"]') as HTMLButtonElement | null) ?? undefined;

    this.backEl?.addEventListener("click", () => this.scene.start(this.fromScene));

    // Let the page scroll without the Phaser canvas eating wheel/touch events.
    this.viewportEl.addEventListener(
      "wheel",
      (e) => {
        e.stopPropagation();
      },
      { capture: true, passive: true }
    );
    this.viewportEl.addEventListener(
      "touchmove",
      (e) => {
        e.stopPropagation();
      },
      { capture: true, passive: true }
    );

    // Ensure top scroll for fresh open.
    try {
      this.viewportEl?.scrollTo({ top: 0 });
    } catch {
      // ignore
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.input.keyboard?.enableGlobalCapture();
      this.dom?.destroy();
      this.dom = undefined;
      this.viewportEl = undefined;
      this.root = undefined;
    });

    this.handleResize(this.scale.gameSize);
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    if (!this.viewportEl) return;
    const w = Math.max(280, Math.floor(gameSize.width));
    const h = Math.max(240, Math.floor(gameSize.height));
    this.viewportEl.style.width = `${w}px`;
    this.viewportEl.style.height = `${h}px`;

    if (this.root) {
      const panelW = Math.max(280, Math.min(740, Math.floor(gameSize.width - 28)));
      this.root.style.width = `${panelW}px`;
    }

    // Keep Phaser's internal DOMElement size in sync with our computed styles.
    this.dom?.updateSize();
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
