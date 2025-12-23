# Release / Deploy Notes

## Lokaler Release-Ordner

`release/public_html/` ist als **Upload-Ordner** gedacht (z.B. per FTP/SFTP auf Hostpoint).

Enthalten:
- `index.html`, `favicon.ico`, `assets/*` (Build Output aus `dist/`)
- `api/highscore.php` (Server Endpoint)
- `data/` (nur README; live JSON-Dateien entstehen/ändern sich auf dem Server)

Wichtig: Vor dem Deploy `HIGHSCORE_SALT` als Umgebungsvariable setzen (siehe `api/highscore.php`).

## Build + Release Sync

PowerShell Script:

`scripts/release.ps1`

- Standard: baut und synchronisiert danach nach `release/public_html/`
- Optional: `scripts/release.ps1 -NoBuild` synchronisiert nur (wenn du schon gebaut hast)
- Optional: `scripts/release.ps1 -Zip` erstellt zusätzlich ein ZIP-Artifact (für Upload/Deploy)

## Server Upload Hinweis (wichtig)

Wenn du nur "drüber kopierst", können alte `assets/index-*.js` Dateien auf dem Server liegen bleiben.
Empfohlen:
- Auf dem Server den Ordner `assets/` vorher löschen **oder**
- Einen "mirror" Upload benutzen (löscht entfernte Files, die lokal nicht mehr existieren).
