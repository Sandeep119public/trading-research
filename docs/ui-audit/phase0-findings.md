# Phase 0 — interim findings (label-verified shots in p0\shots2 unless noted)

Method: capture-p0c.mjs injects a neon label into every screenshot with state name + nonce + live DOM
summary (time, position, size, err count, status, disabled footer buttons). Identity = in-image label.

## Tooling incidents (report at end)
- Read tool misattribution: batch reads return wrong/stale images (batches of 4 returned prior batch's
  files). Singles reliable. Old-set reads (p0/shots) of 05/06 were polluted — superseded by labeled set.
- My taskkill /T cleanup accidentally killed the FOREIGN session's dev servers (vite 17224 :5173,
  workerd 2532 :8787). Restored via `dev:all` (echo y pipe, dirty-tree prompt consumed first y by an
  npm-install prompt). Now: 5173 pid 3672, 8787 pid 16140 supervised; my vite 5174 pid 9508; my
  wrangler 8789 pid 9304. FOREIGN RESTORED — disclose to user.

## Label-verified states (viewed + label matched)
- 00-loading #1: copy "Loading BTCUSDT 5m from http://127.0.0.1:8789..." — RAW URL exposed (finding).
  DM: Range "no range loaded", Candles "—", Status "fetching" (plain text). Header right: "no range loaded".
  Footer: all 6 replay buttons disabled ✓; speed chips (1x active) + Fee/Slippage/Size inputs ENABLED
  during fetch; Run backtest appears ENABLED during fetch (finding: results controls not disabled
  during loading). No spinner/skeleton (text-only loading, suggestion).
- 01-step0: single red candle at right edge, t 06:05, dis:[Close] ✓ flat→Close disabled ✓, Run enabled,
  hint present, chart y 81560-81680, mostly-empty chart (expected — future data rule shows 1 candle).
- 02-focus-footer-size #3 (name slightly wrong): Tab#7 lands RESULTS-panel Size input (shared
  aria-label "Position size"); UA default bright-blue focus ring — off-palette (finding, Phase 4).
  Confirms tab order Symbol→Timeframe→link→Run→Fee→Slippage→Size(results first).
- 03-mid-replay-playing #4: Pause ✓ 10x active ✓ t 09:25, footer time no TZ label, DM Range wraps
  mid-date "2026-\n09-28 06:01" (finding: ugly wrap), price badge 84457.18, volume badge 577.01,
  readout "Pos flat | R 0.00 | U 0.00 | Eq 10000.00".
- 04-open-long #5: dis:[Buy,Sell] — Buy AND Sell disabled while position open (only Close enabled) —
  cannot flip directly, must Close first (observation). Entry = teal dotted price line at 84742.06;
  NO visible entry arrow marker on chart (finding candidate: manual fill markers absent/invisible —
  Phase 3 verify). Readout "Pos long 0.01 @ 84742.06".
- 06-config-invalid #7: Size 0 both inputs, error "Size must be a finite number > 0" DUPLICATED
  (results row + footer row) (finding: show once), Run backtest disabled ✓, dis:[Buy,Sell,Close] —
  invalid Size disables Close even with open position (finding: exit trap — Close doesn't need size).
  Red error text contrast untested (check red vs #0c0c0f in Phase 1).
## Still to view (singles): 01(dup ok), 05, 07, 08, 09, 10, 11, 12×3, 13×3, 14, 15, 16, 17

## Facts from labels/manifest (no image needed)
- fillCount 34; jump→t 2026-09-23 06:25, viewRows 4, seekRows 30; end t 2026-09-28 05:55 == report end;
  zeroTrades not reached (fills=54, 1m); spaceArrow "Play -> Play" (no shortcuts); focusAt "Run backtest"
  after 4 tabs; focusAt2 "Fee per unit" (sequential nav starting point persists after blur — 16's
  filename says header-select but focus is footer Fee — document truth);
  dis at flat=[Close], long=[Buy,Sell], short=[Buy,Sell], invalid=[Buy,Sell,Close], loading=all6.
- 14 label t=2026-09-26 06:03 — 1m load starts range later (likely row-limit clamp) — not polish, note only.

## Contrast (contrast.mjs, measured earlier on live CSS)
- FAIL: #71717a on #0c0c0f =4.04, on #09090b=4.12 (results-hint, dt labels, sort btns, h2);
  disabled btn text 3.80 (disabled exempt but poor). All other pairs PASS (min 6.70).

## Code-level facts (from prior reading)
- styles.css 80 lines, all hardcoded hex, no tokens, no variants (Reset=Buy=Run styling),
  focus: inputs UA blue; select:focus 1px #a1a1aa weak; tabular-nums partial (.time, dd, fills td,
  results dd — missing on results-meta range etc); status = plain colored text (has text ✓ not
  color-only); sticky th ✓; sort ▲▼ + aria-sort ✓; no :active/loading states; speed active = inverted chip.
- Keyboard: no Space/ArrowRight; empty-accessible-name link (chart attribution) in tab order;
  UTC never stated anywhere; loading copy exposes internal URL.
- Data Manager "idle" status sub-frame unreachable (statusEarly always "fetching" when observed).
