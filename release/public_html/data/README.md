This folder is used by `api/highscore.php` for file-based persistence.

- Make sure the webserver can write to this directory (`highscores.json`, `ratelimit.json`).
- Set a strong random `HIGHSCORE_SALT` env var (or edit `api/highscore.php`) before deploying.
