package miningpool

import "time"

type Share struct {
	Pool    *Pool   `json:"pool"`
	Blocks  int     `json:"blocks"`
	Percent float64 `json:"percent"`
}

type Distribution struct {
	Status    string     `json:"status"`
	Stale     bool       `json:"stale"`
	Window    int        `json:"window"`
	Target    int        `json:"target"`
	Scanned   int        `json:"scanned"`
	Height    int64      `json:"height"`
	Tip       string     `json:"tip"`
	UpdatedAt *time.Time `json:"updated_at"`
	Shares    []Share    `json:"shares"`
	Source    Source     `json:"definitions"`
}
