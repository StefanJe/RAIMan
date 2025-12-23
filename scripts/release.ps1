param(
  [switch]$NoBuild,
  [switch]$Zip,
  [string]$ZipOut
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$release = Join-Path $root "release/public_html"

if (!(Test-Path $release)) {
  throw "Missing release folder: $release"
}

if (!$NoBuild) {
  Write-Host "Building (vite)..." -ForegroundColor Cyan
  npm run build
}

if (!(Test-Path $dist)) {
  throw "Missing dist folder: $dist (run build first)"
}

Write-Host "Syncing dist -> release/public_html ..." -ForegroundColor Cyan

Copy-Item (Join-Path $dist "index.html") (Join-Path $release "index.html") -Force
Copy-Item (Join-Path $dist "favicon.ico") (Join-Path $release "favicon.ico") -Force

$releaseAssets = Join-Path $release "assets"
if (!(Test-Path $releaseAssets)) { New-Item -ItemType Directory -Path $releaseAssets | Out-Null }
Remove-Item (Join-Path $releaseAssets "*") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $dist "assets/*") $releaseAssets -Recurse -Force

Write-Host "Syncing api/highscore.php -> release/public_html/api/highscore.php ..." -ForegroundColor Cyan
$releaseApi = Join-Path $release "api"
if (!(Test-Path $releaseApi)) { New-Item -ItemType Directory -Path $releaseApi | Out-Null }
Copy-Item (Join-Path $root "api/highscore.php") (Join-Path $releaseApi "highscore.php") -Force

# Do NOT overwrite live data files (highscores.json, ratelimit.json).
# We only keep docs in sync.
$releaseData = Join-Path $release "data"
if (!(Test-Path $releaseData)) { New-Item -ItemType Directory -Path $releaseData | Out-Null }
if (Test-Path (Join-Path $root "data/.htaccess")) {
  Copy-Item (Join-Path $root "data/.htaccess") (Join-Path $releaseData ".htaccess") -Force
}
if (Test-Path (Join-Path $root "data/README.md")) {
  Copy-Item (Join-Path $root "data/README.md") (Join-Path $releaseData "README.md") -Force
}

if ($Zip) {
  $zipDir = Join-Path $root "release"
  $ts = Get-Date -Format "yyyyMMdd_HHmm"
  $zipPath =
    if ([string]::IsNullOrWhiteSpace($ZipOut)) {
      Join-Path $zipDir "RAI-Man_public_html_$ts.zip"
    } else {
      $ZipOut
    }

  Write-Host "Creating zip: $zipPath ..." -ForegroundColor Cyan
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path $release -DestinationPath $zipPath -Force
}

Write-Host "Done." -ForegroundColor Green
