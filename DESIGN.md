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

The desktop shell pairs a sticky (256px) navigation rail with a flexible workspace. Content is centered within (1520px), using the workspace spacing token. The topbar is at least (76px) high. Panels have fine boundaries, section padding, and aligned headings rather than ornamental card stacks.

An (8px) base step supports common (16px), (24px), and (32px) intervals; observed (12px), (20px), and (36px) insets handle compact controls and workspace edges. Primary metrics form four columns, charts two columns, and map details a separate (240px) side column. The map canvas is (350px) high; its geography fits the available width and height.

The Blocks page places status readings and the inspectable block strip before the block table and its expanded block details. Block economics follows the table so aggregate charts do not interrupt block inspection.

At (1200px) and below, workspace padding narrows, the map detail column becomes (220px), and some secondary shell metadata is hidden. At (767px) and below, the rail becomes a drawer, content uses (28px 20px) padding, primary metrics form two columns, and chart/map sections stack. The map canvas becomes (260px) high. Block tables and the block strip scroll within their containers; selected block details stay within the viewport. Peer tables emphasize address, direction, and latency while the dialog exposes full details.

## Elevation & Depth

Monitoring panels have no shadows. Surface color and one-pixel rules establish depth. Only the peer dialog and mobile navigation drawer use the theme shadow and an overlay; the exact shadow values live in the sidecar.

**The Flat Workspace Rule.** Keep monitoring sections flat and ruled. Reserve shadows for the peer dialog and navigation drawer.

## Shapes

Ruled sections and adjacent block cells have square corners. Small control rounding uses the control token; the peer dialog uses the dialog token. The brand mark has a compact (4px) radius. Status dots and plot points are circular because they encode state or location.

## Components

### Buttons

Native-feeling, compact, and plainly actionable. Neutral buttons use a surface fill and fine rule. Primary login buttons reverse ink and surface, with orange on hover. Hover on neutral controls uses the rail and muted border; active uses orange wash. Every interactive element has a (2px) focus outline offset by (3px). Disabled buttons use opacity (0.55). Icon buttons keep at least a (40px) square target; map controls use (34px).

### Inputs / Fields

Surface-filled fields use the same control rounding and fine-rule border as buttons, with the recorded control padding and minimum (40px) height. Placeholders use quiet ink. Native language and theme selects omit their border and background in the shell.

### Cards / Containers

Flat panels use surface fill, a one-pixel fine rule, square corners, and section spacing. Headings use (20px 24px) insets, becoming (20px) on mobile. Tables share these rules and contain their own overflow. Empty states use a clear title and explanation within the same area.

### Tables

Peer lists, expanded history readings, and block transaction tables share contained vertical scrolling with native table semantics, sticky column headers, a localized row total, and a scrolling hint. Long lists (more than 50 rows) render a measured row window with overscan; shorter lists remain fully mounted. The viewport is bounded at (480px), capped at (65vh) on mobile; expanded history data uses a shorter (260px) viewport. Dense columns scroll horizontally within the container, preserving the mobile page width.

Peer search, direction filters, and sort changes return the list to the beginning; live refresh retains the scroll position. Changing the history range or selected block also resets its corresponding table. Stable row identity preserves selection and the invoking peer or transaction control while details are inspected. Tab traversal reaches rows beyond the mounted window; interactive rows also support Up/Down and Home/End. Accessible row totals and absolute row indices retain each mounted row's position in the full table. The compact overview peer preview remains five rows without a scrolling hint.

### Navigation

The rail provides Overview, Node details, Mining, Peers, Traffic, Mempool, and Blocks destinations, each with a quiet icon and sentence-case label. Active items use orange wash and orange ink, with weight (600); hover uses a surface fill. Links have a minimum (44px) height. Mobile uses the same navigation inside a modal drawer with the theme scrim and shadow.

A toggle beside the desktop brand switches the (256px) rail to a (76px) icon rail. Collapsed navigation and sign-out controls keep accessible names and localized hover titles; the toggle exposes its expanded state and retains keyboard focus. The preference persists locally when browser storage is available. The mobile drawer always retains full labels, independent of the desktop preference; short desktop viewports allow the rail to scroll.

### Metrics and status

The compact overview combines health, four key metrics, the recent-block strip, and text links to focused pages. Node details combines synchronization health, height, uptime, disk usage, and node mode with a ruled Core-information definition list; the best block hash uses the identifier font and wraps within the available width. Peers groups the map, country distribution, transport breakdown, history charts, and searchable peer table. Metric definition lists use quiet labels above tabular readings. Fine vertical rules separate desktop metrics; mobile retains them between paired columns. Status badges pair a small colored dot with readable state text. Warning banners retain explanation and stale-data context.

### Recent-block strip

Inspectable block tiles form a horizontally scrollable sequence with contained overflow. Each square-cornered tile is (148px) wide and at least (184px) high, separated by (24px); geometric top and side faces (12px) give the user-requested mempool-inspired block silhouette. The faces use navigation stock and fine rules, keeping this functional geometry within the paper/ink palette. A tabular block height leads the median fee rate in sat/vB, size, transaction count, compact time/tip text, and a thin capacity bar. Supporting labels use (11px). A selected tile changes to orange wash, orange ink, and an orange border with (180ms ease-out) feedback. Selection is keyed to the real block hash and opens the corresponding details and transaction mosaic.

### Transaction mosaic and details

The on-demand transaction mosaic uses a static treemap within the selected block's ruled detail area. Each tile's area is proportional to transaction virtual size; block overhead is excluded. The existing chart palette distinguishes fee rates below (5 sat/vB), from (5) to below (20 sat/vB), and at least (20 sat/vB), with separate coinbase and unavailable-fee colors. A textual legend explains each band. The canvas is (360px) high, becoming (300px) on mobile, and selection has a contrasting ink border. Clicking a tile opens its transaction details inline. An initially collapsed native data table offers the same selection through keyboard-accessible transaction buttons, using the shared contained virtual scrolling pattern, sticky headers, row totals, and retained inspection focus.

Block attribution sits above the mosaic as a compact, wrapping row: a quiet mining-pool label, a stronger pool name with its website link when available, and the coinbase-tag or payout-address matching method. The row vertically centers its text and (24px) pool logo so image baselines do not lift the pool name above neighboring labels. Unknown, unavailable, and unsupported attribution retain readable state text and a short explanation that identity is inferred. The row wraps naturally on mobile rather than widening the detail area.

Transaction details use a wrapping monospace identifier and a flat definition list with three metric columns on desktop and two on mobile. Labels explicitly distinguish transaction size and weight from block measurements. Inputs and outputs occupy two columns on desktop and stack on mobile, separated by fine rules; long addresses and references wrap. BTC amounts show all eight decimal places. Missing fees and prevouts retain explicit unavailable states, while an explanatory note identifies output totals as including change. Full identifiers use a native disclosure. Opening the panel moves focus into it; closing restores the invoking control when it remains available.

Country distribution uses sorted horizontal bars alongside localized country names, exact peer counts, and percentages. Each name has a decorative, locally bundled SVG flag from flag-icons (24px × 18px), edged with the existing fine-rule token; only displayed flags load, with no external image requests. Unknown or unavailable country icons use a quiet globe (18px) in the same footprint, while the readable name remains the accessible label. Unknown countries remain a separate group; share widths use all peers in the same geography snapshot. Bars are static and counts remain readable without color.

The mining page opens with its difficulty-period panel. Three tabular readings show progress, remaining blocks, and the next adjustment height above a native, accessible linear progress bar in the accent color. On mobile, progress spans the full width above the other two readings. Supporting text identifies the validated height and syncing state; stale readings retain their values with a notice. Unsupported networks and missing heights show an explanation without a fabricated bar or timing estimate.

Pool distributions use a flat section with top and bottom rules. A static donut sits beside a table of named pools, exact block counts, and tabular percentages; below the mobile breakpoint the donut precedes the table. The donut uses the existing four-series chart palette, repeated as needed, with the muted map-edge color for Unknown; small square table swatches connect each row to its segment without replacing the name. The sample chooser uses the existing orange active-control treatment for (144) and (1,008) blocks. A quiet caption keeps blocks read, target count, and latest height together. Backfill pairs readable progress text with a native accent-colored progress bar; partial, unavailable, syncing, unsupported, stale, and failed-request states remain explicit, with retry available for request failures. Explanatory copy identifies coinbase tags and payout addresses as inferred attribution, includes Unknown in observed block shares, and distinguishes those shares from measured hash power. A source link points to the exact mempool/mining-pools definitions revision.

The mining page pairs hashrate and difficulty history in two ruled chart panels after the shared history range. Current readings share the existing tabular metric style above the plots. The hashrate plot uses solid orange and dashed teal lines for the two block windows, with locale-aware SI units and a data table. Difficulty uses a stepped line and explicitly labels historical interval averaging. Panels stack on mobile; the shared history range controls both. Missing estimates stay absent, with stale and syncing notices.

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
