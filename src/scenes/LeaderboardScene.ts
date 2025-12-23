import Phaser from "phaser";
import type { HighscoreMode, HighscoreModeFilter, HighscoreScope } from "../game/highscoreApi";
import { listHighscores, sanitizeHighscoreName, submitHighscore } from "../game/highscoreApi";
import { addLocalHighscore, listLocalHighscores } from "../game/highscoreOffline";
import { getAppConfig, getEffectiveSeed } from "../game/appConfig";
import { getUserPrefs, updateUserPrefs } from "../game/userPrefs";

interface SubmitContext {
  mode: HighscoreMode;
  seed: string | null;
  score: number;
  durationMs: number;
  defaultName: string;
  meta?: Record<string, unknown>;
}

interface LeaderboardSceneData {
  mode?: HighscoreModeFilter;
  scope?: HighscoreScope;
  seed?: string | null;
  submit?: SubmitContext | null;
  backTo?: { scene: string; data?: Record<string, unknown> } | null;
  returnAfterSubmit?: boolean;
}

export class LeaderboardScene extends Phaser.Scene {
  private dom?: Phaser.GameObjects.DOMElement;
  private viewportEl?: HTMLDivElement;
  private root?: HTMLDivElement;
  private statusEl?: HTMLDivElement;
  private offlineBadgeEl?: HTMLDivElement;
  private listEl?: HTMLDivElement;
  private backEl?: HTMLButtonElement;

  private scopeAllEl?: HTMLButtonElement;
  private scopeDailyEl?: HTMLButtonElement;
  private modeAllEl?: HTMLButtonElement;
  private modeClassicEl?: HTMLButtonElement;
  private modeVibeEl?: HTMLButtonElement;

  private submitWrapEl?: HTMLDivElement;
  private submitInfoEl?: HTMLDivElement;
  private submitNameEl?: HTMLInputElement;
  private submitBtnEl?: HTMLButtonElement;

  private scope: HighscoreScope = "all";
  private mode: HighscoreModeFilter = "all";
  private seed: string | null = null;
  private submitContext: SubmitContext | null = null;
  private backTo: { scene: string; data?: Record<string, unknown> } | null = null;
  private returnAfterSubmit = false;

  private highlightId: string | null = null;
  private highlightRank: number | null = null;

  constructor() {
    super({ key: "LeaderboardScene" });
  }

  create(data?: LeaderboardSceneData): void {
    this.cameras.main.setBackgroundColor(0x0b1020);

    const prefs = getUserPrefs();

    // Allow typing in DOM inputs (W/A/S/D etc.) without Phaser preventing default.
    this.input.keyboard?.disableGlobalCapture();

    this.scope = data?.scope ?? "all";
    this.mode = data?.mode ?? "all";
    const cfg = getAppConfig();
    const effectiveSeed = cfg.mode === "vibe" ? getEffectiveSeed(cfg) : null;
    this.seed = data?.seed ?? effectiveSeed;
    this.submitContext = data?.submit ?? null;
    this.backTo = data?.backTo ?? null;
    this.returnAfterSubmit = Boolean(data?.returnAfterSubmit);
    this.highlightId = null;
    this.highlightRank = null;

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
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="font-size:22px; font-weight:900; letter-spacing:0.2px;">Leaderboard</div>
              <div data-s="offlineBadge" style="
                display:none;
                font-size:11px;
                padding: 4px 8px;
                border-radius: 999px;
                background: rgba(255, 211, 106, 0.95);
                color: #061024;
                font-weight: 900;
              ">offline</div>
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

          <div style="height:1px; background: rgba(159,180,214,0.18); margin: 12px 0;"></div>

          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <div style="display:flex; gap:6px; align-items:center; padding:6px; border-radius: 12px; background: rgba(5, 10, 24, 0.55); border:1px solid rgba(159,180,214,0.18);">
                <button data-s="scopeAll" style="padding:6px 10px; border-radius: 10px; border:1px solid rgba(159,180,214,0.22); background: rgba(31, 58, 102, 0.7); color:#e6f0ff; font-weight:800; cursor:pointer;">All-time</button>
                <button data-s="scopeDaily" style="padding:6px 10px; border-radius: 10px; border:1px solid rgba(159,180,214,0.22); background: rgba(11, 16, 32, 0.55); color:#e6f0ff; font-weight:800; cursor:pointer;">Daily</button>
              </div>
              <div style="display:flex; gap:6px; align-items:center; padding:6px; border-radius: 12px; background: rgba(5, 10, 24, 0.55); border:1px solid rgba(159,180,214,0.18);">
                <button data-s="modeAll" style="padding:6px 10px; border-radius: 10px; border:1px solid rgba(159,180,214,0.22); background: rgba(31, 58, 102, 0.7); color:#e6f0ff; font-weight:800; cursor:pointer;">All</button>
                <button data-s="modeClassic" style="padding:6px 10px; border-radius: 10px; border:1px solid rgba(159,180,214,0.22); background: rgba(11, 16, 32, 0.55); color:#e6f0ff; font-weight:800; cursor:pointer;">Classic</button>
                <button data-s="modeVibe" style="padding:6px 10px; border-radius: 10px; border:1px solid rgba(159,180,214,0.22); background: rgba(11, 16, 32, 0.55); color:#e6f0ff; font-weight:800; cursor:pointer;">Vibe</button>
              </div>
            </div>
          </div>

          <div data-s="submitWrap" style="
            display:none;
            margin-top: 10px;
            padding: 12px 12px;
            border-radius: 14px;
            background: rgba(5, 10, 24, 0.55);
            border: 1px solid rgba(159,180,214,0.18);
          ">
            <div data-s="submitInfo" style="font-weight:900; margin-bottom:8px;"></div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:end;">
              <div style="flex:1; min-width: 240px;">
                <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Name</label>
                <input data-s="submitName" autocomplete="off" maxlength="16" placeholder="Dein Name" style="
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
              <button data-s="submitBtn" style="
                width: 180px;
                padding: 11px 10px;
                border-radius: 12px;
                border: 1px solid rgba(216, 255, 232, 0.9);
                background: rgba(124, 255, 178, 1);
                color: #061024;
                font-weight: 900;
                cursor: pointer;
              ">Submit</button>
            </div>
            <div style="font-size:12px; opacity:0.7; margin-top:6px;">1–16 Zeichen. Keine Emails. Kein HTML.</div>
          </div>

          <div data-s="status" style="min-height: 16px; margin-top: 10px; font-size: 12px; color: #9fb4d6; white-space: pre-wrap;"></div>

          <div style="
            margin-top: 10px;
            padding: 10px 10px;
            border-radius: 14px;
            background: rgba(5, 10, 24, 0.55);
            border: 1px solid rgba(159,180,214,0.18);
          ">
            <div style="display:flex; gap:10px; padding: 6px 8px; font-size:12px; opacity:0.75;">
              <div style="width: 40px;">#</div>
              <div style="flex: 1;">Name</div>
              <div style="width: 110px; text-align:right;">Score</div>
              <div style="width: 90px; text-align:right;">Time</div>
            </div>
            <div data-s="list"></div>
          </div>
        </div>
      </div>
    `;

    this.dom?.destroy();
    this.dom = this.add.dom(0, 0).createFromHTML(html);
    this.dom.setDepth(6000);
    this.dom.setScrollFactor(0);
    this.dom.setOrigin(0, 0);
    this.dom.setPosition(0, 0);

    const root = this.dom.node as HTMLDivElement;
    this.viewportEl = root;
    this.viewportEl.style.display = "block";
    this.viewportEl.style.boxSizing = "border-box";
    this.root = root.querySelector('[data-s="panel"]') as HTMLDivElement | null ?? undefined;
    this.statusEl = root.querySelector('[data-s="status"]') as HTMLDivElement | null ?? undefined;
    this.offlineBadgeEl = root.querySelector('[data-s="offlineBadge"]') as HTMLDivElement | null ?? undefined;
    this.listEl = root.querySelector('[data-s="list"]') as HTMLDivElement | null ?? undefined;
    this.backEl = root.querySelector('[data-s="back"]') as HTMLButtonElement | null ?? undefined;

    this.scopeAllEl = root.querySelector('[data-s="scopeAll"]') as HTMLButtonElement | null ?? undefined;
    this.scopeDailyEl = root.querySelector('[data-s="scopeDaily"]') as HTMLButtonElement | null ?? undefined;
    this.modeAllEl = root.querySelector('[data-s="modeAll"]') as HTMLButtonElement | null ?? undefined;
    this.modeClassicEl = root.querySelector('[data-s="modeClassic"]') as HTMLButtonElement | null ?? undefined;
    this.modeVibeEl = root.querySelector('[data-s="modeVibe"]') as HTMLButtonElement | null ?? undefined;

    this.submitWrapEl = root.querySelector('[data-s="submitWrap"]') as HTMLDivElement | null ?? undefined;
    this.submitInfoEl = root.querySelector('[data-s="submitInfo"]') as HTMLDivElement | null ?? undefined;
    this.submitNameEl = root.querySelector('[data-s="submitName"]') as HTMLInputElement | null ?? undefined;
    this.submitBtnEl = root.querySelector('[data-s="submitBtn"]') as HTMLButtonElement | null ?? undefined;

    this.backEl?.addEventListener("click", () => {
      if (this.backTo) {
        this.scene.start(this.backTo.scene, this.backTo.data);
        return;
      }
      this.scene.start("BootScene");
    });
    this.scopeAllEl?.addEventListener("click", () => {
      this.scope = "all";
      void this.refresh();
    });
    this.scopeDailyEl?.addEventListener("click", () => {
      this.scope = "daily";
      void this.refresh();
    });
    this.modeAllEl?.addEventListener("click", () => {
      this.mode = "all";
      void this.refresh();
    });
    this.modeClassicEl?.addEventListener("click", () => {
      this.mode = "classic";
      void this.refresh();
    });
    this.modeVibeEl?.addEventListener("click", () => {
      this.mode = "vibe";
      void this.refresh();
    });

    this.submitBtnEl?.addEventListener("click", () => void this.handleSubmit());
    this.submitNameEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.handleSubmit();
    });

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

    this.updateSubmitUi();
    void this.refresh();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.input.keyboard?.enableGlobalCapture();
      this.dom?.destroy();
      this.dom = undefined;
      this.viewportEl = undefined;
      this.root = undefined;
    });

    // Ensure top scroll for fresh open.
    try {
      this.viewportEl?.scrollTo({ top: 0 });
    } catch {
      // ignore
    }

    this.handleResize(this.scale.gameSize);
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.dom?.setPosition(0, 0);
    if (!this.viewportEl) return;
    const w = Math.max(280, Math.floor(gameSize.width));
    const h = Math.max(240, Math.floor(gameSize.height));
    this.viewportEl.style.width = `${w}px`;
    this.viewportEl.style.height = `${h}px`;

    if (this.root) {
      const panelW = Math.max(280, Math.min(740, Math.floor(gameSize.width - 28)));
      this.root.style.width = `${panelW}px`;
    }

    this.dom?.updateSize();
  }

  private setStatus(text: string, tone: "info" | "ok" | "error" = "info"): void {
    if (!this.statusEl) return;
    const color = tone === "ok" ? "#7CFFB2" : tone === "error" ? "#ffd7d7" : "#9fb4d6";
    this.statusEl.style.color = color;
    this.statusEl.textContent = text;
  }

  private setOfflineBadge(offline: boolean): void {
    if (this.offlineBadgeEl) this.offlineBadgeEl.style.display = offline ? "inline-flex" : "none";
  }

  private updateToggles(): void {
    const activeBg = "rgba(124, 255, 178, 0.95)";
    const activeColor = "#061024";
    const inactiveBg = "rgba(11, 16, 32, 0.55)";
    const inactiveColor = "#e6f0ff";

    const setBtn = (btn: HTMLButtonElement | undefined, active: boolean) => {
      if (!btn) return;
      btn.style.background = active ? activeBg : inactiveBg;
      btn.style.color = active ? activeColor : inactiveColor;
      btn.style.borderColor = active ? "rgba(216,255,232,0.9)" : "rgba(159,180,214,0.22)";
    };

    setBtn(this.scopeAllEl, this.scope === "all");
    setBtn(this.scopeDailyEl, this.scope === "daily");
    setBtn(this.modeAllEl, this.mode === "all");
    setBtn(this.modeClassicEl, this.mode === "classic");
    setBtn(this.modeVibeEl, this.mode === "vibe");

  }

  private updateSubmitUi(): void {
    if (!this.submitWrapEl) return;
    const ctx = this.submitContext;
    if (!ctx) {
      this.submitWrapEl.style.display = "none";
      return;
    }
    this.submitWrapEl.style.display = "block";
    if (this.submitInfoEl) {
      const seedInfo = ctx.mode === "vibe" && ctx.seed ? ` • Seed ${ctx.seed}` : "";
      this.submitInfoEl.textContent = `Submit Score: ${ctx.score}${seedInfo}`;
    }
    if (this.submitNameEl) this.submitNameEl.value = ctx.defaultName ?? "";
    // Focus if empty (acts like "ask for name").
    if (this.submitNameEl && !this.submitNameEl.value.trim()) {
      try {
        this.submitNameEl.focus();
      } catch {
        // ignore
      }
    }
  }

  private formatDuration(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  private renderItems(items: Array<{ id: string; name: string; score: number; durationMs: number }>): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.7";
      empty.style.fontSize = "12px";
      empty.style.padding = "10px 8px";
      empty.textContent = "Noch keine Scores.";
      this.listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "10px";
      row.style.alignItems = "center";
      row.style.padding = "8px 8px";
      row.style.borderRadius = "12px";
      row.style.border = "1px solid rgba(159,180,214,0.18)";
      row.style.background = "rgba(11, 16, 32, 0.45)";
      row.style.marginBottom = "6px";

      const rank = document.createElement("div");
      rank.style.width = "40px";
      rank.style.fontWeight = "900";
      rank.style.opacity = "0.9";
      rank.textContent = String(i + 1);

      const name = document.createElement("div");
      name.style.flex = "1";
      name.style.fontWeight = "800";
      name.textContent = it.name;

      const score = document.createElement("div");
      score.style.width = "110px";
      score.style.textAlign = "right";
      score.style.fontWeight = "900";
      score.textContent = String(it.score);

      const time = document.createElement("div");
      time.style.width = "90px";
      time.style.textAlign = "right";
      time.style.opacity = "0.85";
      time.textContent = this.formatDuration(it.durationMs);

      const isHighlight = (this.highlightId && it.id === this.highlightId) || (this.highlightRank === i + 1);
      if (isHighlight) {
        row.style.borderColor = "rgba(124,255,178,0.95)";
        row.style.background = "rgba(124,255,178,0.12)";
      }

      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(score);
      row.appendChild(time);
      this.listEl.appendChild(row);
    }
  }

  private async refresh(): Promise<void> {
    this.updateToggles();
    this.setStatus("Lade…", "info");
    this.setOfflineBadge(false);

    const seed = this.scope === "daily" ? this.seed : null;
    try {
      const res = await listHighscores({ mode: this.mode, scope: this.scope, seed, limit: 10 });
      this.seed = this.scope === "daily" ? (res.seed ?? seed) : null;
      this.updateToggles();
      this.renderItems(res.items.map((it) => ({ id: it.id, name: it.name, score: it.score, durationMs: it.durationMs })));
      this.setStatus(this.highlightRank ? `Dein Rang: ${this.highlightRank}` : "", "ok");
      this.setOfflineBadge(false);
    } catch {
      const local = listLocalHighscores({ mode: this.mode, scope: this.scope, seed, limit: 10 });
      this.seed = this.scope === "daily" ? local.seed : null;
      this.updateToggles();
      this.setOfflineBadge(true);
      this.renderItems(local.items.map((it) => ({ id: it.id, name: it.name, score: it.score, durationMs: it.durationMs })));
      this.setStatus("Local leaderboard (offline).", "info");
    }
  }

  private setSubmitBusy(busy: boolean): void {
    if (!this.submitBtnEl) return;
    this.submitBtnEl.disabled = busy;
    this.submitBtnEl.style.opacity = busy ? "0.75" : "1";
    this.submitBtnEl.style.cursor = busy ? "progress" : "pointer";
  }

  private async handleSubmit(): Promise<void> {
    const ctx = this.submitContext;
    if (!ctx) return;

    const name = sanitizeHighscoreName(this.submitNameEl?.value ?? ctx.defaultName ?? "");
    if (!name) {
      this.setStatus("Bitte einen gültigen Namen (1–16 Zeichen) eingeben.", "error");
      try {
        this.submitNameEl?.focus();
        this.submitNameEl?.select();
      } catch {
        // ignore
      }
      return;
    }

    // Keep Settings in sync (nice UX).
    updateUserPrefs({ username: name });

    this.setSubmitBusy(true);
    this.setStatus("Sende…", "info");

    const payload = {
      game: "pacman" as const,
      mode: ctx.mode,
      seed: ctx.mode === "vibe" ? ctx.seed : null,
      name,
      score: Math.floor(ctx.score),
      durationMs: Math.floor(ctx.durationMs),
      meta: ctx.meta
    };

    try {
      const res = await submitHighscore(payload);
      this.highlightId = res.id;
      this.highlightRank = res.rank > 0 ? res.rank : null;
      this.submitContext = null;
      this.updateSubmitUi();
      this.mode = payload.mode;
      this.scope = "all";
      this.seed = null;
      await this.refresh();

      if (this.returnAfterSubmit && this.backTo) {
        this.setStatus("Gespeichert. Zurück.", "ok");
        this.time.delayedCall(900, () => this.scene.start(this.backTo!.scene, this.backTo!.data));
      }
    } catch {
      const local = addLocalHighscore(payload);
      this.highlightId = local.id;
      this.highlightRank = null;
      this.submitContext = null;
      this.updateSubmitUi();
      this.mode = payload.mode;
      this.scope = "all";
      this.seed = null;
      await this.refresh();

      if (this.returnAfterSubmit && this.backTo) {
        this.setStatus("Offline gespeichert. Zurück.", "info");
        this.time.delayedCall(900, () => this.scene.start(this.backTo!.scene, this.backTo!.data));
      }
    } finally {
      this.setSubmitBusy(false);
    }
  }
}
