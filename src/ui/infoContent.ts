export interface InfoSection {
  title: string;
  body: string[];
}

export const INFO_SECTIONS: InfoSection[] = [
  {
    title: "Über RAI-Man",
    body: [
      "RAI-Man wurde von Stefan Jeker unter Einsatz von Vibe Coding (Codex) in seiner Freizeit entwickelt und zur Freude verteilt.",
      "Der speziell entwickelte Vibe Mode steht für den Challenge, wenn Change passiert - in dem Sinn viel Erfolg in einem wechselnden Umfeld ;-)."
    ]
  },
  {
    title: "Ziel",
    body: [
      "Sammle alle Pellets (Punkte) im Labyrinth, weiche den Geistern Blinky, Pinky, Inky und Clyde aus und nutze Power-Pellets, Bomben und Früchte clever.",
      "In der Kampagne spielst du Level nacheinander; am Ende wartet eine Celebration. Die höchsten Punkte werden von Stefan auch honoriert (falls er rausfindet wers war ;-))."
    ]
  },
  {
    title: "Modi: Classic vs. Vibe",
    body: [
      "Classic: Klassisches Gameplay ohne dynamische Umbauten.",
      "Vibe: Das Maze kann sich während des Spiels leicht verändern (Reorg Shifts). Zusätzlich gibt es kleine \"Patch Notes\" Hinweise.",
      "Der Modus wird in den Einstellungen gewählt und kann per Seed deterministisch sein.",
      "Zusätzlich gibt es auch die Möglichkeit den FPS Modus zu aktivieren (First Person) um in der Ego Perspektive den RAI-Man zu steuern."
    ]
  },
  {
    title: "Steuerung",
    body: [
      "Bewegen: Pfeiltasten oder W/A/S/D",
      "Bombe legen: Leertaste (Space)",
      "Touch/Mobile: D-Pad + Bomben-Button (auch Swipen funktioniert für Bewegung)."
    ]
  },
  {
    title: "Items & Punkte",
    body: [
      "Pellets: geben Punkte und müssen für den Levelabschluss eingesammelt werden.",
      "Power-Pellets: machen Geister kurzzeitig verwundbar (du kannst sie fressen).",
      "Bomben: sammeln, ablegen und Kisten sprengen",
      "Kisten: können mit Bomben entfernt werden und enthalten Power-Pellets",
      "Früchte: geben Sonderpunkte."
    ]
  },
  {
    title: "Einstellungen",
    body: [
      "Game-Sounds: aktiviert/deaktiviert Soundeffekte im Spiel.",
      "Song: separater Schalter + Auswahl (inkl. Rotation).",
      "Nutzername: wird für Highscores verwendet."
    ]
  },
  {
    title: "Level Generator (AI Mode)",
    body: [
      "Im AI Mode kannst du lokal neue Spielfelder generieren (Keywords + Difficulty).",
      "Generierte Felder erscheinen in der Liste und können direkt gespielt oder gelöscht werden."
    ]
  },
  {
    title: "Highscores",
    body: [
      "Nach Game Over (alle Leben verbraucht) oder nach dem Ende der Kampagne kannst du den Score ins globale Leaderboard eintragen."
    ]
  },
  {
    title: "Vibe Coding",
    body: [
      "Seit Erscheinung von ChatGPT ist natürlich auch immer die Vision da gewesen Code schreiben zu können. Noch letztes Jahr (2024) habe ich den Versuch kläglich abgebrochen. Dieses Jahr nun keine Zeile Code selber geschrieben und in einem Coding Umfeld gearbeitet (Visual Studio Code mit CODEX von OpenAI). WOW - Aber 3000 Files wurden erstellt. Die Erfahrung ist sehr eindrucksvoll. Empfehlung ist Schritt für Schritt vorzugehen, dann finden kaum Halluzinationen statt und der Code, als auch die Funktionen sind sehr solide. Also ich bin begeistert!"
    ]
  }
];
