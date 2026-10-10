# Block history

Nodarium stores compact block summaries in SQLite or PostgreSQL. It does not
store complete transactions, scripts, witnesses, or per-transaction mosaic
records. The overview remains limited to ten recent blocks; the Blocks page
provides historical browsing and economics ranges.

## Indexing

The index starts automatically after Core finishes initial synchronization.
One worker follows the active chain backwards from the tip, so the newest 1,008
blocks become available before older history. New tips interrupt historical
work at block boundaries. Batches contain at most 16 blocks and run continuously
while backfill remains. Reads are sequential, with no artificial delay by default.
Set `BLOCK_INDEX_DELAY` between `0s` and `5s` to pause between blocks if needed;
this is independent of the monitoring `POLL_INTERVAL`. RPC and database failures
leave resumable progress and are retried
with backoff from 30 seconds to five minutes.

At the default `info` log level, the `block-index` logger reports indexing start,
progress every 30 seconds, and completion. Progress includes committed block
counts, percentage, remaining blocks, processing rate, the next height, and
statistics/pruned coverage. Failures also produce a warning with the retry delay.
No open browser or debug logging is required to follow the backfill.

Network genesis hashes partition records. Blocks are keyed by hash, with a
separate active-chain height mapping. Canonical membership, batch progress, and
the observed tip are committed together. A reorganization replaces the
canonical suffix; orphan metadata is retained but excluded from queries and
charts. Successful immutable statistics survive later pruning. Block records
have no age-based retention limit; monitoring observations retain their existing
one-year policy.

Stored data includes header fields, full-block size/weight, transaction counts,
subsidy and fees, total transaction outputs, fee rates/percentiles, input/output
counts, SegWit statistics, and UTXO changes. Extra Core statistics remain compact
JSON for future features. Coinbase tag/payout evidence and the definitions
revision permit mining-pool reclassification without reading block bodies again.
Amounts exposed in block summaries use exact decimal satoshi strings.

Pruned blocks contribute headers but unavailable statistics remain null. Core
must retain a block to provide its transaction mosaic and details. `txindex` is
not required. Genesis statistics can be unavailable because Core does not have
its undo record. Transient enrichment failures are retried separately; unavailable
pruned bodies and unsupported genesis statistics are not endlessly retried.

An offline restart restores the last stored network for read-only browsing.
Successful Core observations select the current network before indexing resumes.

## API

All routes require the existing admin session. Existing `/api/1.0/blocks` and
transaction endpoints retain their contracts.

| Route                                     | Response                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/1.0/blocks/index`               | Index state, current tip/height, total target, header/statistics/pool/pruned counts, oldest indexed height, last update, stale state, sanitized failure message. |
| `GET /api/1.0/blocks/history`             | Descending block summaries, older/newer opaque cursors, stable anchor height, indexed count, backfill-pending and stale flags.                                   |
| `GET /api/1.0/blocks/{hash}`              | Stored block summary with current confirmations and pool attribution.                                                                                            |
| `GET /api/1.0/blocks/economics?range=all` | Bounded time buckets with averages, per-metric sample counts, indexing coverage, partial and stale flags.                                                        |

History accepts `limit` (default 50, maximum 100), `cursor`, or `start_height`.
A cursor and starting height are mutually exclusive. Cursors anchor browsing to
an indexed tip, so new blocks do not move an existing browsing window. A
reorganization that disconnects the anchor returns 409; restart at the visible
height. An empty page with `backfill_pending: true` means the requested ancestry
has not been indexed yet. The client waits for progress before requesting it
again.

Block lookup returns 400 for malformed hashes, 404 for unindexed hashes, 409 for
indexed orphan hashes, and 503 for unavailable storage. Historical transaction
endpoints keep their existing Core availability and active-chain checks.

Economics accepts `recent` (default), `24h`, `7d`, `30d`, `1y`, and `all`.
`recent` returns `recent_blocks`; historical ranges return at most 1,000 UTC time
buckets. `at` is Unix milliseconds; `interval_seconds` describes bucket width.
Historical monetary chart values are BTC averages intended for plotting, not
exact satoshi totals. Empty buckets retain null values.

Reward averages use only blocks with both subsidy and fees. Fee share is summed
fees divided by summed available reward from those same blocks. Fee-rate curves
are means of Core's per-block averages and per-block weighted median percentiles;
they are not medians of all transactions. Fullness uses the mean full-block
weight divided by four million weight units. Each metric carries its own sample
count; missing statistics never count as zero.

## Browser memory

The Blocks page uses one visual block strip, with no duplicate history table.
The strip fetches 50 blocks per page and retains at most ten pages. It
refetches evicted pages in either direction, preserves the visible block anchor,
and virtualizes the mounted tiles. The selected block's metadata and goggles
remain outside the scrolling strip. New blocks appear through a return-to-latest
control rather than shifting historical tiles while the operator is reading.

A block-height search jumps directly to stored history. Touch, horizontal scrolling,
and arrow keys navigate the strip; selecting a tile opens its details and live
transaction mosaic above the economics charts.

## Mining-pool history

`GET /api/1.0/mining/pools/history?range=30d` returns pool totals, metric sample
counts, and at most 366 UTC buckets. Ranges are `24h`, `7d`, `30d` (default),
`1y`, and `all`. The selected time boundaries are exact; the first and last
buckets can be partial. All pool statistics come from canonical indexed blocks,
with no additional Core requests or external services.

Shares use every indexed block in the selected period, including Unknown and
Unavailable attribution. An empty time bucket is a gap rather than a zero share.
The chart shows the four leading pools, other identified pools, Unknown, and
Unavailable; the expandable virtual chart data table retains the exact bucket
counts. Pool links live in the chart legends rather than duplicate ranking tables. This denominator differs from the recent 144/1,008-block sample, which
uses blocks with readable attribution. Neither measures pool hash power.

`GET /api/1.0/mining/pools/{id}?range=30d` returns the pool identity, the same
period history, and its latest 20 indexed blocks across all stored history.
The UI provides shareable `/mining/pools/{id}?range=30d` pages, also accessible
from pool names in distributions and goggles. Selecting a pool block opens the
existing details and transaction mosaic; Core availability still applies.

Empty-block frequency counts coinbase-only blocks among blocks with a known
transaction count. Utilization averages known block weight against the four
million weight-unit limit. Average fee revenue excludes subsidy and uses only
blocks with known fees. Each metric exposes its own sample count; missing data
never becomes zero. Definition IDs keep historical blocks together across name
changes. Invalid pool IDs/ranges return 400, unknown definition IDs return 404,
and unavailable storage returns 503. Routes require the existing admin session.
