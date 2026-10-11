package activity

import (
	"context"
	"slices"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
)

// Reconcile against actual headers, never the backfill frontier. A large gap
// remains an observation gap, not an invented complete chain history.
func (s *Service) chain(chain rpc.Blockchain) {
	if s.tip != nil && s.tip.Hash == chain.BestBlockHash {
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 4*time.Second)
	defer cancel()
	var head rpc.Block
	if s.rpc.Call(ctx, "getblockheader", []any{chain.BestBlockHash, true}, &head) != nil || head.Confirmations < 1 {
		return
	}
	if s.tip == nil {
		s.tip = &head
		s.dirty = true
		s.mu.Lock()
		s.live.Block = &Block{Hash: head.Hash, Height: head.Height, Time: head.Time, Transactions: []Transaction{}}
		s.mu.Unlock()
		return
	}
	old := *s.tip
	blocks := []rpc.Block{}
	cursor := head
	reorg := false
	var depth *int64
	var activeOld string
	if old.Height > head.Height {
		reorg = true
	} else {
		if s.rpc.Call(ctx, "getblockhash", []any{old.Height}, &activeOld) != nil {
			return
		}
		reorg = activeOld != old.Hash
	}
	if reorg {
		previous := old
		// Find the actual common ancestor; do not turn incomplete indexed coverage
		// into a fabricated reorg depth.
		for range 256 {
			if previous.Height > cursor.Height {
				if s.rpc.Call(ctx, "getblockheader", []any{previous.Previous, true}, &previous) != nil {
					break
				}
			} else if cursor.Height > previous.Height {
				blocks = append(blocks, cursor)
				if s.rpc.Call(ctx, "getblockheader", []any{cursor.Previous, true}, &cursor) != nil {
					break
				}
			} else if cursor.Hash == previous.Hash {
				depth = new(old.Height - cursor.Height)
				break
			} else {
				blocks = append(blocks, cursor)
				if previous.Previous == "" || cursor.Previous == "" {
					break
				}
				if s.rpc.Call(ctx, "getblockheader", []any{previous.Previous, true}, &previous) != nil || s.rpc.Call(ctx, "getblockheader", []any{cursor.Previous, true}, &cursor) != nil {
					break
				}
			}
		}
	} else {
		for len(blocks) < 144 && cursor.Hash != old.Hash && cursor.Height > old.Height {
			blocks = append(blocks, cursor)
			if cursor.Previous == old.Hash {
				break
			}
			if s.rpc.Call(ctx, "getblockheader", []any{cursor.Previous, true}, &cursor) != nil {
				return
			}
		}
	}
	// Recheck the tip after the walk to avoid emitting blocks from a racing fork.
	var best string
	if s.rpc.Call(ctx, "getbestblockhash", nil, &best) != nil || best != head.Hash {
		return
	}
	if reorg {
		s.tip = &head
		s.reset("resynchronizing")
		s.emit(storage.ActivityEvent{Kind: "reorg", Hash: head.Hash, Height: new(head.Height), PreviousHash: old.Hash, Depth: depth})
	}
	slices.Reverse(blocks)
	for _, b := range blocks {
		s.emit(storage.ActivityEvent{Kind: "block", Hash: b.Hash, Height: new(b.Height), BlockTime: new(b.Time)})
		if s.active() {
			s.confirm(ctx, b)
		}
	}
	s.tip = &head
}
func (s *Service) confirm(ctx context.Context, header rpc.Block) {
	var block struct {
		Tx            []string `json:"tx"`
		Confirmations int64    `json:"confirmations"`
	}
	if s.rpc.Call(ctx, "getblock", []any{header.Hash, 1}, &block) != nil || block.Confirmations < 1 {
		return
	}
	included := []Transaction{}
	for _, id := range block.Tx {
		if s.members[id] {
			s.sequence++
		}
		if tx, ok := s.sample[id]; ok {
			included = append(included, tx)
		} else if previous, ok := s.removed[id]; ok && time.Since(previous.at) < 30*time.Second {
			included = append(included, previous.tx)
		}
		delete(s.sample, id)
		delete(s.removed, id)
		delete(s.metadataTried, id)
		delete(s.members, id)
	}
	b := Block{Hash: header.Hash, Height: header.Height, Time: header.Time, Transactions: included}
	s.mu.Lock()
	s.live.Block = &b
	s.dirty = true
	s.mu.Unlock()
	s.publish("block", b)
	s.update("ready")
}
