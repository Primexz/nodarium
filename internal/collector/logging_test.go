package collector

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestLogsTransitionsAndPersistenceWithoutSecrets(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	f := &fakeRPC{fail: map[string]bool{}, chain: "regtest"}
	db := &memoryStore{}
	c := New(f, db, "http://private-endpoint", 10*time.Second, zap.New(core))
	ctx := context.Background()
	c.Collect(ctx)
	c.Collect(ctx)

	if logs.FilterMessage("Node connection status changed").Len() != 1 {
		t.Fatal("repeated connection event")
	}

	f.fail["getnettotals"] = true
	c.Collect(ctx)
	c.Collect(ctx)

	if logs.FilterMessage("Node connection status changed").FilterLevelExact(zap.WarnLevel).Len() != 1 {
		t.Fatal("missing or repeated outage warning")
	}

	delete(f.fail, "getnettotals")
	db.fail = true
	c.Collect(ctx)
	c.Collect(ctx)

	if logs.FilterMessage("History persistence unavailable; missed samples will remain gaps").Len() != 1 {
		t.Fatal("missing or repeated persistence warning")
	}

	db.fail = false
	c.Collect(ctx)

	if logs.FilterMessage("History persistence recovered").Len() != 1 {
		t.Fatal("missing recovery event")
	}

	if logs.FilterMessage("Collection cycle completed").Len() != 7 {
		t.Fatal("debug cycles missing")
	}

	for _, entry := range logs.All() {
		data, _ := json.Marshal(entry.ContextMap())

		for _, secret := range []string{"password must never leak", "private-endpoint"} {
			if strings.Contains(entry.Message+string(data), secret) {
				t.Fatal("sensitive data logged")
			}
		}
	}
}
