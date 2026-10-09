#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
rpc_pid=''
app_pid=''
cleanup() {
  if [ -n "$app_pid" ]; then kill "$app_pid" 2>/dev/null || true; fi
  if [ -n "$rpc_pid" ]; then kill "$rpc_pid" 2>/dev/null || true; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT INT TERM
pnpm --dir web build
go build -o "$test_dir/nodarium" ./cmd/nodarium
python3 scripts/mock_rpc.py &
rpc_pid=$!
GEOIP_AUTO_DOWNLOAD=false NODE_IP=1.1.1.1 ADMIN_KEY=e2e-admin-key BITCOIN_RPC_URL=http://127.0.0.1:19443 BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test DATA_DIR="$test_dir" LISTEN_ADDR=127.0.0.1:18080 POLL_INTERVAL=5s "$test_dir/nodarium" &
app_pid=$!
wait "$app_pid"
