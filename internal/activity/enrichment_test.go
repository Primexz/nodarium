package activity

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestEnrichmentOutputAmounts(t *testing.T) {
	id := strings.Repeat("a", 64)
	for _, test := range []struct {
		name, outputs, want string
		rawFailed           bool
	}{
		{name: "includes change", outputs: `[{"value":0.9},{"value":0.1}]`, want: "100000000"},
		{name: "exact satoshis", outputs: `[{"value":1.23456789},{"value":0.00000001}]`, want: "123456790"},
		{name: "one satoshi", outputs: `[{"value":1e-8}]`, want: "1"},
		{name: "zero outputs", outputs: `[{"value":0}]`, want: "0"},
		{name: "missing value", outputs: `[{"value":1},{}]`},
		{name: "sub-satoshi value", outputs: `[{"value":0.000000001}]`},
		{name: "RPC unavailable", rawFailed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := testService(t, callerFunc(func(_ context.Context, method string, params, out any) error {
				switch method {
				case "getmempoolentry":
					return assign(out, map[string]any{"vsize": 100, "fees": map[string]float64{"base": 0.000002}})
				case "getrawtransaction":
					if test.rawFailed {
						return errors.New("transaction already left the mempool")
					}
					if args := params.([]any); args[0] != id || args[1] != 1 || len(args) != 2 {
						t.Errorf("unexpected pending lookup: %v", args)
					}
					return assign(out, map[string]any{
						"txid": id, "size": 100, "vsize": 100, "weight": 400,
						"vin":  []map[string]any{{"txid": strings.Repeat("b", 64)}},
						"vout": json.RawMessage(test.outputs),
					})
				default:
					t.Errorf("unexpected RPC method %s", method)
					return errors.New("unexpected RPC")
				}
			}))
			s.enrichResults = make(chan enrichment, 1)
			s.add(id, false)
			s.enrich()
			s.enrichWG.Wait()
			result := <-s.enrichResults
			tx := result.transactions[0]
			if tx.VSize == nil || *tx.VSize != 100 || tx.FeeRate == nil || *tx.FeeRate != 2 {
				t.Fatalf("amount lookup damaged independent size/fee metadata: %+v", tx)
			}
			if test.want == "" {
				if tx.OutputSats != nil {
					t.Fatalf("unknown amount fabricated as %s", *tx.OutputSats)
				}
			} else if tx.OutputSats == nil || *tx.OutputSats != test.want {
				t.Fatalf("output sum = %v, want %s", tx.OutputSats, test.want)
			}
		})
	}
}

func TestAmountRetryRetainsKnownMetadataAndBudget(t *testing.T) {
	id := strings.Repeat("a", 64)
	calls := 0
	s := testService(t, callerFunc(func(_ context.Context, method string, _, _ any) error {
		if method != "getrawtransaction" {
			t.Errorf("refetched known size and fee metadata: %s", method)
		}
		calls++
		return errors.New("unavailable")
	}))
	s.enrichResults = make(chan enrichment, 1)
	s.sample[id] = Transaction{TxID: id, VSize: new(int64(100)), FeeRate: new(float64(2))}
	s.enrich()
	s.enrichWG.Wait()
	first := <-s.enrichResults
	s.sample[id] = first.transactions[0]
	s.enrichBusy = false
	s.enrich()
	if calls != 1 || s.enrichBusy {
		t.Fatal("failed amount immediately retried outside its budget")
	}
	s.metadataAt = time.Now().Add(-6 * time.Second)
	s.enrich()
	s.enrichWG.Wait()
	second := <-s.enrichResults
	if calls != 2 || second.transactions[0].OutputSats != nil || *second.transactions[0].VSize != 100 {
		t.Fatal("bounded retry lost independent metadata or fabricated an amount")
	}
}
