---
name: "Nodarium"
description: "A protocol publication for operating a Bitcoin node."
colors:
  ground: "#f5f3ee"
  surface: "#fffef9"
  rail: "#eeeade"
  ink: "#202420"
  muted: "#62695e"
  rule: "#d7d9ce"
  accent: "#9b4708"
  accent-soft: "#f3e2cd"
  success: "#28734d"
  warning: "#934c07"
  danger: "#b1372b"
  dark-ground: "#171817"
  dark-surface: "#20231f"
  dark-rail: "#24291f"
  dark-ink: "#e8e8e0"
  dark-muted: "#b4b8b0"
  dark-rule: "#3d4338"
  dark-accent: "#f3a653"
  dark-accent-soft: "#3b2d1f"
  dark-success: "#8dccab"
  dark-warning: "#f3b876"
  dark-danger: "#f09a8d"
  chart-outbound: "#ac530c"
  chart-inbound: "#287e71"
  chart-third: "#7662a0"
  chart-fourth: "#6c7629"
  dark-chart-inbound: "#78c4b4"
  dark-chart-third: "#beb0dc"
  dark-chart-fourth: "#c0c975"
  map-land: "#e0e3d7"
  map-edge: "#bac2b1"
  dark-map-land: "#2d332c"
  dark-map-edge: "#525b50"
  dark-chart-rule: "#393d38"
  dark-chart-panel: "#222620"
  overlay: "#20242066"
  dark-overlay: "#00000088"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "44px"
    fontWeight: 650
    lineHeight: 1.16
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  metric:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  mono:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
rounded:
  control: "5px"
  dialog: "12px"
  flat: "0"
spacing:
  unit: "8px"
  compact: "12px"
  control: "16px"
  section-inset: "20px"
  section: "24px"
  dialog: "32px"
  workspace: "36px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
  button-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "12px 10px"
  metric:
    textColor: "{colors.ink}"
    typography: "{typography.metric}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.flat}"
  block-strip-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.flat}"
    padding: "14px 12px"
---

# Design System: Nodarium

## Overview

**Creative North Star: "Protocol publication"**

A precise protocol publication made operational. Warm paper and ink, restrained orange, fine rules, and compact native-feeling controls give node readings a clear hierarchy. Charcoal and pale ink retain the same structure in dark mode.

The system uses the user-approved system sans, tabular figures, and monospace identifiers. Flat, ruled work areas hold substantial data without decorative elevation; motion acknowledges selection rather than introducing content.

**Key Characteristics:**

- Warm paper and ink; charcoal and pale ink in dark mode.
- Flat sections separated by fine rules.
- Tabular readings and monospace identifiers.
- Functional selection feedback and native-feeling controls.

## Colors

The primary accent is warm orange against paper and ink; the complete dark palette preserves semantic roles on charcoal. The frontmatter records the actual source values from `web/src/style.css` and `web/src/components/useChart.ts`.

### Primary

- **Action Orange** (`accent` / `dark-accent`): actions, focus outlines, active navigation, and selected blocks.
- **Orange Wash** (`accent-soft` / `dark-accent-soft`): selected controls and warning surfaces.

### Neutral

- **Paper / Charcoal** (`ground` / `dark-ground`): the workspace and chart canvas.
- **Reading Surface** (`surface` / `dark-surface`): controls, ruled panels, and dialogs.
- **Navigation Stock** (`rail` / `dark-rail`): navigation and login introduction.
- **Ink / Pale Ink** (`ink` / `dark-ink`): titles, readings, and primary button backgrounds.
- **Quiet Ink** (`muted` / `dark-muted`): labels, explanatory text, and timestamps.
- **Fine Rule** (`rule` / `dark-rule`): table lines, panel boundaries, and control strokes.
- **Overlay** (`overlay` / `dark-overlay`): modal and drawer scrims.

Success, warning, and danger pairs communicate operational states. Charts use their recorded four-series palette, with light chart orange distinct from the interface accent and dark chart orange sharing `dark-accent`. Inbound is teal and outbound orange on the map; muted land and edge pairs keep geography subordinate to observations. The dark chart rule and tooltip panel are intentionally separate chart values, not replacements for interface tokens.

**The Semantic Pairing Rule.** Switch the complete light/dark token set together. Orange marks actions and selection; success, warning, and danger describe states accompanied by text.

## Typography

**Display and Body Font:** the user-approved system sans stack recorded in the frontmatter.
**Identifier Font:** the recorded SFMono / Consolas / Liberation Mono stack; peer address buttons use its shorter SFMono / Consolas fallback.

The hierarchy is compact and practical. Sentence case, restrained weight, and tabular numerals make dense observations easier to scan.

### Hierarchy

- **Display:** login introduction; reduces to (34px) on mobile.
- **Headline:** page headings; reduces to (27px) on mobile.
- **Title:** section headings. Subheadings use (15px), weight (600), and line height (1.5).
- **Body:** explanatory copy, usually limited to (72ch). The login introduction uses (16px) on desktop.
- **Label:** timestamps and supporting text. Metric labels use (13px); table headings use (11px).
- **Metric:** principal readings; adjusts to (23px) below the wide breakpoint and (25px) on mobile.
- **Mono:** inspectable hashes and addresses. All numeric readings use tabular figures.

**The Data Legibility Rule.** Use tabular figures for readings and monospace for hashes and addresses. Keep descriptive copy in the system sans.

## Layout

The desktop shell pairs a sticky (256px) navigation rail with a flexible workspace. Content is centered within (1520px), using the workspace spacing token. The workspace column fills the viewport, placing its footer at the bottom on short pages and after the content on longer pages. The footer contains Nodarium with the automatic current year, a GitHub repository link, and the app version from build-time package metadata; mobile stacks these items. Navigation ends with sign-out, without the former hosting caption. The topbar is at least (76px) high. Whole-chain indexing appears once beneath its controls as a compact native progress bar with indexed/target block counts and a tabular percentage. The shared status poll updates every five seconds across routes. Waiting, node synchronization, paused, offline, stale, and failed-status states stay explicit; completed indexing hides the indicator. Mobile gives the status text its own line and wraps the bar and counts without page overflow. Panels have fine boundaries, section padding, and aligned headings rather than ornamental card stacks.

An (8px) base step supports common (16px), (24px), and (32px) intervals; observed (12px), (20px), and (36px) insets handle compact controls and workspace edges. Primary metrics form four columns, charts two columns, and map details a separate (240px) side column. The map canvas is (350px) high; its geography fits the available width and height.

Destination headings precede compact, URL-addressed secondary navigation. Secondary links use quiet ink and a fine baseline, with orange ink and a stronger rule for the active view; narrow layouts contain their overflow. Blocks Explorer uses a compact inline chain-context definition list above its horizontal browser. Selected historical metadata, pool attribution, and goggles occupy a separate ruled panel after the browser; Analytics has a separate two-column chart area. The browser remains mounted while hidden in Analytics, preserving selection and scroll when returning to Explorer. Surface-specific composition is recorded in `.impeccable/surfaces/web-src-app-tsx.md`.

At (1200px) and below, workspace padding narrows, the map detail column becomes (220px), and some secondary shell metadata is hidden. At (767px) and below, the rail becomes a drawer, content uses (28px 20px) padding, primary metrics form two columns, and chart/map sections stack. The map canvas becomes (260px) high. Dense data tables and the block browser scroll within their containers; selected block details stay within the viewport. Peer tables emphasize address, direction, and latency while the dialog exposes full details.

## Elevation & Depth

Monitoring panels have no shadows. Surface color and one-pixel rules establish depth. Only the peer dialog and mobile navigation drawer use the theme shadow and an overlay; the exact shadow values live in the sidecar.

**The Flat Workspace Rule.** Keep monitoring sections flat and ruled. Reserve shadows for the peer dialog and navigation drawer.

## Shapes

Ruled sections and adjacent block cells have square corners. Small control rounding uses the control token; the peer dialog uses the dialog token. The brand mark keeps a fixed (34px × 38px) footprint with a compact (4px) radius and a filled (23px) Bitcoin symbol in the theme accent. Status dots and plot points are circular because they encode state or location.

## Components

### Buttons

Native-feeling, compact, and plainly actionable. Neutral buttons use a surface fill and fine rule. Primary login buttons reverse ink and surface, with orange on hover. Hover on neutral controls uses the rail and muted border; active uses orange wash. Every interactive element has a (2px) focus outline offset by (3px). Disabled buttons use opacity (0.55). Icon buttons keep at least a (40px) square target; map controls use (34px).

### Inputs / Fields

Surface-filled fields use the same control rounding and fine-rule border as buttons, with the recorded control padding and minimum (40px) height. Placeholders use quiet ink. Native language and theme selects omit their border and background in the shell.

### Cards / Containers

Flat panels use surface fill, a one-pixel fine rule, square corners, and section spacing. Headings use (20px 24px) insets, becoming (20px) on mobile. Tables share these rules and contain their own overflow. Empty states use a clear title and explanation within the same area.

### Tables

Peer lists, expanded history readings, and block transaction tables share contained vertical scrolling with native table semantics, sticky column headers, a localized row total, and a scrolling hint. Long lists (more than 50 rows) render a measured row window with overscan; shorter lists remain fully mounted. The viewport is bounded at (480px), capped at (65vh) on mobile; expanded history data uses a shorter (260px) viewport. Dense columns scroll horizontally within the container, preserving the mobile page width.

Peer search, direction filters, and sort changes return the list to the beginning; live refresh retains the scroll position. Changing the history range or selected block also resets its corresponding table. Stable row identity preserves selection and the invoking peer or transaction control while details are inspected. Tab traversal reaches rows beyond the mounted window; interactive rows also support Up/Down and Home/End. Accessible row totals and absolute row indices retain each mounted row's position in the full table. The peer connection table precedes its historical and geographic work areas.

### Navigation

The rail provides Mempool, Blocks, Mining, and My node destinations in that order, each with a quiet icon and sentence-case label. A (24px) gap before My node separates personal node operations from network exploration. Each destination exposes its views through secondary links beneath the page heading; the node status badge links to My node Overview. Active items use orange wash and orange ink, with weight (600); hover uses a surface fill. Links have a minimum (44px) height. Mobile uses the same navigation inside a modal drawer with the theme scrim and shadow.

A toggle beside the desktop brand switches the (256px) rail to a (76px) icon rail. Collapsed navigation and sign-out controls keep accessible names and localized hover titles; the toggle exposes its expanded state and retains keyboard focus. The preference persists locally when browser storage is available. The mobile drawer always retains full labels, independent of the desktop preference; short desktop viewports allow the rail to scroll. Desktop expansion takes (280ms) and collapse (220ms), with a decelerating grid resize, clipped fading labels, and a moving toggle. The mobile drawer slides in over (280ms) and exits over (180ms), with a short scrim fade. Interrupted transitions continue from the current position; reduced motion switches navigation immediately while retaining focus and state feedback.

### Metrics and status

My node Overview combines synchronization health with six metric readings: height, peers, uptime, blockchain disk usage, Nodarium database size, and node mode. They form three columns and two rows on desktop, then two columns and three rows on mobile, with (24px) between rows and first-column alignment preserved on each row. Database size uses the existing byte formatter, tabular metric type, and quiet localized detail for SQLite journals, in-memory allocation, PostgreSQL, stale readings, or unavailable data. The ruled Core-information definition list follows; the best block hash uses the identifier font and wraps within the available width. Peers places the searchable connection table before history charts, the map, country distribution, and transport breakdown. Metric definition lists use quiet labels above tabular readings. Fine vertical rules separate desktop metrics; mobile retains them between paired columns. Status badges pair a small colored dot with readable state text. Warning banners retain explanation and stale-data context.

### Currency display

The compact BTC/EUR/USD native select sits beside language and theme controls. Displayed fiat amounts carry native hover metadata with source, as-of time, and the current-rate basis for historical amounts. BTC amounts retain their primary hierarchy; approximate fiat is a secondary line in the existing label type (12px), normal weight, tabular figures, and quiet ink. Stale values use the incumbent warning color with readable text. Wrapping preserves the mobile page width in both themes and languages. Fee-rate units, chart axes, and chart colors retain their established meaning.

### Live readings and history controls

Mempool Live opens with the three Core fee targets in a ruled reading area. Mobile stacks compact label/value rows and retains each target’s timestamp, freshness, returned-target explanation, and error state. Full-mempool projection readings and static fee-group mosaics follow, with a concise estimate warning before the readings and the detailed method in a native disclosure below. Source status and the explicitly labeled live-tracking pause control precede sampled arrivals and their animated table. A final native disclosure holds the original polled mempool count, virtual size, memory, and policy readings.

Mempool Trends groups fee, backlog, memory, and acceptance-floor history. View-specific history ranges appear before their charts and are remembered within the browser tab when optional session storage is available. Pool history carries its range in links and query parameters; block economics has its own remembered native select. Traffic combines download and upload in one full-width plot with accessible series-toggle buttons; its upload budget and cumulative Core totals follow. Existing series colors, null gaps, textual legends, and expandable data tables retain their meaning.

### Block browser and block strips

Inspectable block tiles form a horizontally scrollable sequence with contained overflow. Each square-cornered compact tile is (148px) wide and at least (184px) high, separated by (24px). The historical browser uses the same geometry with a minimum (204px) height for the full timestamp. Geometric top and side faces (12px) give the user-requested mempool-inspired block silhouette. The faces use navigation stock and fine rules, keeping this functional geometry within the paper/ink palette. A tabular block height leads the median fee rate in sat/vB, size, transaction count, compact time/tip text, and a thin capacity bar. Supporting labels use (11px). A selected tile changes to orange wash, orange ink, and an orange border with (180ms ease-out) feedback. Selection is keyed to the real block hash and opens the corresponding details and transaction mosaic.

The Blocks browser adds a native height input and Go button in its section heading, followed by a readable scrolling hint and paired newer/older arrow controls. Its horizontal ordered list communicates each block's position in the chain. Cursor pages load through scrolling, touch, or arrows in either direction; at most ten (50-block) pages remain loaded, with visible tiles and four tiles of overscan rendered. Page insertion and eviction preserve the visible block hash and scroll offset. Left/Right traverse tiles and can continue across an asynchronous page boundary; Home/End and Tab reach loaded tiles. A return-to-latest button announces new blocks without moving the historical blocks being read. Indexing progress lives in the shared topbar. The backfill frontier, pruning, offline data, request failures, and reorganizations retain local explanatory notices. Opening a selected block moves focus into its separate panel below the browser; selection survives tile eviction, and closing restores the invoking control when it remains mounted.

### Transaction mosaic and details

The on-demand transaction mosaic uses a static treemap within the selected block's ruled detail area. Each tile's area is proportional to transaction virtual size; block overhead is excluded. The existing chart palette distinguishes fee rates below (5 sat/vB), from (5) to below (20 sat/vB), and at least (20 sat/vB), with separate coinbase and unavailable-fee colors. A textual legend explains each band. The canvas is (360px) high, becoming (300px) on mobile, and selection has a contrasting ink border. Clicking a tile opens its transaction details inline. An initially collapsed native data table offers the same selection through keyboard-accessible transaction buttons, using the shared contained virtual scrolling pattern, sticky headers, row totals, and retained inspection focus.

Historical summary readings remain inspectable when Core no longer retains the block body. The actual mosaic and transaction details require retained Core blocks; their unavailable state uses readable explanations within the same selected-block area.

Block attribution sits above the mosaic as a compact, wrapping row: a quiet mining-pool label, a stronger pool name with its website link when available, and the coinbase-tag or payout-address matching method. The row vertically centers its text and (24px) pool logo so image baselines do not lift the pool name above neighboring labels. Unknown, unavailable, and unsupported attribution retain readable state text and a short explanation that identity is inferred. The row wraps naturally on mobile rather than widening the detail area.

Transaction details use a wrapping monospace identifier and a flat definition list with three metric columns on desktop and two on mobile. Labels explicitly distinguish transaction size and weight from block measurements. Inputs and outputs occupy two columns on desktop and stack on mobile, separated by fine rules; long addresses and references wrap. BTC amounts show all eight decimal places. Missing fees and prevouts retain explicit unavailable states, while an explanatory note identifies output totals as including change. Full identifiers use a native disclosure. Opening the panel moves focus into it; closing restores the invoking control when it remains available.

Country distribution uses sorted horizontal bars alongside localized country names, exact peer counts, and percentages. Each name has a decorative, locally bundled SVG flag from flag-icons (24px × 18px), edged with the existing fine-rule token; only displayed flags load, with no external image requests. Unknown or unavailable country icons use a quiet globe (18px) in the same footprint, while the readable name remains the accessible label. Unknown countries remain a separate group; share widths use all peers in the same geography snapshot. Bars are static and counts remain readable without color.

Mining Network opens with its difficulty-period panel. Three tabular readings show progress, remaining blocks, and the next adjustment height above a native, accessible linear progress bar in the accent color. On mobile, progress spans the full width above the other two readings. Supporting text identifies the validated height and syncing state; stale readings retain their values with a notice. Unsupported networks and missing heights show an explanation without a fabricated bar or timing estimate.

Pool distributions use a flat section with top and bottom rules. A centered static donut sits above a compact wrapping legend of named pools, local logos, and tabular percentages. Pool names link to details, exact block counts remain in tooltips and accessible legend text, and duplicate ranking tables are omitted. The donut uses the existing four-series chart palette, repeated as needed, with the muted map-edge color for Unknown; small square legend swatches connect each pool to its segment without replacing the name. The sample chooser uses the existing orange active-control treatment for (144) and (1,008) blocks. A quiet caption keeps blocks read, target count, and latest height together. Backfill progress lives in the shared topbar; the sample caption and local partial, unavailable, syncing, unsupported, stale, and failed-request states remain explicit, with retry available for request failures. Explanatory copy identifies coinbase tags and payout addresses as inferred attribution, includes Unknown in observed block shares, and distinguishes those shares from measured hash power. A source link points to the exact mempool/mining-pools definitions revision.

Mining Network pairs hashrate and difficulty history in two ruled chart panels after its history range; recent and historical pool distributions belong to the separate Pools view. Current readings share the existing tabular metric style above the plots. The hashrate plot uses solid orange and dashed teal lines for the two block windows, with locale-aware SI units and a data table. Difficulty uses a stepped line and explicitly labels historical interval averaging. Panels stack on mobile; the shared history range controls both. Missing estimates stay absent, with stale and syncing notices.

Blocks Analytics keeps the two-column ruled chart arrangement, stacking on mobile, ordered by utilization, fee rates, subsidy and fees, then fee share. Its heading contains a native range select for recent blocks, 24 hours, seven days, 30 days, one year, and all indexed history. Recent plots compare blocks in height order; historical plots use time buckets and expandable virtual data tables with block counts. Utilization, average and median fee-rate lines, stacked subsidy/fee bars, and fee share reuse the chart palette and textual legends. Copy distinguishes bucket averages from exact block amounts, while local notices identify missing statistics and stale data; incomplete indexing is shown once in the topbar.

Charts use static lines, small point marks, textual legends, and expandable data tables. Null readings remain visible as gaps. The peer map restores five-second moving dots with short trails along connection lines. These pause for stale or failed readings, offscreen or hidden maps, and reduced motion. They represent connections, not measured packets or physical routes. Reduced-motion preference removes transitions; charts and maps have no entrance animation.

## Do's and Don'ts

### Do:

- **Do** use the semantic theme pairs so light and dark retain the same hierarchy.
- **Do** place labels beside status color and provide legible text alternatives to charts.
- **Do** preserve contained horizontal scrolling for dense tables and the block strip.
- **Do** use the named Data Legibility rule for values and identifiers.
- **Do** retain visible focus outlines and respect reduced motion.

### Don't:

- **Don't** turn monitoring panels into floating cards; use fine rules and tonal separation.
- **Don't** use animation for chart entrances or continuous decorative effects.
- **Don't** replace monospace identifiers with clipped text that cannot be inspected.
- **Don't** let dense data widen the mobile page.
