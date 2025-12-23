<?php
declare(strict_types=1);

/**
 * File-based Highscore API for RAI-Man (no DB).
 *
 * Design goals:
 * - Simple shared leaderboard for all players (server-side persistence).
 * - Safe concurrent writes (flock + atomic rewrite).
 * - Basic abuse protection without storing raw IPs (salted hash + rate limit file).
 *
 * Endpoints:
 *  GET  /api/highscore.php?action=list&game=pacman&mode=classic|vibe|all&scope=all|daily&seed=YYYY-MM-DD(optional)&limit=10
 *  POST /api/highscore.php?action=submit (Content-Type: application/json)
 *
 * Storage:
 *  - Scores:    /data/highscores.json
 *  - RateLimit: /data/ratelimit.json
 *
 * Deploy note: set a strong `HIGHSCORE_SALT` before going live (env var preferred).
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Adjust this before deploying (used for IP hashing + id generation).
// Prefer the HIGHSCORE_SALT env var on the server.
const HIGHSCORE_SALT_FALLBACK = 'CHANGE_ME__set_a_random_salt';
const MAX_PER_GAME = 1000;
const RATE_WINDOW_SEC = 600; // 10 minutes
const RATE_MAX = 10;

function respond(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function getHighscoreSalt(): string {
  static $cached = null;
  if (is_string($cached)) return $cached;
  $env = getenv('HIGHSCORE_SALT');
  if (is_string($env)) {
    $env = trim($env);
    if ($env !== '') {
      $cached = $env;
      return $cached;
    }
  }
  $cached = HIGHSCORE_SALT_FALLBACK;
  return $cached;
}

function nowMs(): int {
  return (int) floor(microtime(true) * 1000);
}

function dataPath(string $rel): string {
  return __DIR__ . '/../data/' . $rel;
}

function ensureDataDir(): void {
  $dir = dataPath('');
  if (is_dir($dir)) return;
  @mkdir($dir, 0775, true);
}

function readJsonFile(string $path): array {
  if (!file_exists($path)) return ['v' => 1, 'items' => []];
  $raw = @file_get_contents($path);
  if ($raw === false || trim($raw) === '') return ['v' => 1, 'items' => []];
  $obj = json_decode($raw, true);
  if (!is_array($obj)) return ['v' => 1, 'items' => []];
  if (!isset($obj['items']) || !is_array($obj['items'])) $obj['items'] = [];
  if (!isset($obj['v'])) $obj['v'] = 1;
  return $obj;
}

function withLockedFile(string $path, int $lockType, callable $fn) {
  ensureDataDir();
  $fh = @fopen($path, 'c+');
  if ($fh === false) {
    respond(500, ['ok' => false, 'error' => 'storage_open_failed']);
  }
  try {
    if (!flock($fh, $lockType)) {
      respond(500, ['ok' => false, 'error' => 'storage_lock_failed']);
    }

    // Read current.
    $raw = stream_get_contents($fh);
    $obj = null;
    if ($raw !== false && trim($raw) !== '') {
      $obj = json_decode($raw, true);
    }
    if (!is_array($obj)) $obj = ['v' => 1, 'items' => []];
    if (!isset($obj['items']) || !is_array($obj['items'])) $obj['items'] = [];

    $result = $fn($obj, $fh);
    return $result;
  } finally {
    flock($fh, LOCK_UN);
    fclose($fh);
  }
}

function validateName($name): string {
  if (!is_string($name)) return '';
  $name = trim($name);
  // No emails.
  if (strpos($name, '@') !== false) return '';
  if ($name === '' || mb_strlen($name) < 1 || mb_strlen($name) > 16) return '';
  if (!preg_match('/^[A-Za-z0-9ÄÖÜäöüß _.\-]+$/u', $name)) return '';
  return $name;
}

function validateMode($mode): ?string {
  if ($mode === 'classic' || $mode === 'vibe') return $mode;
  return null;
}

function validateSeed($seed): ?string {
  if ($seed === null) return null;
  if (!is_string($seed)) return null;
  $seed = trim($seed);
  if ($seed === '') return null;
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $seed)) return null;
  return $seed;
}

function validateInt($v, int $min, int $max): ?int {
  if (is_int($v)) $n = $v;
  else if (is_float($v)) $n = (int) floor($v);
  else if (is_string($v) && preg_match('/^-?\d+$/', $v)) $n = (int) $v;
  else return null;
  if ($n < $min || $n > $max) return null;
  return $n;
}

function getClientIpHash(): string {
  $ip = $_SERVER['REMOTE_ADDR'] ?? '';
  $ip = is_string($ip) ? $ip : '';
  return sha1(getHighscoreSalt() . '|' . $ip);
}

function rateLimitCheckOrFail(): void {
  $ipHash = getClientIpHash();
  $path = dataPath('ratelimit.json');

  withLockedFile($path, LOCK_EX, function ($obj, $fh) use ($ipHash) {
    $now = time();
    $windowStart = $now - RATE_WINDOW_SEC;
    if (!isset($obj['items']) || !is_array($obj['items'])) $obj['items'] = [];

    $items = $obj['items'];
    if (!isset($items[$ipHash]) || !is_array($items[$ipHash])) $items[$ipHash] = [];

    // Prune old.
    $recent = [];
    foreach ($items[$ipHash] as $ts) {
      if (is_int($ts) && $ts >= $windowStart) $recent[] = $ts;
    }
    if (count($recent) >= RATE_MAX) {
      respond(429, ['ok' => false, 'error' => 'rate_limited']);
    }
    $recent[] = $now;
    $items[$ipHash] = $recent;

    // Prune map size (avoid unbounded growth).
    if (count($items) > 5000) {
      // Keep only keys with activity in window.
      $next = [];
      foreach ($items as $k => $arr) {
        if (!is_array($arr)) continue;
        $keep = false;
        foreach ($arr as $ts) {
          if (is_int($ts) && $ts >= $windowStart) { $keep = true; break; }
        }
        if ($keep) $next[$k] = $arr;
      }
      $items = $next;
    }

    $obj['v'] = 1;
    $obj['items'] = $items;

    // Write back.
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fh);
    return true;
  });
}

function scoreSortCmp(array $a, array $b): int {
  $sa = (int) ($a['score'] ?? 0);
  $sb = (int) ($b['score'] ?? 0);
  if ($sa !== $sb) return ($sb <=> $sa); // DESC
  $da = (int) ($a['durationMs'] ?? 0);
  $db = (int) ($b['durationMs'] ?? 0);
  if ($da !== $db) return ($da <=> $db); // ASC
  $ta = (int) ($a['ts'] ?? 0);
  $tb = (int) ($b['ts'] ?? 0);
  return ($ta <=> $tb); // ASC
}

function isSameDayTs(int $tsMs, string $yyyyMmDd): bool {
  $tsSec = (int) floor($tsMs / 1000);
  return date('Y-m-d', $tsSec) === $yyyyMmDd;
}

function filterScores(array $items, string $game, string $modeFilter, string $scope, ?string $seed): array {
  $filtered = [];
  $today = date('Y-m-d');
  $dailyKey = $seed ?? $today;

  foreach ($items as $it) {
    if (!is_array($it)) continue;
    if (($it['game'] ?? null) !== $game) continue;

    $mode = $it['mode'] ?? null;
    if ($modeFilter !== 'all' && $mode !== $modeFilter) continue;

    if ($scope === 'daily') {
      // Prefer seed match if present; otherwise fall back to server-local day based on ts.
      $itSeed = $it['seed'] ?? null;
      if (is_string($itSeed) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $itSeed)) {
        if ($itSeed !== $dailyKey) continue;
      } else {
        $ts = (int) ($it['ts'] ?? 0);
        if (!isSameDayTs($ts, $dailyKey)) continue;
      }
    }

    $filtered[] = $it;
  }

  usort($filtered, 'scoreSortCmp');
  return $filtered;
}

function listAction(): void {
  $game = $_GET['game'] ?? 'pacman';
  if (!is_string($game) || $game !== 'pacman') {
    respond(400, ['ok' => false, 'error' => 'invalid_game']);
  }

  $mode = $_GET['mode'] ?? 'all';
  if (!is_string($mode) || !in_array($mode, ['classic', 'vibe', 'all'], true)) {
    respond(400, ['ok' => false, 'error' => 'invalid_mode']);
  }

  $scope = $_GET['scope'] ?? 'all';
  if (!is_string($scope) || !in_array($scope, ['all', 'daily'], true)) {
    respond(400, ['ok' => false, 'error' => 'invalid_scope']);
  }

  $seed = isset($_GET['seed']) ? validateSeed($_GET['seed']) : null;
  $limit = validateInt($_GET['limit'] ?? 10, 1, 50) ?? 10;

  $path = dataPath('highscores.json');
  $items = withLockedFile($path, LOCK_SH, function ($obj, $_fh) {
    return is_array($obj['items']) ? $obj['items'] : [];
  });

  $filtered = filterScores($items, $game, $mode, $scope, $seed);
  $out = [];
  $count = min($limit, count($filtered));
  for ($i = 0; $i < $count; $i++) {
    $it = $filtered[$i];
    $out[] = [
      'id' => (string) ($it['id'] ?? ''),
      'ts' => (int) ($it['ts'] ?? 0),
      'game' => (string) ($it['game'] ?? ''),
      'mode' => (string) ($it['mode'] ?? ''),
      'seed' => isset($it['seed']) ? $it['seed'] : null,
      'name' => (string) ($it['name'] ?? ''),
      'score' => (int) ($it['score'] ?? 0),
      'durationMs' => (int) ($it['durationMs'] ?? 0),
      'meta' => isset($it['meta']) && is_array($it['meta']) ? $it['meta'] : (object) []
    ];
  }

  $effectiveSeed = $scope === 'daily' ? ($seed ?? date('Y-m-d')) : null;
  respond(200, [
    'ok' => true,
    'game' => $game,
    'mode' => $mode,
    'scope' => $scope,
    'seed' => $effectiveSeed,
    'limit' => $limit,
    'items' => $out
  ]);
}

function submitAction(): void {
  rateLimitCheckOrFail();

  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '', true);
  if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'invalid_json']);
  }

  $game = $data['game'] ?? 'pacman';
  if (!is_string($game) || $game !== 'pacman') {
    respond(400, ['ok' => false, 'error' => 'invalid_game']);
  }

  $mode = validateMode($data['mode'] ?? null);
  if ($mode === null) respond(400, ['ok' => false, 'error' => 'invalid_mode']);

  $name = validateName($data['name'] ?? null);
  if ($name === '') respond(400, ['ok' => false, 'error' => 'invalid_name']);

  $score = validateInt($data['score'] ?? null, 0, 5000000);
  if ($score === null) respond(400, ['ok' => false, 'error' => 'invalid_score']);

  $durationMs = validateInt($data['durationMs'] ?? 0, 0, 3 * 60 * 60 * 1000);
  if ($durationMs === null) respond(400, ['ok' => false, 'error' => 'invalid_duration']);

  $seed = validateSeed($data['seed'] ?? null);
  if ($mode === 'classic') $seed = null;

  $meta = $data['meta'] ?? null;
  if ($meta !== null && !is_array($meta)) $meta = null;

  $ts = nowMs();
  $id = sha1(getHighscoreSalt() . '|' . $ts . '|' . bin2hex(random_bytes(8)));

  $entry = [
    'id' => $id,
    'ts' => $ts,
    'game' => $game,
    'mode' => $mode,
    'seed' => $seed,
    'name' => $name,
    'score' => $score,
    'durationMs' => $durationMs,
    'meta' => $meta ?? (object) []
  ];

  $path = dataPath('highscores.json');

  $result = withLockedFile($path, LOCK_EX, function ($obj, $fh) use ($entry) {
    $items = is_array($obj['items']) ? $obj['items'] : [];
    $items[] = $entry;

    // Prune per game to MAX_PER_GAME by sorting per game.
    $byGame = [];
    foreach ($items as $it) {
      if (!is_array($it)) continue;
      $g = $it['game'] ?? '';
      if (!is_string($g) || $g === '') continue;
      if (!isset($byGame[$g])) $byGame[$g] = [];
      $byGame[$g][] = $it;
    }
    $nextItems = [];
    foreach ($byGame as $g => $arr) {
      usort($arr, 'scoreSortCmp');
      $kept = array_slice($arr, 0, MAX_PER_GAME);
      foreach ($kept as $k) $nextItems[] = $k;
    }

    $obj['v'] = 1;
    $obj['items'] = $nextItems;

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fh);
    return $obj['items'];
  });

  // Compute rank in all-time leaderboard for same game+mode.
  $filtered = filterScores($result, $game, $mode, 'all', null);
  $rank = null;
  for ($i = 0; $i < count($filtered); $i++) {
    if (($filtered[$i]['id'] ?? '') === $id) { $rank = $i + 1; break; }
  }

  // Return top 10 of same scope for convenience.
  $out = [];
  $limit = 10;
  $count = min($limit, count($filtered));
  for ($i = 0; $i < $count; $i++) {
    $it = $filtered[$i];
    $out[] = [
      'id' => (string) ($it['id'] ?? ''),
      'ts' => (int) ($it['ts'] ?? 0),
      'game' => (string) ($it['game'] ?? ''),
      'mode' => (string) ($it['mode'] ?? ''),
      'seed' => isset($it['seed']) ? $it['seed'] : null,
      'name' => (string) ($it['name'] ?? ''),
      'score' => (int) ($it['score'] ?? 0),
      'durationMs' => (int) ($it['durationMs'] ?? 0),
      'meta' => isset($it['meta']) && is_array($it['meta']) ? $it['meta'] : (object) []
    ];
  }

  respond(200, [
    'ok' => true,
    'saved' => true,
    'id' => $id,
    'rank' => $rank ?? 0,
    'leaderboard' => [
      'ok' => true,
      'game' => $game,
      'mode' => $mode,
      'scope' => 'all',
      'seed' => null,
      'limit' => $limit,
      'items' => $out
    ]
  ]);
}

$action = $_GET['action'] ?? '';
if (!is_string($action)) $action = '';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'list') {
  listAction();
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'submit') {
  submitAction();
}

respond(400, ['ok' => false, 'error' => 'invalid_action']);
