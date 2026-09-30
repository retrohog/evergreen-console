# Evergreen Investigation Console

A local, read-only **command console for an autonomous trading desk**. It reads the desk's
own state files and renders them as a 7-page investigation UI: what's live now, the case file
behind the current setup, market structure, backtest edge, the call journal, the automation
pipeline, and system health.

Stdlib Python + vanilla JS. No build step, no pip installs, no external requests.
Binds `127.0.0.1` only. Live updates are **pushed** over Server-Sent Events.

> Screenshots and `snapshot.html` are deliberately gitignored — they capture live desk data.

## Run it

```bash
~/.hermes/scripts/desk-board.sh start            # idempotent
~/.hermes/scripts/desk-board.sh status
~/.hermes/scripts/desk-board.sh open             # start if needed + open browser
~/.hermes/scripts/desk-board.sh snapshot [path]  # self-contained HTML snapshot
~/.hermes/scripts/desk-board.sh logs | restart | stop
```

Or directly:

```bash
python3 server.py --port 8899                    # your real desk
python3 demo/make-demo.py                        # write synthetic sample data
DESK_DIR="$PWD/demo" python3 server.py --port 8901
```

Open <http://127.0.0.1:8899> · `⌘K`/`Ctrl+K` command palette · `1`–`7` pages · `r` refresh ·
deep links (`/#structure`, `/#flow`) work.

## Pages

| # | Page | What it answers |
|---|---|---|
| 01 | **Command** | what is live right now — session state, KPI tiles, playbook ladders (spot vs POI vs every target), killzone/next-cron rings, 5m instrument sparklines, economic wire in IST, paper R curve |
| 02 | **Case File** | the current setup as an investigation: scored **evidence** (HTF alignment, LTF confirmation, confluence stack, volume context, reachability, reward geometry), plan, **invalidation ladder**, thesis timeline |
| 03 | **Structure** | HTF→LTF trend matrix, volume profile (POC/VAH/VAL + HVN/LVN), a **5m candle tape with live zones**, session levels, VWAP σ bands, and the **structure map**: every FVG/OB across timeframes on one price axis |
| 04 | **Edge Lab** | backtest study — equity curve, R distribution, **MFE vs MAE scatter**, expectancy by kind/grade/instrument/side, hour-of-day heatmap, full trade ledger, auto-insight |
| 05 | **Journal** | today's calls with outcomes and real $/pt, paper stream, lesson feed, verbatim desk posts |
| 06 | **Flow** | the desk as a **pipeline** (scan → wire → build → arm → post → journal → learn), agent roster with health/cadence, **job × hour run heatmap**, and a live run feed |
| 07 | **System** | cron desk with delivery outcomes, agent pulse (ticker beat, tokens), state-file freshness bars, 36h desk churn, doctrine |

## Design language — two themes, one switch

Press **`t`** (or the header switch, or `?theme=light|dark`) to flip between:

- **`dark` — cyberpunk terminal (default)**: near-black `#04070A`, phosphor `#00FF9C` + cyan `#22D3EE`
  + magenta, CRT scanline overlay with a rolling band, perspective circuit floor, chamfered
  (clipped) panel corners, neon glow on numerals, glitch-split title on hover, terminal boot with
  a typing cursor, blinking block cursors in outputs.
- **`light` — evergreen forest**: misty sage page, contour-line topology, canopy drift, warm sun,
  paper panels with hairline moss borders and layered soft shadows.

Both themes share every component; only tokens change (`[data-theme]` on `<html>`), so a switch
repaints without re-laying-out. Motion is CSS-driven and `prefers-reduced-motion` is respected.

**Interaction layer**: magnetic tiles that tilt toward the cursor with a sheen, buttons that draw
their own corner brackets and sweep a highlight, click ripples, `⌘K` palette, live-flash on value
changes, count-up numerals, animated rings and pipeline ribbons.

**Visualisation set** (all drawn from real state, no library): price ladders, HTF→LTF structure map,
**ATR zone dial** (concentric rounds + zone arcs by timeframe), candlestick tape with zone overlays,
equity curve, R histogram **with a KDE density overlay**, MFE/MAE scatter, **polar clock of R by
hour**, **evidence radar** (six-axis quality polygon with a threshold ghost), **squarified treemap**
of desk churn, **pipeline ribbons** whose thickness = runs, **LED run matrix** (job × hour),
bullet charts for R vs target, rings, sparklines.

Borrowed deliberately: incident-investigation **evidence/attack-story** framing, automation-builder
**pipeline canvas**, agent-observability **rosters + run heatmaps**, crypto-terminal **sparklines +
live feed** — plus the motion vocabulary from [recent.design](https://recent.design).

## Architecture

| File | Role |
|---|---|
| `server.py` | `http.server` on :8899 — routes `/`, `/app.js`, `/styles.css`, `/snapshot.html`, `/api/{state,structure,edge,flow,case,series}`, `/api/stream` (SSE), `/health` |
| `app.js` | hash router, 7 page renderers, canvas charts (line/bar/scatter/candles/sparkline) with hover tooltips, SSE client, command palette, change-flash animation |
| `styles.css` | the forest design system |
| `demo/make-demo.py` | generates a **synthetic** desk so the console runs with no real data |

**Live updating.** `/api/stream` is an SSE endpoint that fingerprints the backing files per topic
(`state`, `structure`, `edge`, `flow`, `ops`) by mtime+size every 2s and pushes only the topics that
moved. The client refetches just those, so the board updates on the desk's own rhythm — a scan
landing, a fill, a journal resolution — instead of a fixed poll. A 15s fallback poll covers a dead
stream, and the header shows `push · Ns` vs `poll` so you always know which mode you're in.
Payload collectors are 4s-cached; a failing collector returns `{"error": …}` with HTTP 200 rather
than 500ing the board.

## Config

`DESK_DIR` (default `~/workspace/desk`), `HERMES_HOME` (default `~/.hermes`), `BOARD_PORT`,
`DESK_BOARD_PYTHON`, `BOARD_VERBOSE=1` for an access log.

## Data conventions

- `$/point` per instrument is derived from `risk_usd / risk` in the playbook (e.g. $10/pt and $2/pt)
  — never hardcode a contract multiplier.
- `journal.jsonl` repeats a job id (`open`, later the resolution) — dedupe keeping the last entry.
- `events-*.json` carries an ET base timestamp; IST times are computed from it, logic stays ET.
- Any per-instrument constant in the UI must trace back to a data file.

## Pitfalls (each of these actually bit)

- **A missing element id kills the whole page.** `header()` writes into the freshness chip; when the
  snapshot builder replaced that chip it dropped the id, `header()` threw, and every page rendered
  blank while the ticker tape (written moments earlier) still looked healthy.
- **Static HTML needs its own response branch** — routing `/snapshot.html` through the JSON path
  double-escaped it into `\"…\"` junk.
- **Surface render errors visibly.** `render()` wraps each page renderer in try/catch and prints the
  stack into the page; a global `error` listener writes message + `lineno:colno` into the footer.
  That is what localized the bug above — do not remove it.
- **`cron/jobs.json` `next_run_at` can be in the past** → recompute from the cron expression.
- **`executions.db` can be write-locked** by the scheduler → normal connect → `?mode=ro` URI →
  empty history.
- **Two different files named `jobs.json`**: the desk's own vs the scheduler's. Same name, unrelated
  schemas.
- **Structure-map price range**: anchor on zones + spot + live VP and extend only for nearby
  references; far 4H swings squash live zones into slivers.
- **Deep links**: set the initial page from `location.hash` before first render, or `#edge` opens
  the default page.
- **Never rewrite an animated element on a timer.** The ticker froze because the 1 Hz clock refresh
  also re-set the marquee's `innerHTML`, restarting its CSS animation every second. Fix: render the
  tape only when its content signature changes, drive it with one GPU `translate3d` loop over two
  identical halves, and keep the per-second loop to *text nodes only* (clocks, countdowns, chips).
  The footer exposes `renders · tape writes · refetch · push` so this class of bug is visible.
- **Canvas colour comes from CSS variables**, so a theme switch must repaint: register each draw in
  a list and re-run it after the theme flips (and on resize/visibilitychange).

## License

MIT — see `LICENSE`.
