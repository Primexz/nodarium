# Nodarium

A self-hosted, read-only dashboard for your Bitcoin Core node, built with Go and React. Available in English and German, with light and dark themes and a responsive layout.

## Features

- **Overview and node details:** health, synchronization, storage, uptime, and recent blocks.
- **Peers and traffic:** searchable connections, a world map, country distribution, transfer rates, and history.
- **Mining:** difficulty-period progress, estimated network hashrate, difficulty history, and pool shares over the latest 144 or 1,008 blocks.
- **Mempool and blocks:** mempool statistics, block details, and a transaction mosaic. Click a transaction to inspect its inputs, outputs, and fees.

Nodarium monitors one node per instance. SQLite is included; PostgreSQL is optional. History begins when collection starts and is retained for up to a year. No wallet features, peer controls, or host-resource monitoring.

## Quick start

Requires Docker Compose and Bitcoin Core 28+ with RPC enabled.

```sh
git clone https://github.com/Primexz/nodarium.git
cd nodarium
cp .env.example .env
openssl rand -hex 32
```

Use the generated key for `ADMIN_KEY`, then set your node connection in `.env`:

```dotenv
ADMIN_KEY=YOUR_GENERATED_ADMIN_KEY
BITCOIN_RPC_URL=http://host.docker.internal:8332
BITCOIN_RPC_USER=monitor
BITCOIN_RPC_PASSWORD=YOUR_RPC_PASSWORD
```

Start the dashboard and open [localhost:8080](http://localhost:8080):

```sh
docker compose up -d --build
```

Log in with your admin key. Compose binds to localhost by default and stores data in the `monitor-data` volume. Set `BIND_ADDRESS` to your private LAN or VPN address for access from other devices. `docker compose down` preserves history; `docker compose down -v` deletes it.

### Bitcoin Core connection

Enable `server=1` and configure RPC credentials in `bitcoin.conf`, using `rpcauth` or `rpcuser`/`rpcpassword`. Core must listen on an interface reachable from Nodarium, and `rpcallowip` must permit the dashboard's source address or subnet. Restart Core after configuration changes.

Use `host.docker.internal` for the Docker host, a service name for another container on the same Docker network, or a private address for a remote node. Container `localhost` refers to Nodarium itself. Keep RPC access restricted to a private network or VPN.

## Configuration

See [.env.example](.env.example) for settings. Apply changes with `docker compose up -d`.

| Setting | Purpose |
| --- | --- |
| `NODE_IP`, `NODE_LOCATION_NAME` | Public IP and label for your node on the map. Without an IP, Core's advertised addresses are tried. |
| `DB_DRIVER`, `DB_DSN` | Defaults to SQLite. For PostgreSQL, set `DB_DRIVER=postgres` and a connection string. Changing databases does not migrate history. |
| `GEOIP_DB_PATH`, `GEOIP_AUTO_DOWNLOAD` | Custom city MMDB file or automatic DB-IP City Lite downloads. |
| `POLL_INTERVAL` | Collection interval; defaults to `10s`. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error`; defaults to `info`. |
| `COOKIE_SECURE` | Set to `true` behind an HTTPS reverse proxy. Serve at the domain root and preserve the Host header. |
| `BIND_ADDRESS`, `PORT` | Compose host address and port; defaults to `127.0.0.1:8080`. |

IP geolocation runs locally. Peer and node addresses are never sent to a geolocation service. DB-IP City Lite is downloaded and cached by default; Tor, I2P, private, and unknown addresses remain unlocated. Locations and connection lines are approximate.

Pool names are inferred locally from coinbase tags or payout addresses using the official [mempool mining-pool definitions](https://github.com/mempool/mining-pools). Unknown matches stay Unknown. Pool shares count observed mainnet blocks, not measured hash power. Refresh the bundled definitions with `make update-mining-pools`, then rebuild and restart.

Block and transaction details come from your node without requiring `txindex`. Pruned blocks or unavailable undo data can limit details and fees. Missing readings and partial samples are labeled instead of filled with invented values.

To follow logs:

```sh
docker compose logs -f dashboard
```

### Container images

CI publishes verified `master` builds and version tags to `ghcr.io/primexz/nodarium` for amd64 and arm64. To use a published image, set `NODARIUM_IMAGE=ghcr.io/primexz/nodarium:master` in `.env`, then run:

```sh
docker compose pull dashboard
docker compose up -d --no-build
```

## Development

Requires Go 1.26.2+, a C compiler for SQLite, Node 22.13+ (24 recommended), and pnpm 11.19.0.

```sh
corepack enable
make build
# Export your trusted .env settings into the shell before running:
DATA_DIR=./data go run ./cmd/nodarium
```

For frontend development, run `pnpm --dir web dev` alongside the backend. Vite proxies `/api` to port 8080. Go embeds the frontend, so build it before compiling the backend.

```sh
make format-check
make test
pnpm --dir web exec playwright install chromium
pnpm --dir web test:e2e
```

Browser tests use a local RPC fixture. `scripts/integration.sh` runs disposable PostgreSQL and Bitcoin Core regtest containers. Storage tests must use an isolated test database.

## License

[MIT](LICENSE), copyright 2026 Primexz. Third-party notices remain with their assets: [mining-pool definitions](internal/miningpool/data/LICENSE) and [map attribution](web/public/map-attribution.txt).
