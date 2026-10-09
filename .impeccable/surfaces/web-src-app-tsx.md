---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/views/Dashboard.tsx"]
---

# React dashboard redesign

Mode: Operate. Target: login and all seven monitoring routes. Audience: individual node operators checking their own node. Preserve monitoring behavior, English/German, read-only access, local geography, exact amounts, and static Go embedding. Build code-first.

## Direction contract

THESIS: A precise protocol publication made operational: meaningful data, quiet rules, and legible hierarchy replace decorative dashboard tiles.

OWN-WORLD: Warm paper #f5f3ee, ink #202420, orange actions; charcoal #171817 and pale ink in dark mode. System sans, tabular data, monospace hashes, ruled flat sections, and native-feeling controls. Both themes share hierarchy.

STORY: Operators identify health and freshness, locate their connections, compare history, and inspect peers or blocks without losing context.

FIRST VIEWPORT: Narrow desktop navigation left; status, language, theme, refresh above the workspace. The overview contains health, four key metrics, and a horizontal recent-block strip that opens actual blocks. Dedicated Mining and Node details routes join Peers, Traffic, Mempool, and Blocks. Mining begins with difficulty-period progress and the estimated next adjustment time, then a ruled pool-distribution section with its own block-window chooser, followed by the separate shared history range and hashrate/difficulty charts. Node details begins with synchronization and storage readings followed by inspectable Core information. Mempool opens with a ruled row of local conservative fee estimates for 2, 3, and 6-block targets, then existing mempool readings. Its shared range controls a full-width fee-estimate history plot before the existing activity charts; the exact data table preserves gaps and labels each target. Mobile stacks fee readings. Blocks keeps its status readings and inspectable strip, followed by a two-column block-economics chart area before the existing block table. Per-block stacked subsidy/fees, fee share, average/median fee rates, and fullness compare the latest ten validated blocks in height order; native data tables preserve exact BTC amounts, unavailable statistics stay gaps, and reward bars require both subsidy and fees. Mobile stacks the plots. The peer map, country distribution, transport breakdown, history, and searchable peer table live together on Peers. Mobile uses the same seven destinations in a navigation drawer, stacked work areas, and contained data overflow. Range filters precede history charts.

FORM: Protocol publication, grounded candidate 7, concept seed 517a1123; user selected it explicitly. Signature: the user-requested mempool-inspired recent-block tiles use geometric top and side faces within the incumbent paper/ink palette and open exact block details by hash. The selected block's static transaction mosaic sizes tiles by virtual bytes and colors them by fee-rate bands, with separate coinbase and unavailable-fee states. A wrapping pool-attribution row above the mosaic names the inferred miner or its availability state and matching method. Locally bundled official pool logos accompany names in this row and the mining distribution table, with light-theme variants where available and neutral fallbacks for unknown or missing logos; names and chart swatches retain their meaning without images. Tile selection and the initially collapsed, paginated keyboard data table open inline transaction details with exact amounts and wrapping identifiers. No category filters. Familiar product navigation and controls outrank publication metaphor. Functional 180ms block-selection feedback; no decorative entrances.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
