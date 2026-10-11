---
version: 1
slug: "web-src-views-activity-tsx"
primary_target: "web/src/views/Activity.tsx"
related_targets: ["web/src/components/ActivityScene.tsx", "web/src/activity.ts", "web/src/style.css", "web/src/locales/en.ts", "web/src/locales/de.ts"]
---

Mode: Operate with an optional live visual. Audience: individual node operators. Approved implementation plan: ZMQ sequence with RPC fallback, SSE, sampled ephemeral transactions and a quiet 30-day timeline. No watchlist, notifications or RSS. Code-first; inherit DESIGN.md.

## Direction contract

THESIS: Show the journey from waiting transactions into a validated block, with an equally accessible quiet event history.
OWN-WORLD: Incumbent warm paper, ink, orange actions and charcoal dark theme; flat ruled workspace, tabular readings, native controls.
STORY: Operators see observed arrivals, identify the event source and coverage, pause movement, then investigate confirmed blocks or node outages.
FIRST VIEWPORT: Heading and Live/Timeline tabs precede source status and pause control. A large two-region scene pairs a waiting transaction field with the latest validated block. Counts and a sampled transaction table follow; Timeline replaces the scene with category controls and contained virtual history.
FORM: Precisely specified extension from the approved plan; transaction movement is the signature, no concept tournament or decorative entrances. Unknown amount/size/fees remain explicitly unknown, sampled coverage is visible, and reduced motion stays static. Exact BTC amounts lead the sampled transaction table.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implemented surface guidance

This is an ordinary extension of the incumbent system. `DESIGN.md` and
`.impeccable/design.json` remain the shared authority; these Activity-specific
facts do not introduce global tokens or replace the existing design rules.

- Keep the Live scene before its supporting readings. Source status and the
  pause control follow the Live/Timeline selector; the scene is followed by the
  fee legend, three observed/sample readings, coverage explanation, and a native
  disclosure for sampled transaction details.
- Reuse semantic theme variables for rules, controls, status, and copy. Reuse
  `chartPalette` for fee bands: fourth series below 5 sat/vB, first series from
  5 to below 20 sat/vB, third series at least 20 sat/vB, and neutral land for
  pending metadata. Both the scene and its readable legend use these assignments.
  The scene has fine top/bottom rules and no shadow.
- Reuse the system sans heading/body hierarchy, shared tabular `Metric` readings,
  and the identifier monospace style. Scene headings use a local (16px) variation;
  this does not redefine the shared title token. The sampled table leads with
  exact eight-decimal BTC amounts in the system sans at weight (600), using
  tabular figures and no wrapping. Transaction identifiers follow in monospace,
  remain selectable, wrap anywhere, and expose the full transaction ID in their
  title attribute; virtual size and fee rate remain supporting columns. The
  table has a (900px) minimum width, reserving (240px) for amount, (140px) for
  virtual size, and (160px) for fee rate; the remaining width belongs to the
  identifier. Headers and other cells use normal whitespace. Narrow screens
  scroll the table inside the existing container, with the complete leading
  amount visible at the initial scroll position.
- Amounts sum all transaction outputs, including change and excluding fees,
  explained by the localized note before the table. Integer decimal satoshi
  strings in `output_sats` retain exact values through formatting. Unknown
  amounts show an em dash with a localized pending title; known zero shows
  eight decimal places and BTC. Output totals are ephemeral sampled metadata
  fetched by the bounded worker, without changing the timeline database schema.
- The scene canvas is (400px) high. Below (600px) of scene-container width it
  becomes (480px) high and stacks waiting transactions above the observed block.
  The source line wraps onto its own row below the existing (767px) breakpoint.
  Metrics reuse the three-column grid and become two columns on mobile.
- Tile area represents known virtual size. Pending metadata uses a neutral
  placeholder weight with no size meaning, explained in EN/DE copy and identified
  in the data table. The displayed sample is bounded at 500 transactions; neither
  the scene nor observed arrivals claims complete mempool coverage.
- Movement responds to observation changes over (800ms) with a decelerating
  interpolation. A changed observation generation seeds a static baseline.
  The renderer persists across live readings within the current theme. It resizes
  the canvas backing store only when its physical dimensions change and paints
  synchronously after a resize or retarget. Readings with unchanged destinations
  preserve an animation already in progress, keeping frequent ZMQ updates from
  clearing the waiting field or restarting its movement.
  Reduced motion settles immediately; pause, hidden document, and disconnected
  stream states settle the scene. The Live SSE connection closes while paused or
  hidden and reopens when active. This local motion describes observed transaction
  movement and introduces no decorative entrance rule for other surfaces.
- Timeline stays quiet: connection changes, blocks, and reorganizations have
  readable event text and a native category select. Incoming events expose a
  "Show new events" action instead of replacing the history being read. Cursor
  loading retains at most ten pages; category or explicit refresh changes reset
  the table. EN/DE copy explains the 30-day/100,000-event retention and observation
  gaps without promising backfill.
- Both tables reuse `VirtualTable` with native table semantics, sticky headers,
  row totals, and contained scrolling. Their row renderers return cell fragments;
  `VirtualTable` owns each `tr`. Timeline uses a (1000px) minimum table width,
  with (220px) observation and (280px) block columns, allowing the existing
  container to scroll horizontally on narrower screens.
- Inspect buttons reuse `BlockGoggles` in a separate ruled panel. Opening moves
  focus into that panel; closing restores the invoking element when it remains
  mounted. Existing inspector behavior remains the source for block and
  transaction details.
- Reuse `Notice` and `Empty` for waiting, resynchronizing, unavailable, capacity,
  persistence, loading, and retry states. Copy is in the existing typed English
  and German locale objects; node diagnostics and unknown metadata remain honest.

## Documentation evidence

Source checked: `Activity.tsx`, `ActivityScene.tsx`, `activity.ts`, the appended
Activity rules and incumbent primitives in `style.css`, typed EN/DE locales,
`VirtualTable.tsx`, `useChart.ts`, and exact BTC formatting in `format.ts`.
Output-total data truth checked in `docs/activity.md`,
`internal/activity/service.go`, and `internal/explorer/explorer.go`.
Product context and shared system checked:
`PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json`.

Regression coverage checked in source: `ActivityScene.test.tsx` covers rapid
same-size readings, unchanged destinations during movement, pause, and cleanup;
`web/e2e/activity.spec.ts` covers (100ms) arrivals without blank frames or canvas
bitmap resizes, EN/DE cell containment, pause/resume, inspection focus, and axe.
The sampled amount fixtures distinguish unknown, zero, one satoshi, and
21 million BTC without dropping eight-decimal precision.

This source documentation pass does not certify rendered behavior or the finish
review verdict. Independent reviewer captures and scoring own that verdict. No
generated raster assets are introduced by the Activity scene; it is drawn in canvas.

Pre-existing drift left unmodified: the shared sidecar motion catalogue omits
navigation drawer timings already present in the incumbent stylesheet and
described in `DESIGN.md`. That omission is not an Activity rule and is not
canonized or repaired during this ordinary extension.
