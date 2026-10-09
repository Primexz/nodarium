// Package explorer reads confirmed block transactions on demand. It is separate
// from polling so decoding a large block cannot hold up node-health collection.
package explorer

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"sync"

	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
)

var (
	ErrInvalid     = errors.New("Invalid block hash or transaction ID")
	ErrInactive    = errors.New("Block is no longer on the active chain")
	ErrUnavailable = errors.New("Block transactions unavailable; the node may be offline or the block data may be pruned")
	ErrNotFound    = errors.New("Transaction is not in this block")
)

func ValidID(value string) bool {
	if len(value) != 64 {
		return false
	}

	_, err := hex.DecodeString(value)

	return err == nil
}

type Summary struct {
	TXID       string   `json:"txid"`
	Size       int64    `json:"size"`
	VSize      int64    `json:"vsize"`
	Weight     int64    `json:"weight"`
	FeeSats    *string  `json:"fee_sats"`
	FeeRate    *float64 `json:"fee_rate"`
	OutputSats *string  `json:"output_sats"`
	Inputs     int      `json:"input_count"`
	Outputs    int      `json:"output_count"`
	Coinbase   bool     `json:"coinbase"`
}

type Block struct {
	Hash          string                 `json:"hash"`
	Height        int64                  `json:"height"`
	Confirmations int64                  `json:"confirmations"`
	Transactions  []Summary              `json:"transactions"`
	MiningPool    miningpool.Attribution `json:"mining_pool"`
}

type Input struct {
	TXID       string  `json:"txid"`
	Vout       uint32  `json:"vout"`
	Coinbase   bool    `json:"coinbase"`
	Sequence   uint32  `json:"sequence"`
	ValueSats  *string `json:"value_sats"`
	Address    string  `json:"address"`
	ScriptType string  `json:"script_type"`
}

type Output struct {
	Index      uint32  `json:"index"`
	ValueSats  *string `json:"value_sats"`
	Address    string  `json:"address"`
	ScriptType string  `json:"script_type"`
}

type Transaction struct {
	Summary
	Hash          string   `json:"wtxid"`
	BlockHash     string   `json:"block_hash"`
	Confirmations int64    `json:"confirmations"`
	Version       int64    `json:"version"`
	LockTime      uint32   `json:"locktime"`
	Inputs        []Input  `json:"inputs"`
	Outputs       []Output `json:"outputs"`
}

type script struct {
	Address string `json:"address"`
	Type    string `json:"type"`
}

type rawOutput struct {
	N      uint32      `json:"n"`
	Value  json.Number `json:"value"`
	Script script      `json:"scriptPubKey"`
}

type rawInput struct {
	TXID     string     `json:"txid"`
	Vout     uint32     `json:"vout"`
	Coinbase string     `json:"coinbase"`
	Sequence uint32     `json:"sequence"`
	Prevout  *rawOutput `json:"prevout"`
}

type rawTransaction struct {
	TXID      string      `json:"txid"`
	Hash      string      `json:"hash"`
	BlockHash string      `json:"blockhash"`
	Size      int64       `json:"size"`
	VSize     int64       `json:"vsize"`
	Weight    int64       `json:"weight"`
	Fee       json.Number `json:"fee"`
	Version   int64       `json:"version"`
	LockTime  uint32      `json:"locktime"`
	Inputs    []rawInput  `json:"vin"`
	Outputs   []rawOutput `json:"vout"`
}

// BTC numbers remain decimal until converted to integer satoshis; never round
// a float or turn an absent fee into zero.
func satoshis(value json.Number) *string {
	if len(value) == 0 || len(value) > 128 {
		return nil
	}

	amount, ok := new(big.Rat).SetString(string(value))

	if !ok || amount.Sign() < 0 {
		return nil
	}

	amount.Mul(amount, big.NewRat(100_000_000, 1))

	if !amount.IsInt() || !amount.Num().IsInt64() || amount.Num().Int64() > 2_100_000_000_000_000 {
		return nil
	}

	result := amount.Num().String()

	return &result
}

func summarize(tx rawTransaction) (Summary, error) {
	if !ValidID(tx.TXID) ||
		tx.Size <= 0 ||
		tx.Size > 4_000_000 ||
		tx.Weight <= 0 ||
		tx.Weight > 4_000_000 ||
		tx.VSize != (tx.Weight+3)/4 ||
		len(tx.Inputs) == 0 ||
		len(tx.Outputs) == 0 {
		return Summary{}, ErrUnavailable
	}

	result := Summary{
		TXID:     strings.ToLower(tx.TXID),
		Size:     tx.Size,
		VSize:    tx.VSize,
		Weight:   tx.Weight,
		Inputs:   len(tx.Inputs),
		Outputs:  len(tx.Outputs),
		Coinbase: tx.Inputs[0].Coinbase != "",
	}

	if !result.Coinbase {
		result.FeeSats = satoshis(tx.Fee)

		if result.FeeSats != nil {
			fee, _ := new(big.Int).SetString(*result.FeeSats, 10)
			rate := float64(fee.Int64()) / float64(tx.VSize)
			result.FeeRate = &rate
		}
	}

	total := new(big.Int)
	complete := true

	for _, output := range tx.Outputs {
		value := satoshis(output.Value)

		if value == nil {
			complete = false
			continue
		}

		integer, _ := new(big.Int).SetString(*value, 10)
		total.Add(total, integer)
	}

	if complete {
		amount := total.String()
		result.OutputSats = &amount
	}

	return result, nil
}

// Cache only compact immutable summaries for eight blocks, never raw scripts,
// hex or witnesses. Header checks keep confirmations and reorg state current.
type Explorer struct {
	client rpc.Caller
	pools  *miningpool.Registry
	mu     sync.Mutex
	cache  map[string]Block
	order  []string
	slots  chan struct{}
}

func New(client rpc.Caller, pools *miningpool.Registry) *Explorer {
	return &Explorer{
		client: client,
		pools:  pools,
		cache:  make(map[string]Block),
		slots:  make(chan struct{}, 2),
	}
}

func (e *Explorer) acquire(ctx context.Context) error {
	select {
	case e.slots <- struct{}{}:
		return nil

	case <-ctx.Done():
		return ErrUnavailable
	}
}

func (e *Explorer) header(ctx context.Context, hash string) (rpc.Block, error) {
	var header rpc.Block

	if err := e.client.Call(ctx, "getblockheader", []any{hash, true}, &header); err != nil || header.Hash != hash {
		return header, ErrUnavailable
	}

	if header.Confirmations < 1 {
		return header, ErrInactive
	}

	return header, nil
}

func (e *Explorer) Block(ctx context.Context, hash string) (Block, error) {
	if !ValidID(hash) {
		return Block{}, ErrInvalid
	}

	hash = strings.ToLower(hash)

	if err := e.acquire(ctx); err != nil {
		return Block{}, err
	}

	defer func() {
		<-e.slots
	}()

	header, err := e.header(ctx, hash)

	if err != nil {
		return Block{}, err
	}

	e.mu.Lock()
	cached, found := e.cache[hash]
	e.mu.Unlock()

	if found {
		cached.Confirmations = header.Confirmations

		return cached, nil
	}

	var raw struct {
		Hash          string           `json:"hash"`
		Height        int64            `json:"height"`
		Confirmations int64            `json:"confirmations"`
		Count         int              `json:"nTx"`
		Transactions  []rawTransaction `json:"tx"`
	}

	if err := e.client.Call(ctx, "getblock", []any{hash, 2}, &raw); err != nil ||
		raw.Hash != hash ||
		raw.Height != header.Height ||
		raw.Count != len(raw.Transactions) ||
		raw.Count == 0 ||
		raw.Count > 40_000 {
		return Block{}, ErrUnavailable
	}

	if raw.Confirmations < 1 {
		return Block{}, ErrInactive
	}

	result := Block{
		Hash:          hash,
		Height:        raw.Height,
		Confirmations: raw.Confirmations,
		Transactions:  make([]Summary, 0, raw.Count),
	}

	result.MiningPool = miningpool.Attribution{Status: "unavailable"}
	var chain rpc.Blockchain

	if err := e.client.Call(ctx, "getblockchaininfo", nil, &chain); err == nil {
		coinbase := raw.Transactions[0]
		addresses := make([]string, 0, len(coinbase.Outputs))

		for _, output := range coinbase.Outputs {
			addresses = append(addresses, output.Script.Address)
		}

		if len(coinbase.Inputs) == 1 {
			result.MiningPool = e.pools.Identify(chain.Chain, coinbase.Inputs[0].Coinbase, addresses)
		}
	}

	seen := make(map[string]bool, raw.Count)

	for _, tx := range raw.Transactions {
		summary, err := summarize(tx)

		if err != nil || seen[summary.TXID] {
			return Block{}, ErrUnavailable
		}

		seen[summary.TXID] = true
		result.Transactions = append(result.Transactions, summary)
	}

	e.mu.Lock()

	if _, exists := e.cache[hash]; !exists {
		if len(e.order) == 8 {
			delete(e.cache, e.order[0])
			e.order = e.order[1:]
		}

		e.cache[hash] = result
		e.order = append(e.order, hash)
	}

	e.mu.Unlock()

	return result, nil
}

func (e *Explorer) Transaction(ctx context.Context, hash, txid string) (Transaction, error) {
	if !ValidID(hash) || !ValidID(txid) {
		return Transaction{}, ErrInvalid
	}

	hash, txid = strings.ToLower(hash), strings.ToLower(txid)

	if err := e.acquire(ctx); err != nil {
		return Transaction{}, err
	}

	defer func() {
		<-e.slots
	}()

	header, err := e.header(ctx, hash)

	if err != nil {
		return Transaction{}, err
	}

	var raw rawTransaction

	// Supplying the block hash makes lookup independent of txindex.
	if err := e.client.Call(ctx, "getrawtransaction", []any{txid, 2, hash}, &raw); err != nil {
		return Transaction{}, ErrUnavailable
	}

	if raw.TXID != txid || raw.BlockHash != hash {
		return Transaction{}, ErrNotFound
	}

	summary, err := summarize(raw)

	if err != nil {
		return Transaction{}, err
	}

	result := Transaction{
		Summary:       summary,
		Hash:          raw.Hash,
		BlockHash:     hash,
		Confirmations: header.Confirmations,
		Version:       raw.Version,
		LockTime:      raw.LockTime,
		Inputs:        make([]Input, 0, len(raw.Inputs)),
		Outputs:       make([]Output, 0, len(raw.Outputs)),
	}

	for _, input := range raw.Inputs {
		view := Input{
			TXID:     input.TXID,
			Vout:     input.Vout,
			Coinbase: input.Coinbase != "",
			Sequence: input.Sequence,
		}

		if input.Prevout != nil {
			view.ValueSats = satoshis(input.Prevout.Value)
			view.Address = input.Prevout.Script.Address
			view.ScriptType = input.Prevout.Script.Type
		}

		result.Inputs = append(result.Inputs, view)
	}

	for _, output := range raw.Outputs {
		result.Outputs = append(
			result.Outputs,
			Output{
				Index:      output.N,
				ValueSats:  satoshis(output.Value),
				Address:    output.Script.Address,
				ScriptType: output.Script.Type,
			},
		)
	}

	return result, nil
}
