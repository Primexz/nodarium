// Package miningpool identifies coinbase transactions using the official
// mempool/mining-pools definitions. Matching is heuristic, not proof of identity.
package miningpool

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
)

//go:embed data/pools-v2.json data/source.json data/LICENSE
var data embed.FS

type Pool struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Link string `json:"link"`
}

type Attribution struct {
	Status string `json:"status"`
	Pool   *Pool  `json:"pool"`
	Method string `json:"method,omitempty"`
}

type Source struct {
	URL    string `json:"source"`
	Commit string `json:"commit"`
	SHA256 string `json:"sha256"`
}

type definition struct {
	Pool
	Addresses []string `json:"addresses"`
	Tags      []string `json:"tags"`
}

type rule struct {
	pool Pool
	tags []*regexp.Regexp
}

type Registry struct {
	rules     []rule
	addresses map[string][]Pool
	Source    Source
}

// Parse also validates updates before they replace the bundled snapshot.
func Parse(raw []byte) (*Registry, error) {
	var definitions []definition

	if len(raw) > 2<<20 ||
		json.Unmarshal(raw, &definitions) != nil ||
		len(definitions) == 0 ||
		len(definitions) > 5000 {
		return nil, errors.New("invalid mining-pool definitions")
	}

	r := &Registry{addresses: make(map[string][]Pool)}
	ids := make(map[int]bool)

	for _, d := range definitions {
		link, err := url.Parse(d.Link)

		if d.ID < 1 || ids[d.ID] || d.Name == "" || len(d.Name) > 150 || len(d.Tags)+len(d.Addresses) == 0 {
			return nil, errors.New("invalid mining-pool entry")
		}

		// Some official entries omit a scheme or URL. Keep their identity,
		// but expose only safe, absolute HTTP(S) links to the frontend.
		if err != nil || link.Host == "" || (link.Scheme != "https" && link.Scheme != "http") || link.User != nil {
			d.Link = ""
		}

		ids[d.ID] = true
		compiled := rule{pool: d.Pool}

		for _, tag := range d.Tags {
			if tag == "" || len(tag) > 500 {
				return nil, errors.New("invalid coinbase tag")
			}

			pattern, err := regexp.Compile("(?i)" + tag)

			if err != nil {
				return nil, errors.New("unsupported coinbase tag regex")
			}

			compiled.tags = append(compiled.tags, pattern)
		}

		for _, address := range d.Addresses {
			if address == "" || len(address) > 150 {
				return nil, errors.New("invalid payout address")
			}

			r.addresses[address] = append(r.addresses[address], d.Pool)
		}

		r.rules = append(r.rules, compiled)
	}

	return r, nil
}

func Load() (*Registry, error) {
	raw, err := data.ReadFile("data/pools-v2.json")

	if err != nil {
		return nil, err
	}

	r, err := Parse(raw)

	if err != nil {
		return nil, err
	}

	meta, _ := data.ReadFile("data/source.json")

	if err := json.Unmarshal(meta, &r.Source); err != nil {
		return nil, err
	}

	digest := sha256.Sum256(raw)

	if r.Source.SHA256 != hex.EncodeToString(digest[:]) || len(r.Source.Commit) != 40 {
		return nil, errors.New("mining-pool snapshot provenance mismatch")
	}

	return r, nil
}

func (r *Registry) Identify(chain, coinbaseHex string, addresses []string) Attribution {
	if chain != "main" {
		return Attribution{Status: "unsupported"}
	}

	if r == nil {
		return Attribution{Status: "unavailable"}
	}

	script, err := hex.DecodeString(coinbaseHex)

	if err != nil || len(script) < 2 || len(script) > 100 {
		return Attribution{Status: "unavailable"}
	}

	// Exact payout addresses take precedence over self-declared tags. Conflicting
	// matches remain unknown rather than silently selecting an arbitrary pool.
	matches := make(map[int]Pool)

	for _, address := range addresses {
		for _, pool := range r.addresses[address] {
			matches[pool.ID] = pool
		}
	}

	method := "payout_address"

	if len(matches) == 0 {
		method = "coinbase_tag"

		for _, rule := range r.rules {
			for _, tag := range rule.tags {
				if tag.Match(script) {
					matches[rule.pool.ID] = rule.pool
					break
				}
			}
		}
	}

	if len(matches) == 1 {
		for _, pool := range matches {
			return Attribution{Status: "identified", Pool: &pool, Method: method}
		}
	}

	return Attribution{Status: "unknown"}
}
