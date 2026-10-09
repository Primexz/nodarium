package miningpool

import (
	"encoding/hex"
	"testing"
)

func TestOfficialSnapshotAndAttribution(t *testing.T) {
	r, err := Load()

	if err != nil {
		t.Fatal(err)
	}

	if len(r.rules) < 100 || r.Source.Commit == "" {
		t.Fatal("official snapshot missing")
	}

	for _, test := range []struct {
		script               string
		addresses            []string
		name, method, status string
	}{
		{"\x03abcFoundry USA Pool", nil, "Foundry USA", "coinbase_tag", "identified"},
		{"\x03abc/antpool/", nil, "AntPool", "coinbase_tag", "identified"},
		{"\x03abc七彩神仙鱼", nil, "F2Pool", "coinbase_tag", "identified"},
		{
			"\x03abcUnknown",
			[]string{"unmatched", "1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY"},
			"F2Pool",
			"payout_address",
			"identified",
		},
		{
			"\x03abc/AntPool/",
			[]string{"1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY"},
			"F2Pool",
			"payout_address",
			"identified",
		},
		{"\x03abcunrecognized", nil, "", "", "unknown"},
		{"\x03abc/AntPool/Foundry USA Pool", nil, "", "", "unknown"},
		{
			"\x03abcUnknown",
			[]string{"1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY", "12dRugNcdxK39288NjcDV4GX7rMsKCGn6B"},
			"",
			"",
			"unknown",
		},
	} {
		match := r.Identify("main", hex.EncodeToString([]byte(test.script)), test.addresses)

		if match.Status != test.status ||
			match.Method != test.method ||
			(test.name != "" &&
				(match.Pool == nil ||
					match.Pool.Name != test.name)) {
			t.Fatalf("%q: %+v", test.script, match)
		}
	}

	if r.Identify("regtest", "03abcd", nil).Status != "unsupported" {
		t.Fatal("mainnet attribution applied to regtest")
	}

	if r.Identify("main", "broken", nil).Status != "unavailable" {
		t.Fatal("bad coinbase became unknown")
	}
}

func TestDefinitionsValidationAndSafeLinks(t *testing.T) {
	for _, raw := range []string{
		`{}`,
		`[]`,
		`[{"id":1,"name":"Pool","tags":["(?="]}]`,
		`[{"id":1,"name":""}]`,
		`[{"id":1,"name":"Pool","tags":[""]}]`,
	} {
		if _, err := Parse([]byte(raw)); err == nil {
			t.Fatal("invalid definitions accepted", raw)
		}
	}

	r, err := Parse([]byte(`[{"id":1,"name":"Pool","tags":["Pool"],"link":"javascript:alert(1)"}]`))

	if err != nil {
		t.Fatal(err)
	}

	if r.rules[0].pool.Link != "" {
		t.Fatal("unsafe link exposed")
	}
}
