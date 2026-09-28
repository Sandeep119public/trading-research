# Phase 0 — Deep UI polish audit (report-only, no code changes)

Date: 2026-09-28. Repo at `35c51f3` (clean). Screenshots: `p0/shots2/` (label-verified), `p0/shots/` (originals).
Method: `capture-p0c.mjs` injects a neon label into every screenshot carrying state name + nonce + live DOM
summary (t / pos / size / err / status / disabled buttons). Identity is proven IN THE PIXELS. 22 shots,
all states swept. Contrast measured numerically (`p0/contrast.mjs`). Findings cross-checked against source.

## Verification log (state → what was seen)
| State | Shot(s) | Label | Key evidence |
|---|---|---|---|
| Loading | 00 | #1 | "Loading BTCUSDT 5m from http://127.0.0.1:8789…", st:fetching, 6 replay buttons disabled, Run enabled |
| Step 0 | 01, 12-1366/1024/390 | #2,#13,#15,#17 | single candle (Future-Data Rule PASS), dis:[Close], hint present |
| Focus probe | 02, 15, 16 | #3,#20,#21 | ring on results Size; Run button ring indistinguishable; footer Fee ring = 1px |
| Playing | 03 | #4 | Pause, 10x active, t advanced 06:05→09:25 |
| Long open | 04 | #5 | Pos long, dis:[Buy,Sell], entry price-line only (no arrow marker) |
| Short open | 05 | #6 | Pos short after Close→Sell ✓ |
| Config invalid | 06 | #7 | err ×2 duplicated, dis:[Buy,Sell,Close] (exit trap), Run disabled |
| Full results | 07, 13-×3 | #8,#14,#16,#18 | 34 fills, 8 stats, equity curve, jump time-cells |
| Jump/seek | 08, 09, 10 | #9,#10,#11 | footerAfterJump 09-23 06:25 ✓, view/seek rows 4/30 ✓, weak hover |
| End of data | 11 | #12 | t=09-28 05:55 == report end ✓ BUT chart broken (F21) |
| Zero trades | 14 | #19 | NOT reached (54 fills) — unreachable via UI, honest disclosure |
| Error | 17 | #22 | "Data failed to load: Data service unreachable: Failed to fetch", Run disabled, no retry |
Contrast (WCAG): FAIL #71717a on #0c0c0f=4.04 / #09090b=4.12 (hint, dt/section labels, sort buttons);
disabled btn text 3.80 (opacity .45). All other pairs PASS (min 6.70).
Keyboard: Space/ArrowRight no-op ("Play -> Play"); tab order Symbol→Timeframe→attribution-link(no name)→Run→Fee→Slippage→Size.

## Findings
### Phase 1 — tokens & controls (`feature/ui-tokens-controls`)
- F1 [High] Muted text #71717a fails AA (4.04/4.12) in hint, DM/results labels, section titles, sort buttons.
  Fix: darken-lighten to ≥4.5 via tokens; re-run contrast.mjs as unit-ish check.
- F2 [High] No design tokens: styles.css = 80 lines of hardcoded hex. Fix: custom properties
  (--bg/--surface/--border/--text/--muted/--accent/--danger/--warn/--success, radius, spacing) + migrate.
- F3 [Med] Disabled = opacity .45 only (3.80:1 text). Fix: explicit disabled token style (text/border/bg).
- F4 [Med] No button variants; Reset/Buy/Run/Export identical. Fix: primary/secondary/ghost/danger classes.
- F5 [Med] Focus inconsistent: buttons have NO focus rule (UA ring invisible on dark — 15),
  inputs/select = 1px #a1a1aa; selection-highlight mistaken for ring. Fix: tokenized :focus-visible
  (2px accent + offset) on all interactive elements. (Applied Phase 4 with keyboard work; token defined here.)
- F6 [Low] tabular-nums partial. Fix: apply to all number-bearing classes (results-meta, header range,
  stat values, readouts).
### Phase 2 — layout & copy (`feature/ui-layout-copy`)
- F7 [High] Validation: message duplicated (results + footer ConfigInputs both render) AND invalid Size
  disables Close while a position is open (exit trap; Close doesn't use size). Fix: show once; map disabled
  set so Close stays enabled. Red-first tests: validation-message mapping + disabled-set mapping.
- F8 [Med] DM Range wraps mid-date ("2026-"/"09-28"). Fix: nowrap date tokens / layout.
- F9 [Med] Three "ranges" on screen with different endpoints (header/DM data window vs backtest meta
  strategy range; rolling-window minute drift). Fix: distinct labels, e.g. "Data window" vs "Backtest range".
- F10 [Med] UTC never stated. Fix: consistent " UTC" suffix (header range, clock, DM, fills Time header).
- F11 [Low] Fee/Slippage/Size duplicated footer vs results panel (both bound to same draft). Fix: visual
  differentiation or consolidate; must not regress live-config behavior.
- F12 [Med] 1024: footer wraps with Size orphaned on row 2; clock splits mid-string; readout splits
  "Eq"/"10000.00". Fix: responsive footer (grouping, white-space:nowrap on clock/readout).
- F13 [Med] 390: meta truncates to "EMA(20)…" (ellipsis eats symbol/timeframe/range); header date range
  dropped (acceptable — info exists in DM — but state decision); footer stacks to 5 rows (~20% viewport).
  Fix: meta wraps or priority order; tighten footer.
- F14 [Med] Fills table: max-height 200px + overlay scrollbars ⇒ no scroll cue; last row sliced mid-row.
  Fix: visible scrollbar styling / fade-scroll shadow / hint.
- F15 [Med] Stats: MAX DRAWDOWN missing "%"; Realized P&L & P&L column uncolored negatives; uneven card
  gaps; 9-10px uppercase labels too dim/small. Fix: signed-P&L formatting+color class (red-first unit test),
  units, grid.
- F16 [Med] Hierarchy: Run backtest orphaned top-right ~1500px from its inputs; Export CSV same weight as
  primary. Fix: primary variant + placement near inputs.
- F17 [Med] Loading copy exposes internal URL (main.tsx:270 `from ${DATA_API_URL}…`). Fix: "Loading
  BTCUSDT 5m…" without URL.
- F18 [Med] Error copy leaks DOMException text: "Data service unreachable: Failed to fetch" (repeated in
  chart + DM). Fix: friendly top-level message; technical detail optional/secondary.
- F19 [Low] No Retry affordance in error state. Fix: "Retry" (reload data) or explicit guidance copy.
- F20 [Med] Results controls (Run, inputs, speed chips) enabled while fetching/error-adjacent. Fix: disable
  Run until data ready (00 evidence).
### Phase 3 — chart & results visualization (`feature/ui-chart-results`)
- F21 [Critical] END-OF-DATA VIEW BROKEN. After "last seek → 10x → play to end" the main chart shows TWO
  ~600px-wide 5-minute candles (labels 06:20/06:25 ≈ 09-23 06:2x region, price tag 86424) while the clock
  reads 2026-09-28 05:55; volume pane = 2 solid blocks. The viewport neither follows the data end nor keeps a
  sane span. Root-cause per AGENTS.md:21 (check uncalled scale API — centerTimeScale clamp, setData viewport
  retention, missing scrollToRealTime at end). Fix + browser regression (before/after screenshots).
- F22 [High] Equity chart shows last-value tag 10000.25 while FINAL EQUITY stat reads 9984.43 in the jump
  state (08); both 9984.43 at end (11). Contradictory numbers side-by-side destroy trust. Determine lc
  last-value label semantics after time-scale scroll; pin/hide label appropriately. Test: jump → tag == stat
  or label hidden.
- F23 [High] Jump affordance weak: rows differ only amber(seek)/white(view) with NO legend (semantics:
  amber = advances replay engine, white = scroll only), hover = faint tint/underline, seeked row = hairline,
  NO marker on the jumped-to candle (10). Fix: legend/caption, stronger hover + current-row highlight,
  candle marker. Red-first tests: toFillMarkers, legend value selection.
- F24 [Med] Post-jump centering unconvincing visually (09/10 read as "no recenter") — verify span-preserving
  center actually lands target at center; marker from F23 makes it legible regardless.
- F25 [Med] Axis/label clipping: last-price tag overlaps axis tick (81621.26/81620.00), right-edge time tick
  clipped (`06:0`), equity ticks clipped (`05:5C`, `9996.00`), volume `400` clipped. Check lc options first
  (AGENTS.md:21) before declaring library limitation; fix the panel-padding cases.
- F26 [Low] Step-0 chart = 1 candle at edge + 95% dead space reads as a render bug (it is correct
  Future-Data behavior). Fix: subtle caption ("At start of data — press Play").
- F27 [Low] 1m first candles ⇒ 2-tick y-range (83898.27/83898.28) — autoscale nicety, folds into F25.
- F28 [Low] TradingView watermark inside small equity panel — attribution must stay (license); size/opacity
  only.
- F29 [Med] Manual fills show entry price-line but NO arrow markers on chart (04/05). Verify intended
  behavior vs missing feature (backtest fills on results chart?); align with ARCHITECTURE.md.
- F30 [Low] End of playback gives no feedback (11 = looks like manual pause). Fix: subtle "End of data" cue.
### Phase 4 — keyboard & a11y (`feature/ui-keyboard-a11y`)
- F31 [High] No playback shortcuts (Space/ArrowRight inert). Fix: keyToAction adapter (Space toggle,
  ArrowRight step, ArrowLeft step-back) ignored inside inputs/selects/textarea. Red-first units for
  keyToAction + mutation "shortcut fires inside input".
- F32 [Med] Chart attribution link has no accessible name; button focus invisible (F5). Fix: aria-label +
  focus-visible pass + tab-order test.
- F33 [Med] Input-focus regression: prior capture showed unexplained Buy-disabled after keyboard probe;
  add component test that focus/blur cycles never leave actions disabled.
- F34 [Low] Status = plain colored text (has text ✓ not color-only); optional chip styling if it fits tokens.
- F35 [Low] Title-attr tooltips are hover-only; F23 legend covers the critical info.

## Unreachable states (honest disclosure)
- Zero-trades results: NOT reachable via UI on live data (1m attempt produced 54 fills). `.results-empty`
  path exists in code/tests only.
- Data Manager "idle" status: never observed (status reads "fetching" whenever captured).
- Rolling data window drifts minutes between captures (by design — "now"-anchored range).

## Verified PASS
- Future Data Rule: step0/early replay show only candles ≤ engine time (single candle at start). ✓
- Data sourced correctly: stats/equity from backtest result; footer R/U/Eq from Portfolio; no UI math. ✓
- Jump behavior: footerAfterJump, view/seek split (4/30), end-of-data reached == report end. ✓
- aria-sort + sticky header present. ✓

## Process incidents (disclosed)
1. Read tool misattribution: image reads returned other files' content (batch and single). Mitigated with
   in-image labels + fresh-context subagent readers; all 17 remaining shots label-verified across 3 contexts.
2. **I killed the foreign session's dev servers** (vite :5173, wrangler :8787) via an over-broad taskkill /T
   during cleanup. Restored via `dev:all` (supervised): 5173 pid 3672, 8787 pid 16140. My own: vite 5174
   pid 9508, wrangler 8789 pid 9304. One earlier wrangler 8789 listener death (cause unknown) resolved by
   clean restart — watch for recurrence.
3. Original `p0/shots/` views of 05/06 were polluted by (1); superseded by `p0/shots2/`.

## Prioritized execution plan (awaiting go-ahead)
1. Phase 1 tokens/controls → F1-F6 (F5 token only).
2. Phase 2 layout/copy → F7-F20 (+ signed-P&L & validation-mapping red-first tests).
3. Phase 3 chart/results → F21 (critical), F22, F23 (+ toFillMarkers/legend tests), F24-F30.
4. Phase 4 keyboard/a11y → F31-F35 (+ keyToAction tests, input-focus mutation).
Each phase: own branch → red-first tests → fix → before/after browser screenshots → docs (same commit) →
typecheck/test/build with shown output → PR → CI green on exact commit → merge → post-merge CI.

## Addenda (post-audit directives, 2026-09-28)

- F21 and the exit-trap half of F7: FIXED in PR #20 (`fix/ui-audit-bugs`, merged as `fc6cb85`); root causes recorded in the PR body.
- F22 (Phase 3): preferred fix = make the axis tag show the series' FINAL value so it matches the FINAL EQUITY card, and let the crosshair label carry the hovered value; hiding the tag entirely is the fallback. Add a test that pins the choice so the tag and the card can never drift apart.
- F7 (Phase 2): when the config is invalid and a position is open, the validation message must say that closing uses the last valid settings (e.g. "Closing uses your last valid settings.") — close fills under the last valid config, and without that notice a fill can land with fee/slippage differing from what is typed in the box.

### Phase 2 resolutions (`feature/ui-layout-copy`)
- F7/F11: consolidated — the footer `ConfigInputs` instance was removed, leaving one instance beside Run, so
  the validation message (and the close notice) render at exactly one place. `configValidationMessages(errors,
  hasPosition)` in `trade-config.ts` appends the notice only when the draft is invalid AND a position is open;
  the disabled-set half of F7 was already fixed in PR #20 (`footer-gates`).
- F10: " UTC" applied to every user-facing UTC timestamp (header range end, clock, DM window end, results meta
  end, fills header "Time (UTC)"). All derive from `toISOString`/UTC epoch math.
- F13: header date range stays hidden ≤600px — deliberate: the same window is in the Data Manager's
  "Data window" row. Meta wraps instead of ellipsizing; the footer loses a row with the config group removed.
- F15 unit: `maxDrawdown` is **currency**, not a percent — `computeMaxDrawdown` (packages/backtest/src/index.ts)
  returns peak − equity in quote units. Adding "%" would misreport the stat, so the value keeps money
  formatting (consistent with Final equity / Fees paid). The rest of F15 landed: `formatSignedMoney`
  (+10.00) + `pnlSignClass`, and the CSS specificity fix that lets `.neg`/`.pos`/`.side-*` actually color
  cells (they were losing to `.fills-table td` / `.results-stats dd`).
- F18: `data-copy.ts` splits the data layer's "Data service unreachable: <transport>" into a friendly
  headline (everywhere) + transport detail (Data Manager only). F19: Retry button in the chart placeholder
  re-runs the load effect via `reloadNonce`. F20: Run/footer gates take `loaded && status === "ready"`.
