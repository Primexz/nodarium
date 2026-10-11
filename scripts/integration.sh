#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
suffix=$$
pg_name="nodarium-pg-$suffix"
core_name="nodarium-core-$suffix"
cleanup(){ docker rm -fv "$pg_name" "$core_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run -d --name "$pg_name" -e POSTGRES_USER=monitor -e POSTGRES_PASSWORD=integration-only -e POSTGRES_DB=monitor -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
docker run -d --name "$core_name" -p 127.0.0.1::18443 -p 127.0.0.1::28332 bitcoin/bitcoin:28.1 -regtest -fallbackfee=0.00001 -zmqpubsequence=tcp://0.0.0.0:28332 -server -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0 -rpcuser=monitor -rpcpassword=integration-only >/dev/null
pg_port=$(docker port "$pg_name" 5432/tcp | sed 's/.*://')
core_port=$(docker port "$core_name" 18443/tcp | sed 's/.*://')
zmq_port=$(docker port "$core_name" 28332/tcp | sed 's/.*://')
tries=0
until docker exec "$pg_name" pg_isready -U monitor >/dev/null 2>&1 && docker exec "$core_name" bitcoin-cli -regtest -rpcuser=monitor -rpcpassword=integration-only getblockchaininfo >/dev/null 2>&1; do
 tries=$((tries+1)); if [ "$tries" -gt 30 ]; then echo 'Integration services did not become ready' >&2; exit 1; fi
 sleep 1
done
export TEST_POSTGRES_DSN="postgres://monitor:integration-only@127.0.0.1:$pg_port/monitor?sslmode=disable" TEST_BITCOIN_RPC_URL="http://127.0.0.1:$core_port" TEST_BITCOIN_ZMQ_URL="tcp://127.0.0.1:$zmq_port"
go test -race ./internal/... -skip TestCoreActivityRegtest -count=1
go test -race ./internal/activity -run TestCoreActivityRegtest -count=1
