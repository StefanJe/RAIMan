import Phaser from "phaser";
import { buildVibeShareUrl, getAppConfig, getEffectiveSeed, initAppConfigFromUrl, setGameMode } from "../game/appConfig";
import type { Difficulty } from "../game/settings";
import { getSettings, setDifficulty } from "../game/settings";
import { setBackgroundMusic } from "../game/backgroundMusic";
import { ROTATE_TRACK_ID, getMusicTracks } from "../game/musicTracks";
import type { GeneratedLevelEntry } from "../game/userPrefs";
import { addGeneratedLevel, getUserPrefs, removeGeneratedLevel, updateUserPrefs } from "../game/userPrefs";
import { generateLevel } from "../ai/aiLevelClient";
import { validateLevel } from "../game/levelValidation";

export class SettingsScene extends Phaser.Scene {
  private dom?: Phaser.GameObjects.DOMElement;
  private viewportEl?: HTMLDivElement;
  private root?: HTMLDivElement;
  private statusEl?: HTMLDivElement;
  private usernameEl?: HTMLInputElement;
  private soundEl?: HTMLInputElement;
  private musicEnabledEl?: HTMLInputElement;
  private musicEl?: HTMLSelectElement;
  private modeEl?: HTMLSelectElement;
  private gameDifficultyEl?: HTMLSelectElement;
  private mobileLayoutEl?: HTMLSelectElement;
  private viewModeEl?: HTMLSelectElement;
  private aiModeEl?: HTMLInputElement;
  private seedEl?: HTMLDivElement;
  private shareEl?: HTMLButtonElement;
  private genWrapEl?: HTMLDivElement;
  private keywordsEl?: HTMLInputElement;
  private difficultyEl?: HTMLSelectElement;
  private generateEl?: HTMLButtonElement;
  private listWrapEl?: HTMLDivElement;
  private listEl?: HTMLDivElement;
  private infoEl?: HTMLButtonElement;
  private backEl?: HTMLButtonElement;

  constructor() {
    super({ key: "SettingsScene" });
  }

  private syncGameDifficultyFromStorage(): void {
    if (this.gameDifficultyEl) this.gameDifficultyEl.value = getSettings().difficulty;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0b1020);

    // Ensure config exists (in case Settings is entered directly).
    const prefs = getUserPrefs();

    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    const hasModeParam = params.has("mode");

    initAppConfigFromUrl(search);
    if (!hasModeParam) {
      setGameMode(prefs.preferredMode === "vibe" ? "vibe" : "classic");
    }

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
            <div style="font-size:22px; font-weight:900; letter-spacing:0.2px;">Settings</div>
            <div style="font-size:12px; opacity:0.75; margin-top:2px;">Alles lokal gespeichert (Browser).</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button data-s="info" style="
              padding: 10px 12px;
              border-radius: 12px;
              border: 1px solid rgba(159, 180, 214, 0.45);
              background: rgba(5, 10, 24, 0.65);
              color: #e6f0ff;
              font-weight: 800;
              cursor: pointer;
            ">Info</button>
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
        </div>

        <div style="height:1px; background: rgba(159,180,214,0.18); margin: 12px 0;"></div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="padding:12px; border-radius:14px; background: rgba(5, 10, 24, 0.55); border:1px solid rgba(159,180,214,0.18);">
            <div style="font-weight:800; margin-bottom:8px;">Spiel</div>

            <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Spielmodus</label>
            <select data-s="mode" style="
              width: 100%;
              box-sizing: border-box;
              padding: 10px 10px;
              border-radius: 10px;
              border: 1px solid rgba(159, 180, 214, 0.35);
              background: rgba(5, 10, 24, 0.9);
              color: #e6f0ff;
              outline: none;
            ">
              <option value="normal">normal</option>
              <option value="vibe">vibe</option>
            </select>

            <label style="display:block; font-size:12px; opacity:0.85; margin:10px 0 4px;">Schwierigkeit</label>
            <select data-s="gameDifficulty" style="
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

            <label style="display:block; font-size:12px; opacity:0.85; margin:10px 0 4px;">Mobile Layout</label>
            <select data-s="mobileLayout" style="
              width: 100%;
              box-sizing: border-box;
              padding: 10px 10px;
              border-radius: 10px;
              border: 1px solid rgba(159, 180, 214, 0.35);
              background: rgba(5, 10, 24, 0.9);
              color: #e6f0ff;
              outline: none;
            ">
              <option value="off">aus</option>
              <option value="auto" selected>auto</option>
              <option value="on">an</option>
            </select>

            <label style="display:block; font-size:12px; opacity:0.85; margin:10px 0 4px;">Ansicht</label>
            <select data-s="viewMode" style="
              width: 100%;
              box-sizing: border-box;
              padding: 10px 10px;
              border-radius: 10px;
              border: 1px solid rgba(159, 180, 214, 0.35);
              background: rgba(5, 10, 24, 0.9);
              color: #e6f0ff;
              outline: none;
            ">
              <option value="topdown">Top-Down</option>
              <option value="fps">FPS</option>
            </select>

            <div data-s="seedWrap" style="margin-top:10px; display:none;">
              <div data-s="seed" style="font-size:12px; opacity:0.8;"></div>
              <button data-s="share" style="
                margin-top:6px;
                padding: 8px 10px;
                border-radius: 12px;
                border: 1px solid rgba(216, 255, 232, 0.9);
                background: rgba(124, 255, 178, 1);
                color: #061024;
                font-weight: 900;
                cursor: pointer;
              ">Seed-Link kopieren</button>
            </div>
          </div>

          <div style="padding:12px; border-radius:14px; background: rgba(5, 10, 24, 0.55); border:1px solid rgba(159,180,214,0.18);">
            <div style="font-weight:800; margin-bottom:8px;">Profil</div>

            <label style="display:flex; gap:10px; align-items:center; font-size:14px; margin-bottom:10px;">
              <input data-s="sound" type="checkbox" />
              <span>Game-Sounds an</span>
            </label>

            <label style="display:flex; gap:10px; align-items:center; font-size:14px; margin-bottom:10px;">
              <input data-s="musicEnabled" type="checkbox" />
              <span>Song an</span>
            </label>

            <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Song</label>
            <select data-s="music" style="
              width: 100%;
              box-sizing: border-box;
              padding: 10px 10px;
              border-radius: 10px;
              border: 1px solid rgba(159, 180, 214, 0.35);
              background: rgba(5, 10, 24, 0.9);
              color: #e6f0ff;
              outline: none;
              margin-bottom: 10px;
            ">
              <option value="">(keiner)</option>
              <option value="${ROTATE_TRACK_ID}">rotieren</option>
            </select>

            <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Nutzer</label>
            <input data-s="username" autocomplete="off" placeholder="z.B. Alex" style="
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
        </div>

        <div style="height:1px; background: rgba(159,180,214,0.18); margin: 12px 0;"></div>

        <div style="padding:12px; border-radius:14px; background: rgba(5, 10, 24, 0.55); border:1px solid rgba(159,180,214,0.18);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div style="font-weight:800;">AI Mode</div>
              <div style="font-size:12px; opacity:0.75; margin-top:2px;">Neue, lokal generierte Spielfelder erstellen.</div>
            </div>
            <label style="display:flex; gap:10px; align-items:center; font-size:14px;">
              <input data-s="aiMode" type="checkbox" />
              <span>aktiv</span>
            </label>
          </div>

          <div data-s="genWrap" style="margin-top:12px; display:none;">
            <div style="display:grid; grid-template-columns: 1fr 160px 170px; gap:10px; align-items:end;">
              <div>
                <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Keywords</label>
                <input data-s="keywords" autocomplete="off" placeholder="z.B. spooky, neon, tight" style="
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
              <div>
                <label style="display:block; font-size:12px; opacity:0.85; margin-bottom:4px;">Difficulty</label>
                <select data-s="difficulty" style="
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
              <button data-s="generate" style="
                padding: 11px 10px;
                border-radius: 12px;
                border: 1px solid rgba(216, 255, 232, 0.9);
                background: rgba(124, 255, 178, 1);
                color: #061024;
                font-weight: 900;
                cursor: pointer;
              ">Generieren</button>
            </div>
          </div>

          <div data-s="status" style="
            margin-top: 10px;
            font-size: 12px;
            white-space: pre-wrap;
            line-height: 1.35;
            color: #9fb4d6;
            min-height: 16px;
          "></div>

          <div style="margin-top:10px;">
            <div style="font-weight:800; margin-bottom:8px;">Generierte Spielfelder</div>
            <div data-s="listWrap" style="
              max-height: 260px;
              overflow-y: auto;
              overflow-x: hidden;
              -webkit-overflow-scrolling: touch;
              overscroll-behavior: contain;
              padding-right: 4px;
            ">
              <div data-s="list" style="display:flex; flex-direction:column; gap:8px;"></div>
            </div>
          </div>
        </div>
      </div>
      </div>
    `;

    this.dom = this.add.dom(0, 0).createFromHTML(html);
    this.dom.setDepth(4000);
    this.dom.setScrollFactor(0);
    this.dom.setOrigin(0, 0);
    this.dom.setPosition(0, 0);

    this.viewportEl = this.dom.node as HTMLDivElement;
    // Phaser sets DOMElement nodes to `display:inline` by default; force block for scrolling + sizing.
    this.viewportEl.style.display = "block";
    this.viewportEl.style.boxSizing = "border-box";

    this.root = (this.viewportEl.querySelector('[data-s="panel"]') as HTMLDivElement | null) ?? undefined;
    if (!this.root) return;

    this.statusEl = (this.root.querySelector('[data-s="status"]') as HTMLDivElement | null) ?? undefined;
    this.usernameEl = (this.root.querySelector('[data-s="username"]') as HTMLInputElement | null) ?? undefined;
    this.soundEl = (this.root.querySelector('[data-s="sound"]') as HTMLInputElement | null) ?? undefined;
    this.musicEnabledEl = (this.root.querySelector('[data-s="musicEnabled"]') as HTMLInputElement | null) ?? undefined;
    this.musicEl = (this.root.querySelector('[data-s="music"]') as HTMLSelectElement | null) ?? undefined;
    this.modeEl = (this.root.querySelector('[data-s="mode"]') as HTMLSelectElement | null) ?? undefined;
    this.gameDifficultyEl = (this.root.querySelector('[data-s="gameDifficulty"]') as HTMLSelectElement | null) ?? undefined;
    this.mobileLayoutEl = (this.root.querySelector('[data-s="mobileLayout"]') as HTMLSelectElement | null) ?? undefined;
    this.viewModeEl = (this.root.querySelector('[data-s="viewMode"]') as HTMLSelectElement | null) ?? undefined;
    this.aiModeEl = (this.root.querySelector('[data-s="aiMode"]') as HTMLInputElement | null) ?? undefined;
    this.seedEl = (this.root.querySelector('[data-s="seed"]') as HTMLDivElement | null) ?? undefined;
    this.shareEl = (this.root.querySelector('[data-s="share"]') as HTMLButtonElement | null) ?? undefined;
    this.genWrapEl = (this.root.querySelector('[data-s="genWrap"]') as HTMLDivElement | null) ?? undefined;
    this.keywordsEl = (this.root.querySelector('[data-s="keywords"]') as HTMLInputElement | null) ?? undefined;
    this.difficultyEl = (this.root.querySelector('[data-s="difficulty"]') as HTMLSelectElement | null) ?? undefined;
    this.generateEl = (this.root.querySelector('[data-s="generate"]') as HTMLButtonElement | null) ?? undefined;
    this.listWrapEl = (this.root.querySelector('[data-s="listWrap"]') as HTMLDivElement | null) ?? undefined;
    this.listEl = (this.root.querySelector('[data-s="list"]') as HTMLDivElement | null) ?? undefined;
    this.backEl = (this.root.querySelector('[data-s="back"]') as HTMLButtonElement | null) ?? undefined;
    this.infoEl = (this.root.querySelector('[data-s="info"]') as HTMLButtonElement | null) ?? undefined;

    // Let the settings panel scroll without the Phaser canvas eating wheel/touch events.
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

    // Init fields.
    this.usernameEl && (this.usernameEl.value = prefs.username);
    this.soundEl && (this.soundEl.checked = prefs.soundEnabled);
    this.modeEl && (this.modeEl.value = prefs.preferredMode);
    this.syncGameDifficultyFromStorage();
    this.mobileLayoutEl && (this.mobileLayoutEl.value = prefs.mobileLayout ?? "auto");
    this.viewModeEl && (this.viewModeEl.value = prefs.viewMode === "fps" ? "fps" : "topdown");
    this.initMusicSelect(prefs.musicTrackId);
    this.musicEnabledEl && (this.musicEnabledEl.checked = prefs.musicEnabled);
    this.applyMusicEnabledUi(prefs.musicEnabled);
    this.aiModeEl && (this.aiModeEl.checked = prefs.aiModeEnabled);
    this.refreshSeedUi();
    this.refreshAiUi(prefs.aiModeEnabled);
    this.renderGeneratedList(prefs.generatedLevels);
    this.applyScrollSizing(this.scale.width, this.scale.height);

    // Wire events.
    this.backEl?.addEventListener("click", () => this.scene.start("BootScene"));
    this.infoEl?.addEventListener("click", () => this.scene.start("InfoScene", { from: "SettingsScene" }));

    this.soundEl?.addEventListener("change", () => {
      const enabled = Boolean(this.soundEl?.checked);
      updateUserPrefs({ soundEnabled: enabled });
      this.setStatus(enabled ? "Game-Sounds an." : "Game-Sounds aus.", "ok");
    });

    this.musicEnabledEl?.addEventListener("change", () => {
      const enabled = Boolean(this.musicEnabledEl?.checked);
      updateUserPrefs({ musicEnabled: enabled });
      this.applyMusicEnabledUi(enabled);
      if (!enabled) {
        setBackgroundMusic(this, null);
        this.setStatus("Song aus.", "ok");
        return;
      }
      const id = (this.musicEl?.value ?? ROTATE_TRACK_ID).trim();
      setBackgroundMusic(this, id || null);
      this.setStatus(id ? "Song gestartet." : "Song an.", "ok");
    });

    this.musicEl?.addEventListener("change", () => {
      const id = (this.musicEl?.value ?? ROTATE_TRACK_ID).trim();
      updateUserPrefs({ musicTrackId: id });
      const enabled = Boolean(this.musicEnabledEl?.checked);
      if (enabled) setBackgroundMusic(this, id || null);
      this.setStatus(id ? (enabled ? "Song gestartet." : "Song gespeichert (Song aus).") : "Song: keiner.", "ok");
    });

    let usernameTimer: number | null = null;
    this.usernameEl?.addEventListener("input", () => {
      if (usernameTimer) window.clearTimeout(usernameTimer);
      usernameTimer = window.setTimeout(() => {
        usernameTimer = null;
        const username = (this.usernameEl?.value ?? "").slice(0, 48);
        updateUserPrefs({ username });
      }, 250);
    });

    this.modeEl?.addEventListener("change", () => {
      const value = (this.modeEl?.value ?? "vibe") === "normal" ? "normal" : "vibe";
      updateUserPrefs({ preferredMode: value });
      setGameMode(value === "vibe" ? "vibe" : "classic");
      this.refreshSeedUi();
      this.setStatus(value === "vibe" ? "Vibe Mode aktiv." : "Normal aktiv.", "ok");
    });

    this.gameDifficultyEl?.addEventListener("change", () => {
      const v = this.gameDifficultyEl?.value ?? "normal";
      const difficulty = (v === "easy" || v === "hard" || v === "normal" ? v : "normal") as Difficulty;
      setDifficulty(difficulty);
      this.setStatus(`Schwierigkeit: ${difficulty}`, "ok");
    });

    this.mobileLayoutEl?.addEventListener("change", () => {
      const v = (this.mobileLayoutEl?.value ?? "auto").trim();
      const mobileLayout = v === "on" ? "on" : v === "off" ? "off" : "auto";
      updateUserPrefs({ mobileLayout });
      this.setStatus(`Mobile Layout: ${mobileLayout}`, "ok");
    });

    this.viewModeEl?.addEventListener("change", () => {
      const v = (this.viewModeEl?.value ?? "topdown").trim();
      const viewMode = v === "fps" ? "fps" : "topdown";
      updateUserPrefs({ viewMode });
      this.setStatus(`Ansicht: ${viewMode === "fps" ? "FPS" : "Top-Down"}`, "ok");
    });

    this.aiModeEl?.addEventListener("change", () => {
      const enabled = Boolean(this.aiModeEl?.checked);
      updateUserPrefs({ aiModeEnabled: enabled });
      this.refreshAiUi(enabled);
      this.setStatus(enabled ? "AI Mode aktiv." : "AI Mode deaktiviert.", "ok");
    });

    this.shareEl?.addEventListener("click", () => void this.copySeedLink());
    this.generateEl?.addEventListener("click", () => void this.handleGenerate());

    // Keep in sync if Settings is kept alive while Boot changes difficulty.
    this.events.on(Phaser.Scenes.Events.WAKE, this.syncGameDifficultyFromStorage, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.syncGameDifficultyFromStorage, this);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.events.off(Phaser.Scenes.Events.WAKE, this.syncGameDifficultyFromStorage, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.syncGameDifficultyFromStorage, this);
      this.dom?.destroy();
      this.dom = undefined;
      this.root = undefined;
      this.viewportEl = undefined;
    });
  }

  private initMusicSelect(selectedId: string): void {
    if (!this.musicEl) return;
    const tracks = getMusicTracks();

    // Populate options (keep the first "(keiner)" and the "rotieren" option).
    while (this.musicEl.options.length > 2) this.musicEl.remove(2);
    for (const t of tracks) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      this.musicEl.appendChild(opt);
    }

    // Select persisted value if present.
    const id = (selectedId ?? "").trim();
    this.musicEl.value = id || ROTATE_TRACK_ID;
  }

  private applyMusicEnabledUi(enabled: boolean): void {
    if (!this.musicEl) return;
    this.musicEl.disabled = !enabled;
    this.musicEl.style.opacity = enabled ? "1" : "0.6";
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.applyScrollSizing(gameSize.width, gameSize.height);
  }

  private applyScrollSizing(viewWidth: number, viewHeight: number): void {
    if (!this.viewportEl || !this.root) return;
    const w = Math.max(280, Math.floor(viewWidth));
    const h = Math.max(240, Math.floor(viewHeight));
    this.viewportEl.style.width = `${w}px`;
    this.viewportEl.style.height = `${h}px`;

    const panelW = Math.max(280, Math.min(740, Math.floor(viewWidth - 28)));
    this.root.style.width = `${panelW}px`;

    // Let the list grow but remain scrollable inside the panel.
    if (this.listWrapEl) {
      const listMax = Math.max(220, Math.floor(viewHeight * 0.35));
      this.listWrapEl.style.maxHeight = `${listMax}px`;
    }

    // Keep Phaser's internal DOMElement size in sync with our computed styles.
    this.dom?.updateSize();
  }

  private setStatus(text: string, tone: "info" | "ok" | "error" = "info"): void {
    if (!this.statusEl) return;
    const color = tone === "ok" ? "#7CFFB2" : tone === "error" ? "#ffd7d7" : "#9fb4d6";
    this.statusEl.style.color = color;
    this.statusEl.textContent = text;
  }

  private refreshAiUi(enabled: boolean): void {
    if (this.genWrapEl) this.genWrapEl.style.display = enabled ? "block" : "none";
  }

  private refreshSeedUi(): void {
    const cfg = getAppConfig();
    const wrap = this.root?.querySelector('[data-s="seedWrap"]') as HTMLDivElement | null;
    if (!wrap || !this.seedEl) return;
    if (cfg.mode !== "vibe") {
      wrap.style.display = "none";
      return;
    }
    const seed = getEffectiveSeed(cfg);
    this.seedEl.textContent = `Seed: ${seed}`;
    wrap.style.display = "block";
  }

  private async copySeedLink(): Promise<void> {
    const cfg = getAppConfig();
    if (cfg.mode !== "vibe") return;
    const seed = getEffectiveSeed(cfg);
    const url = buildVibeShareUrl(seed);

    const tryClipboard = async (): Promise<boolean> => {
      try {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        return false;
      }
    };

    const ok = await tryClipboard();
    if (ok) {
      this.setStatus("Seed-Link kopiert.", "ok");
      return;
    }
    window.prompt("Copy this URL to share Vibe Mode:", url);
  }

  private renderGeneratedList(entries: GeneratedLevelEntry[]): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.7";
      empty.style.fontSize = "12px";
      empty.textContent = "Noch keine generierten Spielfelder.";
      this.listEl.appendChild(empty);
      return;
    }

    for (const e of entries) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.padding = "10px 10px";
      row.style.borderRadius = "12px";
      row.style.border = "1px solid rgba(159,180,214,0.22)";
      row.style.background = "rgba(11, 16, 32, 0.55)";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "2px";
      const title = document.createElement("div");
      title.style.fontWeight = "800";
      title.style.fontSize = "13px";
      title.textContent = e.level.id ?? "AI Level";
      const meta = document.createElement("div");
      meta.style.fontSize = "12px";
      meta.style.opacity = "0.75";
      meta.textContent = `${e.difficulty} \u2022 ${new Date(e.createdAtMs).toLocaleString()} \u2022 ${e.keywords || "no keywords"}`;
      left.appendChild(title);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";

      const play = document.createElement("button");
      play.textContent = "Spielen";
      play.style.padding = "9px 10px";
      play.style.borderRadius = "12px";
      play.style.border = "1px solid rgba(216, 255, 232, 0.9)";
      play.style.background = "rgba(124, 255, 178, 1)";
      play.style.color = "#061024";
      play.style.fontWeight = "900";
      play.style.cursor = "pointer";

      const del = document.createElement("button");
      del.textContent = "L\u00f6schen";
      del.style.padding = "9px 10px";
      del.style.borderRadius = "12px";
      del.style.border = "1px solid rgba(159,180,214,0.45)";
      del.style.background = "rgba(31, 58, 102, 0.85)";
      del.style.color = "#e6f0ff";
      del.style.fontWeight = "800";
      del.style.cursor = "pointer";

      play.addEventListener("click", () => {
        const cfg = getAppConfig();
        const settings = setDifficulty(e.difficulty);
        this.scene.start("GameScene", { settings, levelJson: e.level, mode: cfg.mode, seed: cfg.seed, vibeSettings: cfg.vibe });
      });
      del.addEventListener("click", () => {
        const next = removeGeneratedLevel(e.id);
        this.renderGeneratedList(next.generatedLevels);
        this.setStatus("Level gel\u00f6scht.", "ok");
      });

      right.appendChild(play);
      right.appendChild(del);

      row.appendChild(left);
      row.appendChild(right);
      this.listEl.appendChild(row);
    }
  }

  private setGenerateBusy(busy: boolean): void {
    if (!this.generateEl) return;
    this.generateEl.disabled = busy;
    this.generateEl.style.opacity = busy ? "0.75" : "1";
    this.generateEl.style.cursor = busy ? "progress" : "pointer";
  }

  private async handleGenerate(): Promise<void> {
    const prefs = getUserPrefs();
    if (!prefs.aiModeEnabled) {
      this.setStatus("AI Mode ist deaktiviert.", "error");
      return;
    }

    const keywords = (this.keywordsEl?.value ?? "").trim();
    const difficulty = (this.difficultyEl?.value ?? getSettings().difficulty) as Difficulty;

    this.setGenerateBusy(true);
    this.setStatus("Generiere Level (lokal)\u2026", "info");
    try {
      const level = await generateLevel({ keywords, difficulty });
      const validation = validateLevel(level);
      if (!validation.ok) {
        this.setStatus(["Validation failed:", "", ...validation.errors].join("\n"), "error");
        return;
      }
      const next = addGeneratedLevel({ level, keywords, difficulty });
      this.renderGeneratedList(next.generatedLevels);
      this.setStatus("Level gespeichert. Du kannst es jetzt spielen.", "ok");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.setStatus(`Generate failed: ${message}`, "error");
    } finally {
      this.setGenerateBusy(false);
    }
  }
}
