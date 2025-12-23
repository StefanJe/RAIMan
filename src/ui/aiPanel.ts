import Phaser from "phaser";
import type { Difficulty } from "../game/settings";

export interface AIPanelOptions {
  onGenerate: (keywords: string, difficulty: Difficulty) => Promise<{ ok: true } | { ok: false; errors: string[] }>;
}

export class AIPanel {
  private readonly scene: Phaser.Scene;
  private readonly onGenerate: AIPanelOptions["onGenerate"];

  private dom?: Phaser.GameObjects.DOMElement;
  private root?: HTMLDivElement;
  private statusEl?: HTMLDivElement;
  private keywordsEl?: HTMLInputElement;
  private difficultyEl?: HTMLSelectElement;
  private buttonEl?: HTMLButtonElement;

  constructor(scene: Phaser.Scene, options: AIPanelOptions) {
    this.scene = scene;
    this.onGenerate = options.onGenerate;

    const html = `
      <div style="
        width: 320px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(12, 18, 38, 0.92);
        border: 1px solid rgba(159, 180, 214, 0.35);
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        color: #e6f0ff;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="font-weight:700; letter-spacing:0.4px;">AI Maze (Stub)</div>
          <div style="opacity:0.7; font-size:12px;">no API call yet</div>
        </div>

        <div style="margin-top:10px;">
          <label for="ai-keywords" style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Keywords</label>
          <input id="ai-keywords" name="keywords" autocomplete="off" data-ai="keywords" placeholder="e.g. spooky, neon, tight" style="
            width: 100%;
            box-sizing: border-box;
            padding: 10px 10px;
            border-radius: 10px;
            border: 1px solid rgba(159, 180, 214, 0.35);
            background: rgba(5, 10, 24, 0.9);
            color: #e6f0ff;
            outline: none;
          " />
        </div>

        <div style="margin-top:10px; display:flex; gap:10px; align-items:end;">
          <div style="flex:1;">
            <label for="ai-difficulty" style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Difficulty</label>
            <select id="ai-difficulty" name="difficulty" data-ai="difficulty" style="
              width: 100%;
              box-sizing: border-box;
              padding: 10px 10px;
              border-radius: 10px;
              border: 1px solid rgba(159, 180, 214, 0.35);
              background: rgba(5, 10, 24, 0.9);
              color: #e6f0ff;
              outline: none;
            ">
              <option value="easy">easy</option>
              <option value="normal" selected>normal</option>
              <option value="hard">hard</option>
            </select>
          </div>
          <button data-ai="generate" style="
            width: 150px;
            padding: 11px 10px;
            border-radius: 12px;
            border: 1px solid rgba(216, 255, 232, 0.9);
            background: rgba(124, 255, 178, 1);
            color: #061024;
            font-weight: 800;
            cursor: pointer;
          ">Generate AI Maze</button>
        </div>

        <div data-ai="status" style="
          margin-top: 10px;
          font-size: 12px;
          white-space: pre-wrap;
          line-height: 1.35;
          color: #9fb4d6;
          min-height: 16px;
        "></div>
      </div>
    `;

    this.dom = scene.add.dom(0, 0).createFromHTML(html);
    this.dom.setDepth(4000);
    this.dom.setScrollFactor(0);
    this.dom.setOrigin(0, 0);

    this.root = this.dom.node as HTMLDivElement;
    this.statusEl = this.root.querySelector('[data-ai="status"]') as HTMLDivElement | null ?? undefined;
    this.keywordsEl = this.root.querySelector('[data-ai="keywords"]') as HTMLInputElement | null ?? undefined;
    this.difficultyEl = this.root.querySelector('[data-ai="difficulty"]') as HTMLSelectElement | null ?? undefined;
    this.buttonEl = this.root.querySelector('[data-ai="generate"]') as HTMLButtonElement | null ?? undefined;

    this.buttonEl?.addEventListener("click", () => void this.handleGenerate());
  }

  setVisible(visible: boolean): this {
    this.dom?.setVisible(visible);
    if (!visible) this.blurInputs();
    return this;
  }

  getVisible(): boolean {
    return Boolean(this.dom?.visible);
  }

  layout(viewWidth: number, _viewHeight: number): void {
    const margin = 14;
    const x = Math.max(margin, viewWidth - margin - 320);
    const y = margin;
    this.dom?.setPosition(x, y);
  }

  destroy(): void {
    this.dom?.destroy();
    this.dom = undefined;
    this.root = undefined;
  }

  private setStatus(text: string, tone: "info" | "ok" | "error" = "info"): void {
    if (!this.statusEl) return;
    const color = tone === "ok" ? "#7CFFB2" : tone === "error" ? "#ffd7d7" : "#9fb4d6";
    this.statusEl.style.color = color;
    this.statusEl.textContent = text;
  }

  private setBusy(busy: boolean): void {
    if (!this.buttonEl) return;
    this.buttonEl.disabled = busy;
    this.buttonEl.style.opacity = busy ? "0.75" : "1";
    this.buttonEl.style.cursor = busy ? "progress" : "pointer";
  }

  private blurInputs(): void {
    const active = document.activeElement;
    if (!active || !this.root) return;
    if (this.root.contains(active)) (active as HTMLElement).blur();
  }

  private async handleGenerate(): Promise<void> {
    const keywords = (this.keywordsEl?.value ?? "").trim();
    const difficulty = (this.difficultyEl?.value ?? "normal") as Difficulty;

    this.setBusy(true);
    this.setStatus("Generating level (local stub)…", "info");
    try {
      const result = await this.onGenerate(keywords, difficulty);
      if (result.ok) {
        this.setStatus("Level OK. Starting…", "ok");
      } else {
        this.setStatus(["Validation failed:", "", ...result.errors].join("\n"), "error");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.setStatus(`Generate failed: ${message}`, "error");
    } finally {
      this.setBusy(false);
    }
  }
}
