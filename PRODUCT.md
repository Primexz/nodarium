# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual Bitcoin node operators who want quick checks and troubleshooting for
their own Bitcoin Core node. They need to understand node health, connected peers,
traffic, the mempool, and recent blocks without assembling that information from
RPC calls themselves.

## Product Purpose

Nodarium is a lightweight, self-hosted Bitcoin node explorer and monitoring
dashboard. It connects to an existing Bitcoin Core node and makes its current
state and collected history accessible in one place.

Success means an operator can quickly determine whether the node is healthy,
investigate an unexpected reading, and distinguish current observations from
stale, missing, or unavailable data.

## Positioning

The product combines read-only monitoring of the operator's own node, historical
charts, and locally resolved peer geography in a self-hosted application. SQLite
is included for a deployment without a separate database service; PostgreSQL is
an alternative. No exclusive market or performance claims are established.

## Operating Context

- One Nodarium instance monitors one node and uses one database. Bitcoin Core
  runs separately; Nodarium does not provision or run it.
- Operators configure the RPC connection and an admin key through environment
  variables, then sign in with the key. There is no username or account signup.
- Private LAN or VPN access is the documented deployment model. Docker Compose
  provides the standard single-container setup with persistent data storage.
- The responsive web interface supports desktop and mobile browsers, with
  English and German language selection.
- The core workflow is to check the compact overview for health, key metrics,
  and recent blocks, then investigate node details, mining, peers, traffic,
  mempool activity, or recent blocks on dedicated pages. Historical ranges support
  comparison over one hour, 24 hours, seven days, 30 days, and one year.
- Collection continues independently of an open browser. History begins when
  collection starts and cannot be backfilled from earlier node activity.

## Capabilities and Constraints

The audience and product scope below were confirmed during initialization.
Implementation details are grounded in the repository's README and source.

- Preserve self-hosting and read-only Bitcoin Core monitoring. Wallet features,
  peer controls, and host-resource monitoring are outside the product scope.
- Support existing Bitcoin Core 28+ nodes with RPC enabled. RPC credentials stay
  on the backend; the dashboard does not need wallet or blockchain file access.
- Show synchronization, height, uptime, Core version, disk usage, pruning,
  difficulty, and node warnings. Show difficulty-period progress, remaining blocks,
  and the next scheduled adjustment height from the node's validated block height.
  Estimate the adjustment date in the viewer's local time zone using the latest
  node observation and a ten-minute target per remaining block. Hide the date
  during synchronization and retain its observation anchor when readings are stale.
  Identify syncing and stale readings; regtest has no difficulty retargeting.
- Show locally sourced network hashrate estimates over up to 144 and 1,008 blocks,
  with persisted hashrate and difficulty charts. Pause network mining history
  during synchronization and preserve gaps for failed estimates.
- Show local conservative fee estimates for 2, 3, and 6-block confirmation targets
  in sat/vB, with persisted history on the Mempool page. Preserve each target's
  observation and stale state independently; missing estimates stay unavailable.
  Show Core's returned target when it differs from the request and record history
  only when they match. Pause fee collection during blockchain synchronization.
- Provide searchable and sortable peer connections, approximate peer locations,
  country counts from local GeoIP data, traffic rates and totals, mempool statistics,
  and the latest ten blocks with
  expandable details where Core has the necessary data. Render recent blocks as
  inspectable tiles and provide an on-demand transaction mosaic sized by virtual
  bytes and colored by fee rate. Tile selection and a keyboard-accessible data
  table open transaction details, inputs, and outputs from the local node;
  unavailable fees, prevouts, and pruned blocks remain explicitly unavailable.
- Use contained virtual scrolling instead of pagination in peer lists, expanded
  history readings, and block transaction tables. Keep sticky headers, native table
  semantics, row totals, and keyboard access to every row. Preserve scroll during
  refresh, reset it for search/sort or a different history range, and retain focus
  when inspecting peers or transactions. Short tables remain fully rendered.
- Compare the latest ten validated blocks on the Blocks page with subsidy and fees,
  fee share of available reward, Core's average and weight-percentile median fee
  rates, and full-block capacity utilization. Available reward means subsidy plus
  fees, not the actual claimed coinbase payout. Use cached local block statistics,
  exact satoshi amounts in expandable tables, and height-ordered plots. Missing
  statistics leave gaps and are retried; syncing and stale readings remain explicit.
  This is a recent-block comparison, not a persisted or backfilled economics history.
- Attribute mainnet coinbase transactions locally using bundled official
  mempool/mining-pools definitions. Show pool block shares for the latest 144 or
  1,008 blocks and the attributed miner in block goggles. Keep unknown matches,
  partial/pruned samples, backfill progress, stale data, and attribution methods
  explicit. Definitions update through an explicit fetch-and-validate command;
  block-share charts do not claim measured pool hash power.
  Display locally bundled official mempool/mining-pool-logos artwork beside pool
  names in distribution tables and block goggles. Respect available theme variants,
  retain readable names and neutral fallbacks, and make no external logo requests.
  Logos update through a separate revision-pinned fetch-and-validate command.
- Resolve peer and node IP locations locally using a city MMDB database. Do not
  send these addresses to a geolocation service. Keep peers with unavailable
  locations visible without invented coordinates. Map lines indicate connections,
  not physical network routes. Pair localized country names with locally bundled
  SVG flags from flag-icons; retain a neutral globe for unknown or unavailable
  icons and make no external flag requests.
- Retain up to 365 days of monitoring history at progressively coarser
  resolutions. Missing readings, counter resets, and failed persistence leave
  explicit gaps rather than fabricated zeroes.
- Preserve the distinction between live observations, Core's cumulative counters,
  and totals calculated from the intervals Nodarium observed.
- Block output amounts include change and exclude coinbase rewards; they do not
  measure net economic transfer. Fees exclude the block subsidy. Preserve exact
  satoshi values and the option to inspect all eight BTC decimal places.
- Preserve English and German interfaces, locale-aware formatting, and remembered
  language selection. User-configured names and original Core diagnostics remain
  unchanged.
- Authentication uses an admin key and server-managed session cookies. Do not
  persist the admin key in browser storage.

## Brand Commitments

The existing product name is **Nodarium**. BTC Monitor is its former name and
remains in some compatibility paths and storage identifiers. Preserve existing
data compatibility when changing names or deployment documentation.

No additional visual direction or voice requirement was established during init.

## Evidence on Hand

- `README.md`: product scope, deployment instructions, metric semantics,
  limitations, configuration, and API documentation.
- `web/src/App.tsx`, `web/src/views/Dashboard.tsx`, and `web/src/components/`:
  existing login, navigation, monitoring views, charts, tables, and peer map.
- `web/src/locales/en.json` and `web/src/locales/de.json`: existing interface copy.
- `web/public/favicon.svg`: existing product icon.
- `web/public/map-attribution.txt` and `web/src/assets/world.json`: map attribution
  and geography assets; preserve required attribution.
- `web/e2e/dashboard.spec.ts` and `web/e2e/global-setup.ts`: browser coverage and
  fixture-backed demonstrations. Fixture readings are test data, not evidence of
  a real deployment or customer outcome.

No testimonials, customer counts, or performance benchmarks were established
during initialization; future work must not invent them.

## Product Principles

1. Make quick health checks and investigation of the operator's own node easy.
2. Preserve operator control through self-hosting, read-only access, and local
   geolocation.
3. Represent data honestly: show freshness, coverage, missing observations, and
   the actual meaning of each metric.
4. Keep deployment lightweight and support one node per instance.
5. Maintain usable English and German experiences across desktop and mobile.

## Open Decisions

No product-specific accessibility standard or additional assistive-technology
requirement was established during initialization. Existing accessibility
behavior remains implementation evidence, not a claim of certified compliance.
