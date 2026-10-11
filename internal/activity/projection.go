package activity

import (
	"cmp"
	"container/heap"
	"context"
	"errors"
	"maps"
	"math"
	"slices"
	"time"
)

// Reserve room for the header and coinbase. These are projections, not mining
// templates: pool policy, sigops limits and new arrivals can change selection.
const projectedWeight = int64(3_996_000)
const projectedVSize = projectedWeight / 4
const projectionBlocks = 4
const projectionWorkLimit = 8_000_000

type MempoolEntry struct {
	VSize   int64    `json:"vsize"`
	Weight  int64    `json:"weight"`
	Depends []string `json:"depends"`
	Fees    struct {
		Base     float64  `json:"base"`
		Modified *float64 `json:"modified"`
	} `json:"fees"`
}

type FeeGroup struct {
	Count   int     `json:"count"`
	VSize   int64   `json:"vsize"`
	MinRate float64 `json:"min_rate"`
	MaxRate float64 `json:"max_rate"`
}

type ProjectedBlock struct {
	Count      int        `json:"count"`
	VSize      int64      `json:"vsize"`
	Weight     int64      `json:"weight"`
	MinRate    float64    `json:"min_rate"`
	MaxRate    float64    `json:"max_rate"`
	MedianRate float64    `json:"median_rate"`
	Groups     []FeeGroup `json:"groups"`
}

type Projection struct {
	At             int64            `json:"at"`
	Count          int              `json:"count"`
	VSize          int64            `json:"vsize"`
	Weight         int64            `json:"weight"`
	MinRate        float64          `json:"min_rate"`
	MaxRate        float64          `json:"max_rate"`
	RemainingCount int              `json:"remaining_count"`
	RemainingVSize int64            `json:"remaining_vsize"`
	Blocks         []ProjectedBlock `json:"blocks"`
}

type projectionResult struct {
	generation uint64
	projection *Projection
	err        error
}

type candidate struct {
	id       string
	entry    MempoolEntry
	fee      int64
	rate     float64
	index    int
	selected bool
	deferred bool
	children []*candidate
}

type candidates []*candidate

func (h candidates) Len() int { return len(h) }
func (h candidates) Less(i, j int) bool {
	return cmp.Or(cmp.Compare(h[j].rate, h[i].rate), cmp.Compare(h[i].id, h[j].id)) < 0
}
func (h candidates) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index, h[j].index = i, j
}
func (h *candidates) Push(value any) {
	c := value.(*candidate)
	c.index = len(*h)
	*h = append(*h, c)
}
func (h *candidates) Pop() any {
	n := len(*h) - 1
	c := (*h)[n]
	(*h)[n] = nil
	*h = (*h)[:n]
	c.index = -1
	return c
}

// Choose ancestor packages by their remaining modified fee / virtual size.
// After selection, reprice descendants so a shared parent is never counted
// twice and a high-fee child can pay for its low-fee parent (CPFP).
func projectMempool(ctx context.Context, entries map[string]MempoolEntry) (*Projection, error) {
	if len(entries) > MaxMembers {
		return nil, errors.New("projection capacity exceeded")
	}
	p := &Projection{At: time.Now().UnixMilli(), Count: len(entries), Blocks: []ProjectedBlock{}}
	nodes := make(map[string]*candidate, len(entries))
	q := candidates{}
	for id, e := range entries {
		fee := e.Fees.Base
		if e.Fees.Modified != nil {
			fee = *e.Fees.Modified
		}
		if e.VSize <= 0 || e.VSize > 4_000_000 || e.Weight < 0 || e.Weight > 4_000_000 || math.IsNaN(fee) || math.IsInf(fee, 0) || math.Abs(fee) > 21_000_000 {
			return nil, errors.New("invalid mempool metadata")
		}
		if e.Weight == 0 {
			e.Weight = e.VSize * 4
		}
		c := &candidate{id: id, entry: e, fee: int64(math.Round(fee * 1e8)), index: len(q)}
		nodes[id] = c
		q = append(q, c)
		p.VSize += e.VSize
		p.Weight += e.Weight
		rate := float64(c.fee) / float64(e.VSize)
		if len(q) == 1 {
			p.MinRate, p.MaxRate = rate, rate
		} else {
			p.MinRate, p.MaxRate = min(p.MinRate, rate), max(p.MaxRate, rate)
		}
	}
	for _, c := range q {
		for _, id := range c.entry.Depends {
			parent := nodes[id]
			if parent == nil {
				return nil, errors.New("incomplete mempool dependencies")
			}
			parent.children = append(parent.children, c)
		}
	}
	work := 0
	packageFor := func(c *candidate) ([]*candidate, int64, int64, int64, error) {
		ordered := []*candidate{}
		seen := map[string]uint8{}
		var fee, size, weight int64
		var visit func(*candidate, int) error
		visit = func(n *candidate, depth int) error {
			work++
			if work > projectionWorkLimit || depth > 1024 {
				return errors.New("projection work limit exceeded")
			}
			if work%1024 == 0 && ctx.Err() != nil {
				return ctx.Err()
			}
			if n.selected || seen[n.id] == 2 {
				return nil
			}
			if seen[n.id] == 1 {
				return errors.New("cyclic mempool dependencies")
			}
			seen[n.id] = 1
			for _, id := range n.entry.Depends {
				if err := visit(nodes[id], depth+1); err != nil {
					return err
				}
			}
			seen[n.id] = 2
			ordered = append(ordered, n)
			fee += n.fee
			size += n.entry.VSize
			weight += n.entry.Weight
			return nil
		}
		err := visit(c, 0)
		return ordered, fee, size, weight, err
	}
	for _, c := range q {
		_, fee, size, _, err := packageFor(c)
		if err != nil {
			return nil, err
		}
		c.rate = float64(fee) / float64(size)
	}
	heap.Init(&q)
	for range projectionBlocks {
		b := ProjectedBlock{Groups: []FeeGroup{}}
		rates := []float64{}
		groups := map[int]*FeeGroup{}
		deferred := []*candidate{}
		for q.Len() > 0 {
			c := heap.Pop(&q).(*candidate)
			if c.selected {
				continue
			}
			pkg, fee, size, weight, err := packageFor(c)
			if err != nil {
				return nil, err
			}
			if b.Weight+weight > projectedWeight || b.VSize+size > projectedVSize {
				c.deferred = true
				deferred = append(deferred, c)
				continue
			}
			rate := float64(fee) / float64(size)
			for _, n := range pkg {
				n.selected = true
				b.Count++
				b.Weight += n.entry.Weight
				b.VSize += n.entry.VSize
				rates = append(rates, rate)
				// Fixed logarithmic bands keep wire size and mosaic paint bounded.
				band := int(math.Floor(math.Log2(max(0, rate)+1) * 4))
				g := groups[band]
				if g == nil {
					g = &FeeGroup{MinRate: rate, MaxRate: rate}
					groups[band] = g
				}
				g.Count++
				g.VSize += n.entry.VSize
				g.MinRate, g.MaxRate = min(g.MinRate, rate), max(g.MaxRate, rate)
			}
			// Reprice each affected descendant once, including deferred packages.
			affected := map[*candidate]bool{}
			pending := slices.Clone(pkg)
			for i := 0; i < len(pending); i++ {
				for _, child := range pending[i].children {
					if !child.selected && !affected[child] {
						affected[child] = true
						pending = append(pending, child)
					}
				}
			}
			for n := range affected {
				_, fee, size, _, err := packageFor(n)
				if err != nil {
					return nil, err
				}
				n.rate = float64(fee) / float64(size)
				if n.index >= 0 {
					heap.Fix(&q, n.index)
				} else if n.deferred {
					n.deferred = false
					heap.Push(&q, n)
				}
			}
		}
		if b.Count == 0 {
			break
		}
		slices.Sort(rates)
		b.MinRate, b.MaxRate = rates[0], rates[len(rates)-1]
		b.MedianRate = rates[len(rates)/2]
		if len(rates)%2 == 0 {
			b.MedianRate = (b.MedianRate + rates[len(rates)/2-1]) / 2
		}
		for _, band := range slices.SortedFunc(maps.Keys(groups), func(a, b int) int { return cmp.Compare(b, a) }) {
			b.Groups = append(b.Groups, *groups[band])
		}
		p.Blocks = append(p.Blocks, b)
		for _, c := range deferred {
			if c.deferred && !c.selected {
				c.deferred = false
				heap.Push(&q, c)
			}
		}
	}
	p.RemainingCount, p.RemainingVSize = p.Count, p.VSize
	for _, b := range p.Blocks {
		p.RemainingCount -= b.Count
		p.RemainingVSize -= b.VSize
	}
	return p, ctx.Err()
}

func (s *Service) project() {
	if s.projectionBusy || time.Since(s.lastProjection) < 10*time.Second {
		return
	}
	s.projectionBusy = true
	s.lastProjection = time.Now()
	generation := s.Snapshot().Generation
	s.enrichWG.Go(func() {
		ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
		defer cancel()
		var entries map[string]MempoolEntry
		err := s.rpc.Call(ctx, "getrawmempool", []any{true}, &entries)
		var p *Projection
		if err == nil {
			p, err = projectMempool(ctx, entries)
		}
		select {
		case s.projectionResults <- projectionResult{generation, p, err}:
		case <-s.ctx.Done():
		}
	})
}
