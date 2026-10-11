# Activity

The Activity page has full-mempool block projections, an animated live arrivals table and a virtual-scrolling Timeline. Transactions remain in memory; only node connection changes, observed new blocks, and verified reorganizations are stored in `activity_events`. Events are isolated by the collector’s node identity and kept for 30 days, with a 100,000-event cap per node. Observation time is separate from a block’s timestamp. Startup, synchronization and historical indexing do not create timeline events.

## Optional ZMQ

Enable the sequence publisher in `bitcoin.conf`, then restart Core:

```ini
zmqpubsequence=tcp://0.0.0.0:28332
```

Set the address reachable from Nodarium in `.env`:

```dotenv
BITCOIN_ZMQ_SEQUENCE_URL=tcp://host.docker.internal:28332
```

Bind Core to a private interface and restrict access to Nodarium. ZMQ has no authentication or encryption; do not expose its port publicly. In Compose, `localhost` refers to Nodarium, not Core. The pure-Go subscriber needs no additional system library.

Without ZMQ, Live polls Core every five seconds. With ZMQ, additions and non-block removals arrive immediately, with an RPC membership check every 30 seconds. Block notifications also refresh the local block index. Gaps, disconnects and node restarts reset the live baseline and use RPC while notification delivery recovers. A quiet publisher alone does not count as a failure. Blocks and reorgs are validated with Core headers; transaction removal alone never implies confirmation.

## Projected next blocks

Every ten seconds, while Live is active, one asynchronous `getrawmempool true` request reads virtual sizes, weights, modified fees, and unconfirmed dependencies. This uses the full snapshot rather than the arrivals sample. Ancestor packages are prioritized by remaining modified fees per virtual byte, including child-pays-for-parent; selecting a shared ancestor recalculates its descendants’ package rates. Transactions are counted once. The next four blocks reserve 4,000 weight units for header/coinbase and enforce both 3,996,000 WU and 999,000 vB limits. Entries that do not fit remain in the reported backlog.

The UI shows full-snapshot counts, virtual size, capacity equivalents, individual modified fee ranges, and each projected block’s transaction count, virtual size, effective package fee range and transaction-count median. Mosaics group transactions into logarithmic fee bands, splitting each band into at most 16 tiles; tile area is combined virtual size, not BTC amount. Empty space represents spare virtual capacity. They stay static between projections; only the arrivals table animates.

These are estimates, not exact mining templates or confirmation-time predictions. Miner policies, sigops limits, selection algorithms and new arrivals can change actual blocks. Projection work has a ten-second deadline, a 200,000-entry limit, an eight-million dependency-visit budget and a 1,024-level recursion limit. Verbose RPC responses are bounded at 128 MiB. Failures retain the last successful projection with an explicit warning; resets clear it and reject results from an older baseline generation. Projection work never blocks the live event loop and does not fetch every raw transaction or persist the mempool.

Core metadata: [getrawmempool](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getrawmempool/). The package-selection approach is inspired by [mempool’s block projections](https://github.com/mempool/mempool/blob/master/backend/src/api/mempool-blocks.ts); this implementation is a bounded local approximation.

## Coverage and limits

Live retains at most 200,000 mempool IDs and displays at most 500 transactions, seeding up to 50 existing transactions without counting them as arrivals. Virtual size, base fee and output totals are fetched for up to 200 transactions per five seconds, with at most four concurrent metadata workers and two sequential RPC requests per transaction. Amounts are summed exactly from decoded outputs, include change, exclude fees, and are exported as decimal satoshi strings in `output_sats`. Raw transactions are not retained. New arrivals take priority over older incomplete metadata; unsuccessful lookups are retried after the five-second budget window resets. The readable table holds each row until amount, virtual size and fee rate are available, and shows how many sampled transactions are waiting. New rows slide in over 380ms; existing rows continue from their painted position during rapid updates, while scrolling retains the transaction being read. The table is always visible. The latest known block can be inspected separately through its full transaction mosaic. Polling can miss short-lived transactions.

Mempool work starts with a Live subscriber and stops 15 seconds after the last one leaves. Pausing, hiding the tab or navigating away closes its stream. Reduced motion shows the same information without animation. Timeline subscriptions keep quiet events available without starting mempool tracking. History is an observation log, not a complete chain archive; outages are not backfilled.

Events retry after database failures in a bounded 1,000-event queue. A storage failure is shown in the UI. If that queue overflows, its warning remains for the process lifetime because history may be incomplete.

## API and SSE

All endpoints use the existing admin session cookie:

- `GET /api/1.0/activity/live` — cached live state, including source, coverage status and baseline generation.
- `GET /api/1.0/activity/events?kind=block&cursor=…` — up to 50 events, newest first. `kind` is optional (`connection`, `block`, `reorg`); cursors are scoped to the node.
- `GET /api/1.0/activity/stream?view=live` — snapshots and updates. Use `view=timeline` for quiet events without transaction updates.

SSE sends `snapshot`, `live`, `block`, `event`, `status`, `reset` and `expired` frames. Reconnection uses `Last-Event-ID`; replay retains up to 1,000 frames or 8 MiB, followed by a current snapshot. An unavailable cursor produces a reset. Slow consumers disconnect instead of blocking collection. At most 16 streams are admitted. A heartbeat every ten seconds also checks session revocation. Writes have a five-second deadline, cleared between frames. Reverse proxies must disable buffering and allow long-lived responses.

The frontend keeps at most ten history pages (500 events). New events are offered through an explicit refresh action so reading does not jump. Stored transaction archives, watchlists, alerts and RSS are outside this feature.
