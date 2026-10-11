---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/views/Dashboard.tsx", "web/src/views/PoolDetail.tsx", "web/src/components/PoolHistory.tsx"]
---

# React monitoring workspace

Mode: Operate. Target: login, four primary destinations, their secondary views, and existing pool details. Audience: individual node operators checking their own node. Preserve monitoring behavior, English/German, read-only access, local geography, exact amounts, and static Go embedding. Build code-first.

## Direction contract

THESIS: A precise protocol publication made operational: meaningful data, quiet rules, and legible hierarchy replace decorative dashboard tiles.

OWN-WORLD: Warm paper #f5f3ee, ink #202420, orange actions; charcoal #171817 and pale ink in dark mode. System sans, tabular data, monospace hashes, ruled flat sections, and native-feeling controls. Both themes share hierarchy.

STORY: Operators identify health and freshness, locate their connections, compare history, and inspect peers or blocks without losing context.

FIRST VIEWPORT: Desktop navigation lists Mempool, Blocks, Mining, and My node, with a gap before My node; mobile uses the same destinations in its fully labeled drawer. The root opens Mempool Live. A remembered icon-only desktop rail, localized hover titles, accessible names, persistent keyboard focus, reduced-motion handling, and the incumbent navigation timings remain. Status, language, theme, refresh, and one shared whole-chain indexing row sit above the workspace; the status badge links to My node Overview. The bottom-aligned footer retains the current year, repository link, and build-time package version.

Each destination has compact URL-addressed secondary navigation: Mempool Live (`/mempool`) and Trends (`/mempool/trends`); Blocks Explorer (`/blocks`) and Analytics (`/blocks/analytics`); Mining Network (`/mining`) and Pools (`/mining/pools`); My node Overview (`/node`), Peers (`/node/peers`), Traffic (`/node/traffic`), and Events (`/node/events`). Active secondary links use the incumbent orange and fine-rule vocabulary, with contained overflow on narrow screens. Unknown and retired URLs show localized page-not-found content without redirects.

Mempool Live opens with conservative Core fee estimates for 2, 3, and 6-block targets. Mobile uses compact stacked label/value rows while preserving each target’s timestamp, returned target, stale state, and error. The full-mempool backlog and static projected-block mosaics follow, with a concise estimate warning up front and the original detailed method in a native disclosure beneath them. Source status and the explicitly scoped live-tracking pause control precede observed-arrival/sample metrics and the animated transaction table. A final native disclosure retains the original polled count, virtual size, memory, and policy readings. Pausing holds the projection and arrival sample; fee estimates and polled node readings continue independently. Trends owns fee-estimate, backlog, memory/virtual-size, and acceptance-floor history, preserving all exact tables and null gaps.

Blocks Explorer uses compact chain context before its cursor-backed browser and height search. Its horizontal scrolling, touch/arrow controls, 50-block cursor pages, ten-page bound, visible-block anchoring, keyboard traversal, return-to-latest, pruning/reorganization notices, and separately focused selected-block panel remain. Actual transaction goggles and details retain their Core availability limits. The browser stays mounted but hidden during Analytics so selection and browser scroll survive a return to Explorer. Analytics owns block economics, ordered utilization, fee rates, subsidy/fees, then fee share; its two-column ruled plots stack on mobile. Its native range select and exact recent-block versus historical-average semantics remain.

Mining Network begins with difficulty-period progress and estimated adjustment time, then its own remembered network-history range and hashrate/difficulty charts. Pools owns recent observed distribution and historical shares, each with its existing sample or period control. Historical pool range is remembered within the browser tab and reflected in the URL query; detail links carry it. Existing pool details stay at `/mining/pools/:id` and return to Pools with their selected range.

My node Overview consolidates health, synchronization, storage, and inspectable Core information. Its six metrics are height, peers, uptime, blockchain disk usage, Nodarium database size, and node mode, in three columns/two rows on desktop and two columns/three rows on mobile. The database reading reuses localized byte formatting and quiet EN/DE detail; it retains its last value marked stale after refresh errors and shows a dash with unavailable copy before a reading exists. Peers puts the searchable connection table before its range, history charts, map, countries, and transport breakdown. Traffic puts current rates and its remembered range before one combined full-width download/upload chart with independently toggleable series; upload budget and cumulative Core totals follow. Events contains the former Activity Timeline, preserving observations, category filters, coverage limits, explicit new-event refresh, and inline block inspection.

Monitoring ranges are remembered separately for Mempool Trends, Peers, Traffic, and Mining Network in optional session storage. Block economics has its own remembered range; pool history also has its URL query. Storage failure falls back to usable controls. Peer lists, history readings, and transaction tables keep contained virtual scrolling, native table semantics, sticky headers, row totals, keyboard access, refresh scroll retention, and inspection focus. English/German, local geography, source distinctions, freshness, missing coverage, and data gaps retain their established meaning.

FORM: Protocol publication, grounded candidate 7, concept seed 517a1123; user selected it explicitly. Signature: the user-requested mempool-inspired block tiles share geometry between existing block-strip uses and Explorer’s historical browser, using geometric top and side faces within the incumbent paper/ink palette and open exact block details by hash. The selected block's static transaction mosaic sizes tiles by virtual bytes and colors them by fee-rate bands, with separate coinbase and unavailable-fee states. The persistent summary index stores headers, raw Core block statistics, and compact coinbase/pool evidence; its resumable whole-chain worker also serves mining distributions. Complete transactions and mosaic records are not archived. A wrapping pool-attribution row above the mosaic names the inferred miner or its availability state and matching method. Locally bundled official pool logos accompany names in this row and the mining donut legend, with light-theme variants where available and neutral fallbacks for unknown or missing logos; names and chart swatches retain their meaning without images. Tile selection and the initially collapsed, virtual-scrolling keyboard data table open inline transaction details with exact amounts and wrapping identifiers. No category filters. Familiar product navigation and controls outrank publication metaphor. Functional 180ms block-selection feedback; no decorative entrances.

Country distribution pairs each readable country name with a locally bundled SVG flag from flag-icons. Flags are small factual geography cues, not replacements for names or counts; unknown or unsupported country codes use a quiet globe. No external flag requests, changes to geography resolution, or chart-color changes.

Mining Pools retains the recent pool-distribution donut with a compact wrapping legend of local logos, clickable pool names, and percentages. Exact counts remain available through chart tooltips and accessible legend text. Duplicate pool ranking tables are omitted. A separate historical pool section follows the recent distribution; network history remains in Mining Network. Its native select offers 24 hours, seven days, 30 days, one year, and all indexed history. Coverage and attribution notices precede a static stacked share plot with four leading identified pools, grouped other identified pools, and separate Unknown and Unavailable series. The chart legend links its leading pools to detail pages and carries the selected range. The expandable chart data uses the existing contained virtual table. Shares use all indexed active-chain blocks within the exact period; empty buckets remain gaps.

Pool details keep Mining active in navigation and begin with a back link to Pools carrying the selected historical range, a wrapping pool name beside its local logo, and the pool website link when available. The activity heading places the same native range select before coverage text. Five tabular metrics show attributed blocks, observed share, coinbase-only frequency, average utilization, and average fees excluding subsidy. The desktop grid uses three columns; mobile uses pairs and gives the precise eight-decimal BTC fee reading a full-width final row. Each data-dependent average exposes its own available-block sample count. A static pool-share line and expandable virtual data table follow the metrics. The latest 20 indexed pool blocks across all history use the existing horizontal block strip, full localized timestamps, and goggles inspection. Pool detail composition extends the incumbent paper/ink and charcoal system without new tokens or decorative motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance


## Documentation evidence

The structural merge follows `web/src/App.tsx` routes and status link,
`web/src/views/Dashboard.tsx` secondary navigation and section ordering,
`web/src/views/Activity.tsx` live/timeline placement,
`web/src/components/ProjectedBlocks.tsx` native method disclosure,
`web/src/components/BlockEconomics.tsx` plot order and range,
`web/src/components/HistoryChart.tsx` traffic-series controls,
`web/src/components/PoolHistory.tsx` and `web/src/views/PoolDetail.tsx` range links,
`web/src/useRememberedRange.ts`, and incumbent shell/mobile rules in
`web/src/App.module.css` and `web/src/style.css`. English and German locale files
retain typed route labels and scope the pause control to live tracking.

Database-size source evidence is `internal/storage/size.go` for the canonical
SQLite main path plus WAL/SHM file sizes, allocated pages for in-memory SQLite,
and PostgreSQL’s whole configured database (including shared schemas/tables).
`internal/collector/collector.go` refreshes the reading after history storage each
cycle independently of Core health, preserving the last successful value on
errors. `internal/server/server.go` exposes the independent overview `database`
section; `web/src/views/Dashboard.tsx`, `web/src/style.css`, and EN/DE locales
supply the six-metric responsive grid, byte formatting, and state explanations.

This pass reconciles source documentation; it did not independently certify
rendered output or run the complete regression suite. `DESIGN.md` token
frontmatter is preserved,
no visual world or global token is introduced, and `.impeccable/design.json`
remains unchanged. The pre-existing newer-DESIGN.md/older-sidecar drift is left
alone. No raster asset is introduced.
