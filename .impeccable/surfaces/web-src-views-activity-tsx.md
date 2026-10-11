---
version: 1
slug: "web-src-views-activity-tsx"
primary_target: "web/src/views/Activity.tsx"
related_targets: ["web/src/components/ProjectedBlocks.tsx", "web/src/components/VirtualTable.tsx", "web/src/components/useTableMotion.ts", "web/src/activity.ts", "web/src/style.css", "web/src/locales/en.ts", "web/src/locales/de.ts", "internal/activity/projection.go", "docs/activity.md"]
---

Mode: Operate. Audience: individual node operators. Live combines full-mempool projected next blocks with an animated, always-visible sampled transaction table; Timeline retains the quiet 30-day observation history. ZMQ sequence with RPC fallback and SSE remain the observation transport. No watchlist, notifications, or RSS. Code-first; inherit DESIGN.md.

## Direction contract

THESIS: Make the node's full mempool backlog and fee-prioritized next-block estimates readable, while sampled transaction arrivals remain animated and inspectable.
OWN-WORLD: Incumbent warm paper, ink, orange actions, and charcoal dark theme; flat ruled workspace, tabular readings, native controls.
STORY: Operators inspect backlog and projected package fee ranges, distinguish the full snapshot from sampled arrivals, pause observation, then investigate quiet node history and its block links.
FIRST VIEWPORT: Heading and Live/Timeline tabs precede source status and pause control. The ruled projection section shows full-snapshot backlog, capacity equivalents, fee range, and observation time above a horizontal strip of up to four static fee-group mosaics. Each projection presents its effective package median, count, virtual size, and effective range. Observed-arrival and sample readings precede the always-visible transaction table. Timeline replaces these Live contents with category controls and contained virtual history.
FORM: Ordinary extension of the established dashboard. SVG fee-group areas represent combined virtual size and leave spare capacity visible; they never claim individual transaction identity or an exact mining template. Projection estimates remain static between snapshots. Measured table motion carries arrival feedback, complete metadata gates readable rows, exact eight-decimal BTC amounts lead, and reduced motion settles rows immediately.
FINISH: Source guidance must match the implemented surface; independent rendered review and its verdict remain required. This extension preserves DESIGN.md and its sidecar and introduces no raster assets.

## Implemented surface guidance

This is an ordinary extension of the incumbent system. `DESIGN.md` and
`.impeccable/design.json` remain the shared authority; these Activity-specific
facts do not introduce global tokens or replace existing design rules.

- Keep the projection section before observed-arrival readings and the sampled
  table. Source status and pause follow the Live/Timeline selector. Block inspection
  belongs to Timeline block links; Live has no separate block inspection action.
  Full-mempool projections and sampled arrival coverage have separate copy and
  readings; sample membership is not the source of projection totals.
- Reuse semantic theme variables for rules, surfaces, controls, status, and
  copy. The projection section has fine top/bottom rules and (24px) vertical
  padding, without elevation. Its explanation uses a local (90ch) maximum;
  sampled coverage and Timeline notes retain (80ch) limits. Projection mosaics
  use navigation stock for spare capacity and a fine-rule boundary.
- Full-snapshot readings show transaction count with total virtual size,
  virtual-size capacity equivalents, and the individual modified fee-rate range
  in sat/vB. Capacity equivalents divide virtual size by (999,000 vB), with
  localized copy identifying a capacity estimate rather than a waiting time.
  The snapshot time and ten-second refresh cadence remain visible. Paused,
  hidden, or disconnected Live views append the retained-snapshot explanation.
- The ordered strip renders up to four nonempty projected blocks, in selection
  order. Each has a position heading, a prominent (24px), weight (600) tabular
  effective package median with a quiet (13px) unit, followed by its mosaic and
  ruled (12px) count, virtual-size, and effective-range readings. The median is
  transaction-count weighted: each selected transaction contributes its effective
  package rate. An empty mempool shows an explicit empty state; a nonempty
  snapshot with no fitting entries uses a separate explanation. Count and virtual
  size of entries beyond the projections or unable to fit remain visible.
- On desktop the strip has four flexible columns with a (230px) minimum and
  (24px) gaps. At and below (767px), columns are (260px) wide and snapshot
  readings retain two columns, with the third reading on the next row. The strip
  contains its horizontal overflow and is
  keyboard-focusable as a labeled ordered list. Keep the shared visible focus
  outline. Source status wraps onto its own row at the same mobile breakpoint;
  observed-arrival and displayed-sample metrics remain two columns.
- Each static SVG has a (300 × 220) viewBox, a localized image label containing
  position, transaction count, and virtual size, and fee-group titles containing
  grouped count and effective package range. Logarithmic fee groups are split
  into at most (16) cells per group. Recursive area partitioning uses combined
  virtual size; occupied height scales against (999,000 vB) and starts at the
  bottom, leaving unused virtual capacity visible above it. Small internal gaps
  distinguish groups. A cell may bundle multiple transactions and exposes no
  individual transaction selection.
- Reuse `chartPalette` for the mosaic and readable fee legend: fourth series
  below (5 sat/vB), first series from (5) to below (20 sat/vB), and third series
  at least (20 sat/vB), assigned from the cell's minimum effective package rate.
  Group titles and textual ranges retain the numeric meaning independently of
  color. These estimates use package rates; the full-snapshot range describes
  individual modified rates, and sampled table fees describe base rates.
- One asynchronous bulk `getrawmempool true` request runs at most once every
  (10 seconds) while Live tracking is active. A single in-flight projection
  worker reads the full snapshot's virtual sizes, weights, modified fees, and
  unconfirmed dependencies. Selection ranks remaining ancestor packages by
  modified fee per virtual byte, supports child-pays-for-parent, and reprices
  descendants after selecting a shared parent. Each transaction is counted once.
  Up to four blocks enforce both (3,996,000 WU) and (999,000 vB), reserving
  (4,000 WU) for header and coinbase. Package fit and projection limits can leave
  entries in the backlog. These are local estimates; miner policy, sigops,
  selection algorithms, and new arrivals can change actual blocks.
- Projection computation has a (10-second) deadline, a (200,000-entry) limit,
  an (8,000,000) dependency-visit budget, a (1,024-level) recursion limit, and
  a bounded verbose RPC response documented at (128 MiB). It does not block the
  live event loop, fetch every raw transaction, or persist the full mempool.
  Failures keep the last successful projection with an explicit warning; an
  initial failure shows unavailable state. Baseline resets clear the projection
  and reject results from an older generation.
- The sampled table stays present independently of projection loading, empty,
  or failed states. It admits a row only when output amount, virtual size, and
  fee rate are all available. A localized count explains sampled entries still
  waiting for metadata; unknown metadata does not become a fabricated zero.
  The sample is bounded at (500) transactions and seeds up to (50) existing
  entries without counting them as arrivals. Its localized explanation identifies
  sampling and polling gaps. Metadata lookup prioritizes newest arrivals and
  is limited to (200 transactions per five seconds) with at most four concurrent
  workers; output totals remain ephemeral and do not alter Timeline storage.
- Exact eight-decimal BTC amounts lead the sampled table in the system sans,
  weight (600), with tabular figures and no wrapping. Amounts sum outputs,
  including change and excluding fees, as the localized note explains. Decimal
  satoshi strings in `output_sats` preserve precision; known zero remains an
  eight-decimal BTC amount. Full selectable transaction IDs follow in monospace,
  wrap anywhere, and expose their entire value through the title attribute.
  Virtual size and fee rate are supporting columns. The table has a (900px)
  minimum width, with (240px) for amount, (140px) for size, and (160px) for fee
  rate. Narrow screens contain horizontal scrolling and retain the leading
  amount at the initial position.
- The table's first populated baseline and observation-generation resets are
  static. Newly ready rows enter in contiguous measured groups with a left
  drift of (28px) over (380ms), using `cubic-bezier(0.16, 1, 0.3, 1)`.
  Clip-path reveal follows each insertion boundary so content and row rules do
  not paint over preceding rows. Retained mounted rows continue from measured
  displacement, current painted transform, and current clip during rapid SSE
  updates. Unchanged destinations preserve motion already in progress. Reduced
  motion, pause, a hidden document, disconnected stream, and manual scrolling
  settle rows. This arrival feedback remains local to the sampled table.
- Live enables measured virtualization even below the ordinary (50-row)
  threshold. While scrolled, it anchors a mounted transaction key and actual
  DOM row offset below the sticky header. Update compensation removes the
  animation transform from the measured position; automatic measurement-based
  scroll adjustment is disabled for Live. Returning to the top clears the
  anchor, and a changed observation generation resets scroll. Pausing, hiding,
  or leaving Live closes its SSE connection; resuming reopens it.
- Timeline remains quiet. Connection changes, observed blocks, and verified
  reorganizations have readable event text and a native category select. New
  events expose "Show new events" instead of replacing history being read.
  Cursor loading retains at most ten pages (500 events); category changes and
  explicit refresh reset the table. EN/DE copy explains the (30-day),
  (100,000-event per node) retention and unavailable observation gaps without
  promising backfill. Timeline subscriptions do not start mempool tracking.
- Both tables reuse `VirtualTable` with native table semantics, sticky headers,
  row totals, contained scrolling, and keyboard access. Row renderers return
  cell fragments; `VirtualTable` owns each row. Timeline has a (1000px) minimum
  width, with (220px) observation and (280px) block columns. Inspection actions
  reuse `BlockGoggles` in a separate ruled panel; opening focuses that panel and
  closing restores the invoking control when it remains mounted.
- Reuse `Notice` and `Empty` for waiting, resynchronizing, unavailable, capacity,
  persistence, loading, and retry states. All new projection and coverage copy
  belongs to the typed English and German locale objects. Node diagnostics and
  original metadata retain their actual meaning.

## Documentation evidence

Source checked: `web/src/views/Activity.tsx`,
`web/src/components/ProjectedBlocks.tsx`, `web/src/components/useTableMotion.ts`,
`web/src/components/VirtualTable.tsx`, `web/src/activity.ts`, Activity rules and
incumbent primitives in `web/src/style.css`, typed EN/DE Activity locales,
`internal/activity/projection.go`, `internal/activity/service.go`, and
`docs/activity.md`. Product context and shared authority checked: `PRODUCT.md`,
`DESIGN.md`, and `.impeccable/design.json`.

Source regression evidence includes `ProjectedBlocks.test.tsx` for bounded
fee-group area, spare capacity, loading, failed-refresh retention, and empty
snapshot states, and `web/e2e/activity.spec.ts` for reading anchors, complete-row
metadata gating, rapid row motion, pause/resume, inspection, Timeline, stale/reset/
empty projections, and stable projections during rapid arrivals. The parent
implementation pass reports all 12 browser checks, six relevant browser
recaptures after the latest copy refinement, all Go tests, Go race tests, and
40 frontend tests passing. This documentation pass did not independently rerun
those checks or certify the rendered result; independent finish review owns the
visual verdict.

No new raster assets are introduced. Projection geometry is source-native SVG.

Pre-existing drift left unmodified: the shared sidecar motion catalogue omits
navigation drawer timings already present in the incumbent stylesheet and
described in `DESIGN.md`. That omission is outside this Activity extension and
is neither canonized nor repaired here.
