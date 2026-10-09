package explorer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
)

const blockID = "0000000000000000000000000000000000000000000000000000000000000001"

const txID = "0000000000000000000000000000000000000000000000000000000000000002"

const transactionJSON = `{"txid":"` + txID + `","hash":"` + txID + `","blockhash":"` + blockID + `","size":200,"vsize":125,"weight":500,"fee":0.00000101,"version":2,"locktime":0,"vin":[{"txid":"` + blockID + `","vout":1,"sequence":4294967295,"prevout":{"value":1.00000101,"scriptPubKey":{"address":"previous-address","type":"witness_v0_keyhash"}}}],"vout":[{"n":0,"value":1.00000000,"scriptPubKey":{"address":"output-address","type":"witness_v1_taproot"}}]}`

type callerFunc func(context.Context, string, any, any) error

func (f callerFunc) Call(ctx context.Context, method string, params, result any) error {
	return f(ctx, method, params, result)
}

func newExplorer(client rpc.Caller) *Explorer {
	registry, err := miningpool.Load()

	if err != nil {
		panic(err)
	}

	return New(client, registry)
}

func fixture(t *testing.T, method string, result any, confirmations int64) error {
	t.Helper()
	var value string

	switch method {
	case "getblockchaininfo":
		value = `{"chain":"main"}`

	case "getblockheader":
		value = fmt.Sprintf(`{"hash":"%s","height":42,"confirmations":%d}`, blockID, confirmations)

	case "getblock":
		value = fmt.Sprintf(
			`{"hash":"%s","height":42,"confirmations":%d,"nTx":1,"tx":[%s]}`,
			blockID,
			confirmations,
			transactionJSON,
		)

	case "getrawtransaction":
		value = transactionJSON

	default:
		t.Fatalf("unexpected RPC %s", method)
	}

	return json.Unmarshal([]byte(value), result)
}

func TestSatoshisExactAndMissing(t *testing.T) {
	for _, test := range []struct {
		number, want string
	}{
		{"0", "0"}, {"0.00000001", "1"}, {"1e-8", "1"},
		{"1.23456789", "123456789"}, {"21000000.00000000", "2100000000000000"},
		{"", ""}, {"-1", ""}, {"0.000000001", ""}, {"21000001", ""}, {"invalid", ""},
	} {
		t.Run(test.number, func(t *testing.T) {
			value := satoshis(json.Number(test.number))

			if test.want == "" {
				if value != nil {
					t.Fatal("missing or invalid amount was fabricated", *value)
				}
			} else if value == nil || *value != test.want {
				t.Fatalf("got %v, want %s", value, test.want)
			}
		})
	}
}

func TestCompactCacheAndReorgChecks(t *testing.T) {
	calls := map[string]int{}
	confirmations := int64(2)
	e := newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		calls[method]++

		return fixture(t, method, result, confirmations)
	}))

	for i := range 2 {
		block, err := e.Block(context.Background(), blockID)

		if err != nil {
			t.Fatal(err)
		}

		tx := block.Transactions[0]

		if *tx.FeeSats != "101" ||
			*tx.OutputSats != "100000000" ||
			*tx.FeeRate != 101.0/125 ||
			block.Confirmations != int64(2+i) {
			t.Fatalf("incorrect amounts or freshness: %+v", block)
		}

		confirmations++
	}

	if calls["getblock"] != 1 || calls["getblockheader"] != 2 {
		t.Fatal(calls)
	}

	confirmations = -1

	if _, err := e.Block(context.Background(), blockID); !errors.Is(err, ErrInactive) {
		t.Fatal("orphaned cache returned", err)
	}
}

func TestTransactionLookupUsesBlockHashAndExactPrevouts(t *testing.T) {
	e := newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		if method == "getrawtransaction" {
			args := params.([]any)

			if args[0] != txID || args[1] != 2 || args[2] != blockID {
				t.Fatal("lookup requires block hash and verbose prevouts", args)
			}
		}

		return fixture(t, method, result, 3)
	}))

	tx, err := e.Transaction(context.Background(), blockID, txID)

	if err != nil {
		t.Fatal(err)
	}

	if *tx.Inputs[0].ValueSats != "100000101" ||
		*tx.Outputs[0].ValueSats != "100000000" ||
		tx.Inputs[0].Address != "previous-address" ||
		tx.Outputs[0].ScriptType != "witness_v1_taproot" {
		t.Fatalf("incorrect decoded transaction: %+v", tx)
	}

	encoded, err := json.Marshal(tx)

	if err != nil {
		t.Fatal(err)
	}

	var body map[string]any

	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}

	if body["input_count"] != float64(1) || body["output_count"] != float64(1) {
		t.Fatal("summary counts disappeared from transaction JSON", body)
	}
}

func TestMissingFeeCoinbaseAndZeroStayDistinct(t *testing.T) {
	var tx rawTransaction

	if err := json.Unmarshal([]byte(transactionJSON), &tx); err != nil {
		t.Fatal(err)
	}

	tx.Fee = ""
	summary, _ := summarize(tx)

	if summary.FeeSats != nil || summary.FeeRate != nil {
		t.Fatal("missing fee became zero")
	}

	tx.Fee = "0"
	summary, _ = summarize(tx)

	if summary.FeeSats == nil || *summary.FeeSats != "0" || *summary.FeeRate != 0 {
		t.Fatal("zero fee discarded")
	}

	tx.Inputs[0].Coinbase = "03abcd"
	summary, _ = summarize(tx)

	if !summary.Coinbase || summary.FeeSats != nil {
		t.Fatal("coinbase given a fee")
	}
}

func TestInvalidUnavailableAndMismatchedResponses(t *testing.T) {
	var calls int

	e := newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		calls++

		return errors.New("private RPC error")
	}))

	if _, err := e.Block(context.Background(), "bad"); !errors.Is(err, ErrInvalid) || calls != 0 {
		t.Fatal(err, calls)
	}

	if _, err := e.Transaction(context.Background(), blockID, "bad"); !errors.Is(err, ErrInvalid) || calls != 0 {
		t.Fatal(err, calls)
	}

	if _, err := e.Block(context.Background(), blockID); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}

	e = newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		if err := fixture(t, method, result, 2); err != nil {
			return err
		}

		if method == "getrawtransaction" {
			result.(*rawTransaction).BlockHash = txID
		}

		return nil
	}))

	if _, err := e.Transaction(context.Background(), blockID, txID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}

	var tx rawTransaction

	_ = json.Unmarshal([]byte(transactionJSON), &tx)
	tx.VSize = 1

	if _, err := summarize(tx); err == nil {
		t.Fatal("inconsistent virtual size accepted")
	}
}

func TestParallelReadersAndCancelledWaiter(t *testing.T) {
	e := newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		return fixture(t, method, result, 2)
	}))

	var wg sync.WaitGroup

	for range 20 {
		wg.Go(func() {
			if _, err := e.Block(context.Background(), blockID); err != nil {
				t.Error(err)
			}
		})
	}

	wg.Wait()

	if len(e.cache) != 1 || len(e.order) != 1 {
		t.Fatal("parallel requests duplicated cache entries")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	e.slots <- struct{}{}
	e.slots <- struct{}{}

	if _, err := e.Block(ctx, blockID); !errors.Is(err, ErrUnavailable) {
		t.Fatal("cancelled waiter blocked", err)
	}
}

func TestCacheEvictsOldBlocks(t *testing.T) {
	e := newExplorer(callerFunc(func(ctx context.Context, method string, params, result any) error {
		if method == "getblockchaininfo" {
			return json.Unmarshal([]byte(`{"chain":"main"}`), result)
		}

		hash := params.([]any)[0].(string)
		value := fmt.Sprintf(`{"hash":"%s","height":42,"confirmations":1}`, hash)

		if method == "getblock" {
			value = fmt.Sprintf(`{"hash":"%s","height":42,"confirmations":1,"nTx":1,"tx":[%s]}`, hash, transactionJSON)
		}

		return json.Unmarshal([]byte(value), result)
	}))

	for i := range 12 {
		if _, err := e.Block(context.Background(), fmt.Sprintf("%064x", i+1)); err != nil {
			t.Fatal(err)
		}
	}

	if len(e.cache) != 8 || len(e.order) != 8 {
		t.Fatal("cache grew beyond eight blocks")
	}

	if _, present := e.cache[blockID]; present {
		t.Fatal("oldest block was not evicted")
	}
}

var _ rpc.Caller = callerFunc(nil)
